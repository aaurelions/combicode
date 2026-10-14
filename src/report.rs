//! The summary printed to stderr after a run.

use std::io::{self, IsTerminal};

/// Fits the longest standard label ("Omitted", "Skipped").
const LABEL_WIDTH: usize = 7;

/// A headline followed by aligned `Label  value` rows, e.g.
///
/// ```text
/// ✓ Packed 28 files into combicode.txt
///   Source   167.7KB
///   Output   5,337 lines · ~49,325 tokens
/// ```
pub struct Report {
    headline: String,
    success: bool,
    rows: Vec<(&'static str, String)>,
}

impl Report {
    /// A report for a completed action, marked with a check.
    pub fn done(headline: String) -> Self {
        Self {
            headline,
            success: true,
            rows: Vec::new(),
        }
    }

    /// A report for an action that was only previewed, without the check.
    pub fn preview(headline: String) -> Self {
        Self {
            headline,
            success: false,
            rows: Vec::new(),
        }
    }

    pub fn row(&mut self, label: &'static str, value: String) {
        self.rows.push((label, value));
    }

    pub fn render(&self, color: bool) -> String {
        let paint = |code: &str, text: &str| {
            if color {
                format!("\x1b[{code}m{text}\x1b[0m")
            } else {
                text.to_string()
            }
        };
        let mut out = if self.success {
            format!("{} {}\n", paint("32", "✓"), paint("1", &self.headline))
        } else {
            format!("{}\n", paint("1", &self.headline))
        };
        // A fixed minimum keeps values in the same column whether or not optional rows
        // such as "Skipped" are present.
        let width = self
            .rows
            .iter()
            .map(|(label, _)| label.len())
            .fold(LABEL_WIDTH, usize::max);
        for (label, value) in &self.rows {
            let padded = format!("{label:<width$}");
            out.push_str(&format!("  {}  {value}\n", paint("2", &padded)));
        }
        out
    }

    pub fn print(&self) {
        eprint!("{}", self.render(stderr_color()));
    }
}

/// Color only an interactive stderr, and honor <https://no-color.org>.
fn stderr_color() -> bool {
    io::stderr().is_terminal() && std::env::var_os("NO_COLOR").is_none_or(|v| v.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn aligns_rows() {
        let mut report = Report::done("Packed 2 files into out.txt".to_string());
        report.row("Source", "1KB".to_string());
        report.row("Skipped", "1 binary".to_string());
        assert_eq!(
            report.render(false),
            "✓ Packed 2 files into out.txt\n  Source   1KB\n  Skipped  1 binary\n"
        );
        assert_eq!(
            Report::preview("Dry run".to_string()).render(false),
            "Dry run\n"
        );
        assert!(report.render(true).contains("\x1b[32m✓\x1b[0m"));
    }
}
