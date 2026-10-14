//! Combicode packs a codebase into one LLM-friendly text file with a code map and exact
//! line references, and restores files from such a document.

mod archive;
mod cli;
mod document;
mod files;
mod fsx;
mod outline;
mod pack;
mod prompt;
mod restore;
mod units;

use std::process::ExitCode;

use clap::Parser;

use crate::cli::{Cli, Command};

fn main() -> ExitCode {
    let cli = Cli::parse();
    let result = match &cli.command {
        Some(Command::Restore(args)) => restore::run(args),
        None => pack::run(&cli.pack),
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("combicode: error: {error:#}");
            ExitCode::FAILURE
        }
    }
}
