use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime};
use rayon::prelude::*;
use tree_sitter::{Parser, Tree};
use walkdir::WalkDir;

use crate::language::Lang;
use crate::symbols;

pub struct FileEntry {
    pub path: PathBuf,
    pub lang: Lang,
    pub mtime: SystemTime,
    pub tree: Tree,
    pub source: String,
    pub parse_error: bool,
}

pub struct Index {
    pub root: PathBuf,
    files: HashMap<PathBuf, FileEntry>,
    defs_cache: HashMap<String, usize>,
    last_refresh: Instant,
}

const REFRESH_INTERVAL: Duration = Duration::from_millis(500);
pub const MAX_STALENESS_MS: u64 = 500;

impl Index {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            files: HashMap::new(),
            defs_cache: HashMap::new(),
            last_refresh: Instant::now(),
        }
    }

    pub fn build(&mut self) {
        let candidates: Vec<(PathBuf, Lang)> = WalkDir::new(&self.root)
            .into_iter()
            .filter_entry(|e| !is_ignored(e.path()))
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_file())
            .filter_map(|e| {
                let path = e.path().to_path_buf();
                Lang::from_path(&path).map(|lang| (path, lang))
            })
            .collect();

        let parsed: Vec<Option<(PathBuf, FileEntry)>> = candidates
            .par_iter()
            .map(|(path, lang)| parse_file_standalone(path, *lang))
            .collect();

        for item in parsed.into_iter().flatten() {
            self.files.insert(item.0, item.1);
        }
        self.rebuild_defs_cache();
        self.last_refresh = Instant::now();
    }

    pub fn refresh(&mut self) -> bool {
        if self.last_refresh.elapsed() < REFRESH_INTERVAL {
            return false;
        }
        let candidates: Vec<(PathBuf, Lang)> = WalkDir::new(&self.root)
            .into_iter()
            .filter_entry(|e| !is_ignored(e.path()))
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_file())
            .filter_map(|e| {
                let path = e.path().to_path_buf();
                Lang::from_path(&path).map(|lang| (path, lang))
            })
            .collect();

        let seen: std::collections::HashSet<PathBuf> =
            candidates.iter().map(|(p, _)| p.clone()).collect();

        let to_reparse: Vec<&(PathBuf, Lang)> = candidates
            .iter()
            .filter(|(path, _)| {
                let mtime = fs::metadata(path)
                    .and_then(|m| m.modified())
                    .unwrap_or(SystemTime::UNIX_EPOCH);
                match self.files.get(path) {
                    Some(existing) => existing.mtime != mtime,
                    None => true,
                }
            })
            .collect();

        let files_changed = !to_reparse.is_empty();
        let parsed: Vec<Option<(PathBuf, FileEntry)>> = to_reparse
            .par_iter()
            .map(|(path, lang)| parse_file_standalone(path, *lang))
            .collect();

        for item in parsed.into_iter().flatten() {
            self.files.insert(item.0, item.1);
        }
        let removed_any = self.files.keys().any(|p| !seen.contains(p));
        self.files.retain(|p, _| seen.contains(p));
        if files_changed || removed_any {
            self.rebuild_defs_cache();
        }
        self.last_refresh = Instant::now();
        true
    }

    pub fn refresh_paths(&mut self, paths: &[String]) -> (Vec<String>, Vec<String>) {
        let mut files_changed = false;
        let mut accepted = Vec::new();
        let mut rejected = Vec::new();
        let mut accepted_seen = HashSet::new();
        let mut rejected_seen = HashSet::new();
        for raw_path in paths {
            let Some((path, relative_path)) = workspace_path(&self.root, raw_path) else {
                if rejected_seen.insert(raw_path.clone()) {
                    rejected.push(raw_path.clone());
                }
                continue;
            };
            if !accepted_seen.insert(relative_path.clone()) {
                continue;
            }
            accepted.push(relative_path);
            if path.file_name().is_some_and(|name| name == "tsconfig.json") {
                continue;
            }
            let Some(lang) = Lang::from_path(&path) else {
                continue;
            };
            if !path.exists() {
                files_changed |= self.files.remove(&path).is_some();
                continue;
            }
            let mtime = file_mtime(&path).unwrap_or(SystemTime::UNIX_EPOCH);
            if self.files.get(&path).is_some_and(|entry| entry.mtime == mtime) {
                continue;
            }
            if let Some((path, entry)) = parse_file_standalone(&path, lang) {
                self.files.insert(path, entry);
                files_changed = true;
            }
        }
        if files_changed {
            self.rebuild_defs_cache();
        }
        (accepted, rejected)
    }

    fn rebuild_defs_cache(&mut self) {
        self.defs_cache.clear();
        for entry in self.files.values().filter(|entry| {
            !matches!(entry.lang, Lang::TypeScript | Lang::Tsx | Lang::Python | Lang::Rust)
        }) {
            for d in symbols::extract_definitions(&entry.tree, &entry.source, &entry.path, entry.lang) {
                self.defs_cache.insert(d.name, d.param_count);
            }
        }
    }

    pub fn all_defs(&self) -> &HashMap<String, usize> {
        &self.defs_cache
    }

    pub fn file_count(&self) -> usize {
        self.files.len()
    }

    pub fn files(&self) -> impl Iterator<Item = &FileEntry> {
        self.files.values()
    }

}

