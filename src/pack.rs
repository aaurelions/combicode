//! The default command: pack a project into one document.

use std::io::{self, IsTerminal, Write};
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};
use same_file::Handle;

use crate::cli::PackArgs;
use crate::document::{self, Options};
use crate::files::{self, Selection};
use crate::fsx;
use crate::prompt::{self, Layout};
use crate::units::{format_count, format_size};

const DEFAULT_OUTPUT: &str = "combicode.txt";
/// A rough average for source code across common LLM tokenizers.
const BYTES_PER_TOKEN: usize = 4;

enum Destination {
    Stdout,
    File(PathBuf),
}

impl Destination {
    fn choose(output: Option<&Path>) -> Self {
        match output {
            Some(path) if path == Path::new("-") => Self::Stdout,
            Some(path) => Self::File(path.to_path_buf()),
            None if io::stdout().is_terminal() => Self::File(PathBuf::from(DEFAULT_OUTPUT)),
            None => Self::Stdout,
        }
    }

    /// The file this run writes to, so it is not packed into itself.
    fn handle(&self) -> Option<Handle> {
        match self {
            Self::Stdout => Handle::stdout().ok(),
            Self::File(path) => Handle::from_path(path).ok(),
        }
    }
}

pub fn run(args: &PackArgs) -> Result<()> {
    let prompt_enabled = !(args.no_prompt || args.only_map);
    let map = !args.no_map;
    let code = !(args.no_code || args.only_map);
    if !prompt_enabled && !map && !code {
        bail!("nothing to output: --no-prompt, --no-map and --no-code disable every section");
    }

    let root = &args.path;
    if !root.is_dir() {
        bail!("{} is not a directory", root.display());
    }
    let project = project_name(root);
    let destination = Destination::choose(args.output.as_deref());

    let collection = files::collect(&Selection {
        root,
        include: &args.include,
        exclude: &args.exclude,
        omit_content: &args.omit_content,
        gitignore: !args.no_gitignore,
        output: destination.handle(),
    })?;
    if !args.quiet {
        for warning in &collection.warnings {
            eprintln!("combicode: warning: {warning}");
        }
    }
    if collection.files.is_empty() {
        bail!(
            "no files to pack in {}; check the path, ignore files and filters",
            root.display()
        );
    }

    let prompt = if !prompt_enabled {
        None
    } else if let Some(path) = &args.prompt_file {
        Some(
            std::fs::read_to_string(path)
                .with_context(|| format!("cannot read prompt file {}", path.display()))?,
        )
    } else {
        Some(prompt::builtin(
            args.prompt,
            &project,
            &Layout {
                map,
                outline: !args.no_outline,
                code,
                sizes: !args.no_size,
                omitted: collection.files.iter().any(|f| f.content.is_none()),
            },
        ))
    };
    let text = document::render(
        &project,
        &collection.files,
        &Options {
            prompt,
            map,
            outline: !args.no_outline,
            code,
            sizes: !args.no_size,
        },
    );

    let target = match &destination {
        Destination::Stdout => {
            write_stdout(text.as_bytes())?;
            "stdout".to_string()
        }
        Destination::File(path) => {
            if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
                std::fs::create_dir_all(parent)
                    .with_context(|| format!("cannot create {}", parent.display()))?;
            }
            fsx::write_atomic(path, text.as_bytes())
                .with_context(|| format!("cannot write {}", path.display()))?;
            path.display().to_string()
        }
    };

    if !args.quiet {
        let packed = collection.files.len();
        let content_bytes: u64 = collection
            .files
            .iter()
            .filter(|f| f.content.is_some())
            .map(|f| f.size)
            .sum();
        let omitted = collection
            .files
            .iter()
            .filter(|f| f.content.is_none())
            .count();
        let mut summary = format!(
            "combicode: packed {} {} ({}) into {target}: {} lines, ~{} tokens",
            format_count(packed),
            plural(packed, "file", "files"),
            format_size(content_bytes),
            format_count(text.matches('\n').count()),
            format_count(text.len().div_ceil(BYTES_PER_TOKEN)),
        );
        if omitted > 0 {
            summary.push_str(&format!("; content omitted for {}", format_count(omitted)));
        }
        let skipped = &collection.skipped;
        if skipped.total() > 0 {
            let reasons = [
                (skipped.binary, "binary"),
                (skipped.not_utf8, "not UTF-8"),
                (skipped.unreadable, "unreadable"),
                (skipped.previous_output, "previous Combicode output"),
            ]
            .iter()
            .filter(|(count, _)| *count > 0)
            .map(|(count, reason)| format!("{count} {reason}"))
            .collect::<Vec<_>>()
            .join(", ");
            summary.push_str(&format!("; skipped {reasons}"));
        }
        eprintln!("{summary}");
    }
    Ok(())
}

fn write_stdout(data: &[u8]) -> Result<()> {
    let mut stdout = io::stdout().lock();
    match stdout.write_all(data).and_then(|()| stdout.flush()) {
        Err(error) if error.kind() != io::ErrorKind::BrokenPipe => {
            Err(error).context("cannot write to stdout")
        }
        _ => Ok(()),
    }
}

fn project_name(root: &Path) -> String {
    std::fs::canonicalize(root)
        .ok()
        .and_then(|path| path.file_name().map(|n| n.to_string_lossy().into_owned()))
        .unwrap_or_else(|| "project".to_string())
}

pub fn plural<'a>(count: usize, one: &'a str, many: &'a str) -> &'a str {
    if count == 1 { one } else { many }
}
