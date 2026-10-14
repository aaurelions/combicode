//! Selecting and reading the project files to pack.

use std::fs::File;
use std::io::Read;
use std::path::{Component, Path, PathBuf};

use anyhow::{Context, Result};
use ignore::WalkBuilder;
use ignore::gitignore::{Gitignore, GitignoreBuilder};
use same_file::Handle;

const DEFAULT_IGNORE: &str = include_str!("defaults.gitignore");
const IGNORE_FILE: &str = ".combicodeignore";
/// Files with a NUL byte in this many leading bytes are treated as binary.
const BINARY_SNIFF_BYTES: usize = 8000;

pub struct Selection<'a> {
    pub root: &'a Path,
    pub include: &'a [String],
    pub exclude: &'a [String],
    pub omit_content: &'a [String],
    pub gitignore: bool,
    /// The file being written, which must not pack itself.
    pub output: Option<Handle>,
}

pub struct SourceFile {
    /// Path relative to the root, with `/` separators.
    pub path: String,
    /// `None` when the content is omitted on request.
    pub content: Option<String>,
    pub size: u64,
}

#[derive(Default)]
pub struct Skipped {
    pub binary: usize,
    pub not_utf8: usize,
    pub unreadable: usize,
    pub previous_output: usize,
}

impl Skipped {
    pub fn total(&self) -> usize {
        self.binary + self.not_utf8 + self.unreadable + self.previous_output
    }
}

pub struct Collection {
    pub files: Vec<SourceFile>,
    pub skipped: Skipped,
    pub warnings: Vec<String>,
}

/// Walk `selection.root` and read every selected file, sorted in map order.
pub fn collect(selection: &Selection) -> Result<Collection> {
    let root = selection.root;
    let mut excluded = DEFAULT_IGNORE
        .lines()
        .map(str::to_string)
        .collect::<Vec<_>>();
    excluded.extend(submodule_patterns(root)?);
    excluded.extend(selection.exclude.iter().cloned());
    let excluded = matcher(root, &excluded, "--exclude")?;
    let included = if selection.include.is_empty() {
        None
    } else {
        Some(matcher(root, selection.include, "--include")?)
    };
    let omitted = matcher(root, selection.omit_content, "--omit-content")?;

    let mut walker = WalkBuilder::new(root);
    walker
        .hidden(false)
        .follow_links(false)
        .require_git(false)
        .parents(selection.gitignore)
        .git_ignore(selection.gitignore)
        .git_global(selection.gitignore)
        .git_exclude(selection.gitignore)
        .ignore(selection.gitignore)
        .add_custom_ignore_filename(IGNORE_FILE);
    let filter_root = root.to_path_buf();
    walker.filter_entry(move |entry| {
        let is_dir = entry.file_type().is_some_and(|t| t.is_dir());
        match entry.path().strip_prefix(&filter_root) {
            Ok(relative) if !relative.as_os_str().is_empty() => {
                !excluded.matched(relative, is_dir).is_ignore()
            }
            _ => true,
        }
    });

    let mut collection = Collection {
        files: Vec::new(),
        skipped: Skipped::default(),
        warnings: Vec::new(),
    };
    for entry in walker.build() {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                collection.warnings.push(error.to_string());
                collection.skipped.unreadable += 1;
                continue;
            }
        };
        if !entry.file_type().is_some_and(|t| t.is_file()) {
            continue;
        }
        let full = entry.path();
        let relative = full.strip_prefix(root).unwrap_or(full);
        let Some(path) = portable_path(relative) else {
            collection.warnings.push(format!(
                "skipping {}: file name is not valid UTF-8",
                relative.display()
            ));
            collection.skipped.unreadable += 1;
            continue;
        };
        if included
            .as_ref()
            .is_some_and(|m| !m.matched_path_or_any_parents(relative, false).is_ignore())
        {
            continue;
        }
        let is_output = selection
            .output
            .as_ref()
            .is_some_and(|output| Handle::from_path(full).is_ok_and(|h| &h == output));
        if is_output {
            continue;
        }
        let omit = omitted
            .matched_path_or_any_parents(relative, false)
            .is_ignore();
        match read(full, omit) {
            Ok(Contents::Text(content)) if is_combicode_output(&content) => {
                collection.skipped.previous_output += 1;
            }
            Ok(Contents::Text(content)) => collection.files.push(SourceFile {
                size: content.len() as u64,
                path,
                content: Some(content),
            }),
            Ok(Contents::Omitted(size)) => collection.files.push(SourceFile {
                path,
                content: None,
                size,
            }),
            Ok(Contents::Binary) => collection.skipped.binary += 1,
            Ok(Contents::NotUtf8) => {
                collection
                    .warnings
                    .push(format!("skipping {path}: not valid UTF-8"));
                collection.skipped.not_utf8 += 1;
            }
            Err(error) => {
                collection
                    .warnings
                    .push(format!("skipping {path}: {error}"));
                collection.skipped.unreadable += 1;
            }
        }
    }
    collection
        .files
        .sort_by(|a, b| a.path.split('/').cmp(b.path.split('/')));
    Ok(collection)
}