fn file_mtime(path: &Path) -> Option<SystemTime> {
    fs::metadata(path).and_then(|metadata| metadata.modified()).ok()
}

fn workspace_path(root: &Path, raw_path: &str) -> Option<(PathBuf, String)> {
    let raw_path = raw_path.trim();
    let bytes = raw_path.as_bytes();
    if raw_path.is_empty()
        || raw_path.starts_with('/')
        || raw_path.starts_with('\\')
        || (bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':')
    {
        return None;
    }
    let raw_path = Path::new(raw_path);
    if raw_path
        .components()
        .any(|component| {
            matches!(
                component,
                std::path::Component::ParentDir
                    | std::path::Component::RootDir
                    | std::path::Component::Prefix(_)
            )
        })
        || raw_path.is_absolute()
    {
        return None;
    }
    let candidate = root.join(raw_path);
    let canonical_root = root.canonicalize().ok()?;
    let mut existing_ancestor = candidate.as_path();
    let mut missing_components = Vec::new();
    while !existing_ancestor.exists() {
        missing_components.push(existing_ancestor.file_name()?.to_os_string());
        existing_ancestor = existing_ancestor.parent()?;
    }
    let mut resolved_candidate = existing_ancestor.canonicalize().ok()?;
    for component in missing_components.iter().rev() {
        resolved_candidate.push(component);
    }
    if !resolved_candidate.starts_with(&canonical_root) {
        return None;
    }
    let relative = resolved_candidate
        .strip_prefix(&canonical_root)
        .ok()?
        .to_string_lossy()
        .replace('\\', "/");
    (!relative.is_empty()).then_some((candidate, relative))
}

fn parse_file_standalone(path: &Path, lang: Lang) -> Option<(PathBuf, FileEntry)> {
    let source = fs::read_to_string(path).ok()?;
    let mtime = fs::metadata(path)
        .and_then(|m| m.modified())
        .unwrap_or(SystemTime::UNIX_EPOCH);
    let mut parser = Parser::new();
    parser
        .set_language(&lang.tree_sitter_language())
        .expect("failed to set language");
    let tree = parser.parse(&source, None)?;
    let parse_error = tree.root_node().has_error();
    Some((
        path.to_path_buf(),
        FileEntry {
            path: path.to_path_buf(),
            lang,
            mtime,
            tree,
            source,
            parse_error,
        },
    ))
}

const IGNORED_SEGMENTS: &[&str] = &[
    ".bench",
    ".linghun",
    ".codebase-memory",
    "node_modules",
    ".git",
    "target",
    "dist",
    "build",
    ".next",
    "coverage",
    "__pycache__",
    ".venv",
    "venv",
    "vendor",
    ".turbo",
    ".cache",
];

