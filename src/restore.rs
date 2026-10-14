//! The `restore` command: recreate files from a Combicode document.

use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};

use crate::archive::{self, Record};
use crate::cli::RestoreArgs;
use crate::fsx;
use crate::pack::plural;
use crate::units::{format_count, format_size};

#[derive(Clone, Copy)]
enum Action {
    Create,
    Replace,
    KeepExisting,
}

pub fn run(args: &RestoreArgs) -> Result<()> {
    let data = if args.input == Path::new("-") {
        let mut data = Vec::new();
        io::stdin()
            .read_to_end(&mut data)
            .context("cannot read stdin")?;
        data
    } else {
        fs::read(&args.input).with_context(|| format!("cannot read {}", args.input.display()))?
    };
    let records = archive::parse(&data)
        .with_context(|| format!("{} is not a valid Combicode document", args.input.display()))?;

    let root = &args.output;
    reject_symlink(root)?;
    let mut plan = Vec::new();
    for record in &records {
        let Some(content) = &record.content else {
            continue;
        };
        let target = target_path(root, &record.path)?;
        let action = match fs::symlink_metadata(&target) {
            Ok(meta) if meta.is_dir() => bail!("{} is a directory", target.display()),
            Ok(_) if args.force => Action::Replace,
            Ok(_) => Action::KeepExisting,
            Err(error) if error.kind() == io::ErrorKind::NotFound => Action::Create,
            Err(error) => {
                return Err(error).with_context(|| format!("cannot inspect {}", target.display()));
            }
        };
        plan.push((record, content, target, action));
    }

    let mut written = 0usize;
    let mut bytes = 0u64;
    for (record, content, target, action) in &plan {
        if !args.dry_run {
            match action {
                Action::KeepExisting => {}
                Action::Create | Action::Replace => write(root, record, target, content, *action)?,
            }
        }
        if !matches!(action, Action::KeepExisting) {
            written += 1;
            bytes += content.len() as u64;
        }
        if !args.quiet {
            let status = match (action, args.dry_run) {
                (Action::Create, false) => "created",
                (Action::Create, true) => "would create",
                (Action::Replace, false) => "replaced",
                (Action::Replace, true) => "would replace",
                (Action::KeepExisting, _) => "exists, kept (use --force to replace)",
            };
            eprintln!("  {}  {status}", record.path);
        }
    }

    if !args.quiet {
        let omitted = records.iter().filter(|r| r.content.is_none()).count();
        let kept = plan.len() - written;
        let verb = if args.dry_run {
            "would restore"
        } else {
            "restored"
        };
        let mut summary = format!(
            "combicode: {verb} {} {} ({}) into {}",
            format_count(written),
            plural(written, "file", "files"),
            format_size(bytes),
            root.display()
        );
        if kept > 0 {
            summary.push_str(&format!("; kept {} existing", format_count(kept)));
        }
        if omitted > 0 {
            summary.push_str(&format!(
                "; {} omitted in the document",
                format_count(omitted)
            ));
        }
        eprintln!("{summary}");
    }
    Ok(())
}

fn write(
    root: &Path,
    record: &Record,
    target: &Path,
    content: &[u8],
    action: Action,
) -> Result<()> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("cannot create {}", parent.display()))?;
    }
    // Directories may have been replaced between planning and writing.
    target_path(root, &record.path)?;
    let result = match action {
        Action::Replace => fsx::write_atomic(target, content),
        _ => fsx::write_new(target, content),
    };
    result.with_context(|| format!("cannot write {}", target.display()))
}

/// Resolve `path` under `root`, refusing to follow symlinks at or below `root`.
fn target_path(root: &Path, path: &str) -> Result<PathBuf> {
    archive::validate_path(path)?;
    let mut current = root.to_path_buf();
    for part in path.split('/') {
        current.push(part);
        reject_symlink(&current)?;
    }
    Ok(current)
}

fn reject_symlink(path: &Path) -> Result<()> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.file_type().is_symlink() => {
            bail!("refusing to write through the symlink {}", path.display())
        }
        Err(error) if error.kind() != io::ErrorKind::NotFound => {
            Err(error).with_context(|| format!("cannot inspect {}", path.display()))
        }
        _ => Ok(()),
    }
}
