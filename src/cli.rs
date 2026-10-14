//! Command-line interface definition.

use std::path::PathBuf;

use clap::{Args, Parser, Subcommand};

use crate::prompt::Preset;

const EXAMPLES: &str = "\
Examples:
  combicode                               Save combicode.txt (or write to stdout when redirected)
  combicode > context.txt                 Write the document to a file through stdout
  combicode -o context.txt                Write the document to a file
  combicode --only-map                    Print only the directory tree and code outline
  combicode -i 'src/,*.md' -e '*.test.ts' Choose which files to pack
  combicode --omit-content 'fixtures/'    List files in the map without their content
  combicode restore context.txt -o out/   Recreate the packed files";

/// Pack a codebase into one LLM-friendly text file with a code map and exact line references.
#[derive(Debug, Parser)]
#[command(
    name = "combicode",
    version,
    after_help = EXAMPLES,
    args_conflicts_with_subcommands = true,
    subcommand_precedence_over_arg = true
)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Option<Command>,

    #[command(flatten)]
    pub pack: PackArgs,
}

#[derive(Debug, Subcommand)]
pub enum Command {
    /// Recreate files from a Combicode document
    Restore(RestoreArgs),
}

#[derive(Debug, Args)]
pub struct PackArgs {
    /// Project directory to pack
    #[arg(default_value = ".")]
    pub path: PathBuf,

    /// Write to FILE ("-" for stdout). Default: stdout, or combicode.txt when stdout is a terminal
    #[arg(short, long, value_name = "FILE")]
    pub output: Option<PathBuf>,

    /// Pack only files matching these patterns (gitignore syntax, comma-separated)
    #[arg(
        short,
        long,
        value_name = "PATTERNS",
        value_delimiter = ',',
        help_heading = "Selection"
    )]
    pub include: Vec<String>,

    /// Skip files matching these patterns (gitignore syntax, comma-separated)
    #[arg(
        short,
        long,
        value_name = "PATTERNS",
        value_delimiter = ',',
        help_heading = "Selection"
    )]
    pub exclude: Vec<String>,

    /// List matching files in the map but leave out their content
    #[arg(
        long,
        value_name = "PATTERNS",
        value_delimiter = ',',
        help_heading = "Selection"
    )]
    pub omit_content: Vec<String>,

    /// Do not read .gitignore, .ignore or git exclude files
    #[arg(long, help_heading = "Selection")]
    pub no_gitignore: bool,

    /// Leave out the instructions for the LLM at the top
    #[arg(long, help_heading = "Sections")]
    pub no_prompt: bool,

    /// Leave out the code map (directory tree and outline)
    #[arg(long, help_heading = "Sections")]
    pub no_map: bool,

    /// Leave out file contents
    #[arg(long, help_heading = "Sections")]
    pub no_code: bool,

    /// Output only the code map (same as --no-prompt --no-code)
    #[arg(long, conflicts_with_all = ["no_map", "prompt", "prompt_file"], help_heading = "Sections")]
    pub only_map: bool,

    /// Show only files in the map, without classes and functions
    #[arg(long, help_heading = "Map")]
    pub no_outline: bool,

    /// Hide file and symbol sizes in the map
    #[arg(long, help_heading = "Map")]
    pub no_size: bool,

    /// Built-in prompt to use
    #[arg(
        long,
        value_enum,
        default_value_t = Preset::Code,
        conflicts_with = "no_prompt",
        help_heading = "Prompt"
    )]
    pub prompt: Preset,

    /// Use the contents of FILE as the prompt
    #[arg(
        long,
        value_name = "FILE",
        conflicts_with = "no_prompt",
        help_heading = "Prompt"
    )]
    pub prompt_file: Option<PathBuf>,

    /// Do not print the summary and warnings to stderr
    #[arg(short, long)]
    pub quiet: bool,
}

#[derive(Debug, Args)]
pub struct RestoreArgs {
    /// Combicode document to read ("-" for stdin)
    #[arg(default_value = "combicode.txt")]
    pub input: PathBuf,

    /// Directory to restore into
    #[arg(short, long, value_name = "DIR", default_value = ".")]
    pub output: PathBuf,

    /// Show what would be written without changing anything
    #[arg(short = 'n', long)]
    pub dry_run: bool,

    /// Replace files that already exist
    #[arg(short, long)]
    pub force: bool,

    /// Do not print the list of files and the summary
    #[arg(short, long)]
    pub quiet: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::CommandFactory;

    #[test]
    fn definition_is_valid() {
        Cli::command().debug_assert();
    }
}
