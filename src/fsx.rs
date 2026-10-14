//! File writes that never leave a partially written target behind.

use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

/// Replace `target` atomically: write a temporary file next to it, then rename it.
pub fn write_atomic(target: &Path, data: &[u8]) -> io::Result<()> {
    let (temporary, mut file) = create_temporary(target)?;
    let result = file
        .write_all(data)
        .and_then(|()| file.sync_all())
        .and_then(|()| {
            drop(file);
            fs::rename(&temporary, target)
        });
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

/// Create `target`, failing if it already exists. A failed write removes the file.
pub fn write_new(target: &Path, data: &[u8]) -> io::Result<()> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(target)?;
    let result = file.write_all(data).and_then(|()| file.sync_all());
    if result.is_err() {
        drop(file);
        let _ = fs::remove_file(target);
    }
    result
}

fn create_temporary(target: &Path) -> io::Result<(PathBuf, File)> {
    static COUNTER: AtomicUsize = AtomicUsize::new(0);
    let directory = match target.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => parent,
        _ => Path::new("."),
    };
    let name = target
        .file_name()
        .map_or_else(|| "output".into(), |n| n.to_string_lossy());
    loop {
        let id = COUNTER.fetch_add(1, Ordering::Relaxed);
        let path = directory.join(format!(".{name}.{}.{id}.tmp", std::process::id()));
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(file) => return Ok((path, file)),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }
}
