use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;
use tree_sitter::{Parser, Tree};
use walkdir::WalkDir;

use crate::language::Lang;

pub struct FileEntry {
    pub path: PathBuf,
    pub lang: Lang,
    pub mtime: SystemTime,
    pub tree: Tree,
    pub source: String,
}

pub struct Index {
    pub root: PathBuf,
    files: HashMap<PathBuf, FileEntry>,
    parser: Parser,
}

impl Index {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            files: HashMap::new(),
            parser: Parser::new(),
        }
    }

    pub fn build(&mut self) {
        let root = self.root.clone();
        for entry in WalkDir::new(&root)
            .into_iter()
            .filter_entry(|e| !is_ignored(e.path()))
            .filter_map(|e| e.ok())
        {
            if !entry.file_type().is_file() {
                continue;
            }
            let path = entry.path().to_path_buf();
            let lang = match Lang::from_path(&path) {
                Some(l) => l,
                None => continue,
            };
            self.parse_file(&path, lang);
        }
    }

    pub fn refresh(&mut self) {
        let root = self.root.clone();
        let mut seen = std::collections::HashSet::new();
        for entry in WalkDir::new(&root)
            .into_iter()
            .filter_entry(|e| !is_ignored(e.path()))
            .filter_map(|e| e.ok())
        {
            if !entry.file_type().is_file() {
                continue;
            }
            let path = entry.path().to_path_buf();
            let lang = match Lang::from_path(&path) {
                Some(l) => l,
                None => continue,
            };
            seen.insert(path.clone());
            let mtime = fs::metadata(&path)
                .and_then(|m| m.modified())
                .unwrap_or(SystemTime::UNIX_EPOCH);
            let needs_reparse = match self.files.get(&path) {
                Some(existing) => existing.mtime != mtime,
                None => true,
            };
            if needs_reparse {
                self.parse_file(&path, lang);
            }
        }
        self.files.retain(|p, _| seen.contains(p));
    }

    pub fn file_count(&self) -> usize {
        self.files.len()
    }

    pub fn files(&self) -> impl Iterator<Item = &FileEntry> {
        self.files.values()
    }

    fn parse_file(&mut self, path: &Path, lang: Lang) {
        let source = match fs::read_to_string(path) {
            Ok(s) => s,
            Err(_) => return,
        };
        let mtime = fs::metadata(path)
            .and_then(|m| m.modified())
            .unwrap_or(SystemTime::UNIX_EPOCH);
        self.parser
            .set_language(&lang.tree_sitter_language())
            .expect("failed to set language");
        let tree = match self.parser.parse(&source, None) {
            Some(t) => t,
            None => return,
        };
        self.files.insert(
            path.to_path_buf(),
            FileEntry {
                path: path.to_path_buf(),
                lang,
                mtime,
                tree,
                source,
            },
        );
    }
}

fn is_ignored(path: &Path) -> bool {
    let name = match path.file_name().and_then(|n| n.to_str()) {
        Some(n) => n,
        None => return false,
    };
    matches!(
        name,
        "node_modules"
            | ".git"
            | "target"
            | "dist"
            | "build"
            | ".next"
            | "__pycache__"
            | ".venv"
            | "vendor"
    )
}