fn is_ignored(path: &Path) -> bool {
    path.components().any(|c| {
        if let std::path::Component::Normal(seg) = c {
            if let Some(s) = seg.to_str() {
                return IGNORED_SEGMENTS.contains(&s);
            }
        }
        false
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn targeted_refresh_handles_add_delete_and_rejects_escape() {
        let root = std::env::temp_dir().join(format!(
            "linghun-index-refresh-{}",
            std::process::id()
        ));
        let outside = root.with_file_name(format!(
            "linghun-index-outside-{}.ts",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_file(&outside);
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("first.ts"), "export const first = 1;\n").unwrap();
        fs::write(&outside, "export const escaped = 1;\n").unwrap();

        let mut index = Index::new(root.clone());
        index.build();
        assert_eq!(index.file_count(), 1);

        fs::remove_file(root.join("first.ts")).unwrap();
        let (accepted, rejected) = index.refresh_paths(&["first.ts".to_string()]);
        assert_eq!(accepted, vec!["first.ts"]);
        assert!(rejected.is_empty());
        assert_eq!(index.file_count(), 0);

        fs::write(root.join("second.ts"), "export const second = 2;\n").unwrap();
        let (accepted, rejected) = index.refresh_paths(&[
            "second.ts".to_string(),
            root.join("second.ts").to_string_lossy().to_string(),
        ]);
        assert_eq!(accepted, vec!["second.ts"]);
        assert_eq!(rejected, vec![root.join("second.ts").to_string_lossy().to_string()]);
        assert_eq!(index.file_count(), 1);

        let (accepted, rejected) = index.refresh_paths(&[
            format!("../{}", outside.file_name().unwrap().to_string_lossy()),
            outside.to_string_lossy().to_string(),
            root.join("missing")
                .join("..")
                .join("..")
                .join(outside.file_name().unwrap())
                .to_string_lossy()
                .to_string(),
        ]);
        assert!(accepted.is_empty());
        assert_eq!(rejected.len(), 3);
        assert_eq!(index.file_count(), 1);

        fs::remove_dir_all(root).unwrap();
        fs::remove_file(outside).unwrap();
    }

    #[test]
    fn targeted_refresh_rejects_cross_platform_absolute_drive_and_unc_paths() {
        let root = std::env::temp_dir().join(format!(
            "linghun-index-absolute-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("inside.ts"), "export const inside = 1;\n").unwrap();
        let mut index = Index::new(root.clone());

        let inputs = vec![
            root.join("inside.ts").to_string_lossy().to_string(),
            "C:/outside.ts".to_string(),
            r"C:\outside.ts".to_string(),
            r"\\server\share\outside.ts".to_string(),
        ];
        let (accepted, rejected) = index.refresh_paths(&inputs);

        assert!(accepted.is_empty());
        assert_eq!(rejected, inputs);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn targeted_refresh_rejects_existing_and_missing_symlink_escapes() {
        let root = std::env::temp_dir().join(format!(
            "linghun-index-symlink-root-{}",
            std::process::id()
        ));
        let outside = std::env::temp_dir().join(format!(
            "linghun-index-symlink-outside-{}",
            std::process::id()
        ));
        let link = root.join("outside-link");
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&outside);
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("existing.ts"), "export const outside = 1;\n").unwrap();

        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside, &link).unwrap();
        #[cfg(windows)]
        {
            let output = std::process::Command::new("cmd")
                .args(["/C", "mklink", "/J"])
                .arg(&link)
                .arg(&outside)
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "failed to create test junction: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        }

        let mut index = Index::new(root.clone());
        index.build();
        let (accepted, rejected) = index.refresh_paths(&[
            "outside-link/existing.ts".to_string(),
            "outside-link/missing.ts".to_string(),
        ]);

        assert!(accepted.is_empty());
        assert_eq!(rejected.len(), 2);
        #[cfg(unix)]
        fs::remove_file(&link).unwrap();
        #[cfg(windows)]
        fs::remove_dir(&link).unwrap();
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }

    #[test]
    fn targeted_refresh_returns_all_safe_verify_paths() {
        let root = std::env::temp_dir().join(format!(
            "linghun-index-verify-paths-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let paths: Vec<String> = [
            "ts", "mts", "cts", "tsx", "py", "rs", "go", "java", "sql", "sh",
            "bash", "zsh", "ksh", "cs", "php", "rb", "kt", "kts", "dart", "swift",
            "c", "h", "cpp", "cc", "cxx", "hpp", "hh", "hxx", "unknown",
        ]
        .into_iter()
        .map(|extension| format!("verify.{extension}"))
        .collect();
        for path in &paths {
            fs::write(root.join(path), "\n").unwrap();
        }

        let mut index = Index::new(root.clone());
        let (accepted, rejected) = index.refresh_paths(&paths);

        assert_eq!(accepted, paths);
        assert!(rejected.is_empty());
        fs::remove_dir_all(root).unwrap();
    }
}
