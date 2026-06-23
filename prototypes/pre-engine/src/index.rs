use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;
use rayon::prelude::*;
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
}

impl Index {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            files: HashMap::new(),
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
    }

    pub fn refresh(&mut self) {
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

        let parsed: Vec<Option<(PathBuf, FileEntry)>> = to_reparse
            .par_iter()
            .map(|(path, lang)| parse_file_standalone(path, *lang))
            .collect();

        for item in parsed.into_iter().flatten() {
            self.files.insert(item.0, item.1);
        }
        self.files.retain(|p, _| seen.contains(p));
    }

    pub fn file_count(&self) -> usize {
        self.files.len()
    }

    pub fn files(&self) -> impl Iterator<Item = &FileEntry> {
        self.files.values()
    }
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
    Some((
        path.to_path_buf(),
        FileEntry {
            path: path.to_path_buf(),
            lang,
            mtime,
            tree,
            source,
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