enum Contents {
    Text(String),
    Omitted(u64),
    Binary,
    NotUtf8,
}

fn read(path: &Path, omit: bool) -> std::io::Result<Contents> {
    let mut file = File::open(path)?;
    let size = file.metadata()?.len();
    let mut head = Vec::with_capacity(BINARY_SNIFF_BYTES);
    file.by_ref()
        .take(BINARY_SNIFF_BYTES as u64)
        .read_to_end(&mut head)?;
    if head.contains(&0) {
        return Ok(Contents::Binary);
    }
    if omit {
        return Ok(Contents::Omitted(size));
    }
    let mut bytes = head;
    file.read_to_end(&mut bytes)?;
    Ok(match String::from_utf8(bytes) {
        Ok(text) => Contents::Text(text),
        Err(_) => Contents::NotUtf8,
    })
}

/// Combicode documents left in the project from earlier runs are not packed again.
fn is_combicode_output(content: &str) -> bool {
    (content.ends_with("\n</code>\n") && content.contains("\n<file path=\""))
        || (content.ends_with("\n</code_map>\n")
            && (content.starts_with("<code_map>\n") || content.contains("\n<code_map>\n")))
}

fn portable_path(relative: &Path) -> Option<String> {
    let parts = relative
        .components()
        .map(|component| match component {
            Component::Normal(part) => part.to_str(),
            _ => None,
        })
        .collect::<Option<Vec<_>>>()?;
    Some(parts.join("/"))
}

fn matcher(root: &Path, patterns: &[String], option: &str) -> Result<Gitignore> {
    let mut builder = GitignoreBuilder::new(root);
    for pattern in patterns {
        let pattern = pattern.trim();
        if pattern.is_empty() || pattern.starts_with('#') {
            continue;
        }
        builder
            .add_line(None, pattern)
            .with_context(|| format!("invalid {option} pattern {pattern:?}"))?;
    }
    builder
        .build()
        .with_context(|| format!("invalid {option} patterns"))
}

/// Paths of git submodules declared in `.gitmodules`, as anchored patterns.
fn submodule_patterns(root: &Path) -> Result<Vec<String>> {
    let path: PathBuf = root.join(".gitmodules");
    let content = match std::fs::read_to_string(&path) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error).with_context(|| format!("cannot read {}", path.display())),
    };
    Ok(content
        .lines()
        .filter_map(|line| {
            let (key, value) = line.split_once('=')?;
            (key.trim() == "path").then(|| format!("/{}", value.trim().trim_matches('/')))
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_previous_outputs() {
        assert!(is_combicode_output(
            "prompt\n\n<code>\n<file path=\"a\" bytes=\"0\">\n</file>\n</code>\n"
        ));
        assert!(is_combicode_output("<code_map>\nx/\n</code_map>\n"));
        assert!(!is_combicode_output("<code>\nnot a document\n"));
    }

    #[test]
    fn defaults_are_valid_patterns() {
        let lines = DEFAULT_IGNORE
            .lines()
            .map(str::to_string)
            .collect::<Vec<_>>();
        let m = matcher(Path::new("/project"), &lines, "default").unwrap();
        assert!(m.matched("node_modules", true).is_ignore());
        assert!(m.matched("a/.env.local", false).is_ignore());
        assert!(!m.matched(".env.example", false).is_ignore());
        assert!(!m.matched("src/main.rs", false).is_ignore());
    }
}
