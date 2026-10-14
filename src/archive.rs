//! The `<code>` section format: writing file records and parsing them back.
//!
//! ```text
//! <code>
//! <file path="src/main.rs" bytes="42">
//! ...exactly 42 bytes of content...
//! </file>
//!
//! <file path="assets/large.json" omitted="true" />
//! </code>
//! ```
//!
//! `bytes` is the exact UTF-8 length of the content, so content may contain anything,
//! including text that looks like a record. A newline is added before `</file>` only when
//! the content does not already end with one.

use std::collections::HashSet;
use std::sync::LazyLock;

use anyhow::{Context, Result, bail, ensure};
use regex::bytes::Regex;

pub const CODE_OPEN: &str = "<code>";
pub const CODE_CLOSE: &str = "</code>";
pub const MAP_OPEN: &str = "<code_map>";
pub const MAP_CLOSE: &str = "</code_map>";
const FILE_CLOSE: &[u8] = b"</file>\n";

static HEADER: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"^<file path="([^"]*)"(?: bytes="(\d+)">| omitted="true" />)$"#)
        .expect("valid regex")
});

/// A file record read from a document. `content` is `None` for omitted files.
#[derive(Debug, PartialEq, Eq)]
pub struct Record {
    pub path: String,
    pub content: Option<Vec<u8>>,
}

/// Append a file record (without a trailing blank line) to `out`.
pub fn write_record(out: &mut String, path: &str, content: Option<&str>) {
    let path = escape_attribute(path);
    match content {
        None => out.push_str(&format!("<file path=\"{path}\" omitted=\"true\" />\n")),
        Some(content) => {
            out.push_str(&format!(
                "<file path=\"{path}\" bytes=\"{}\">\n",
                content.len()
            ));
            out.push_str(content);
            if !content.is_empty() && !content.ends_with('\n') {
                out.push('\n');
            }
            out.push_str("</file>\n");
        }
    }
}

/// Number of lines a record's content occupies in the document.
pub fn content_lines(content: &str) -> usize {
    if content.is_empty() {
        0
    } else {
        content.matches('\n').count() + usize::from(!content.ends_with('\n'))
    }
}

/// Parse every file record in a Combicode document.
pub fn parse(data: &[u8]) -> Result<Vec<Record>> {
    let mut search_from = 0;
    if let Some(map) = find_line(data, 0, MAP_OPEN) {
        let end =
            find_line(data, map, MAP_CLOSE).context("the <code_map> section is not closed")?;
        search_from = end + MAP_CLOSE.len();
    }
    let open = find_line(data, search_from, CODE_OPEN)
        .context("no <code> section found; regenerate the document with code included")?;
    let mut pos = open + CODE_OPEN.len() + 1;
    let mut records = Vec::new();
    let mut seen = HashSet::new();
    loop {
        while data.get(pos) == Some(&b'\n') {
            pos += 1;
        }
        let rest = &data[pos..];
        if rest == CODE_CLOSE.as_bytes() || rest.starts_with(format!("{CODE_CLOSE}\n").as_bytes()) {
            break;
        }
        ensure!(!rest.is_empty(), "the <code> section is not closed");
        let line_end = rest
            .iter()
            .position(|&b| b == b'\n')
            .context("truncated file record")?;
        let header = &rest[..line_end];
        let captures = HEADER.captures(header).with_context(|| {
            format!(
                "invalid file record header: {}",
                String::from_utf8_lossy(&header[..header.len().min(200)])
            )
        })?;
        let raw_path = std::str::from_utf8(&captures[1]).context("file path is not UTF-8")?;
        let path = unescape_attribute(raw_path)?;
        validate_path(&path)?;
        ensure!(seen.insert(path.clone()), "duplicate file path {path:?}");
        pos += line_end + 1;

        let content = match captures.get(2) {
            None => None,
            Some(length) => {
                let length: usize = std::str::from_utf8(length.as_bytes())?
                    .parse()
                    .context("invalid byte count")?;
                let content = data
                    .get(pos..pos.checked_add(length).context("invalid byte count")?)
                    .with_context(|| format!("content of {path:?} is truncated"))?;
                pos += length;
                if !content.is_empty() && content.last() != Some(&b'\n') {
                    ensure!(
                        data.get(pos) == Some(&b'\n'),
                        "content of {path:?} has the wrong byte count"
                    );
                    pos += 1;
                }
                ensure!(
                    data[pos..].starts_with(FILE_CLOSE),
                    "content of {path:?} does not match its byte count (was the document edited or its line endings converted?)"
                );
                pos += FILE_CLOSE.len();
                Some(content.to_vec())
            }
        };
        records.push(Record { path, content });
    }
    ensure!(!records.is_empty(), "the document contains no files");
    for path in &seen {
        let mut prefix = path.as_str();
        while let Some((parent, _)) = prefix.rsplit_once('/') {
            ensure!(
                !seen.contains(parent),
                "{path:?} conflicts with the file {parent:?}"
            );
            prefix = parent;
        }
    }
    Ok(records)
}

/// Byte offset of the first line equal to `line` at or after `from`.
fn find_line(data: &[u8], from: usize, line: &str) -> Option<usize> {
    let line = line.as_bytes();
    let mut pos = from;
    while pos <= data.len() {
        let rest = &data[pos..];
        let found = rest.windows(line.len()).position(|w| w == line)? + pos;
        let at_line_start = found == 0 || data[found - 1] == b'\n';
        let after = data.get(found + line.len());
        if at_line_start && matches!(after, None | Some(b'\n')) {
            return Some(found);
        }
        pos = found + 1;
    }
    None
}

fn escape_attribute(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            c if c.is_control() => out.push_str(&format!("&#x{:X};", c as u32)),
            c => out.push(c),
        }
    }
    out
}

fn unescape_attribute(value: &str) -> Result<String> {
    let mut out = String::with_capacity(value.len());
    let mut rest = value;
    while let Some(amp) = rest.find('&') {
        out.push_str(&rest[..amp]);
        let tail = &rest[amp..];
        let end = tail
            .find(';')
            .context("invalid character reference in path")?;
        let entity = &tail[1..end];
        let ch = match entity {
            "amp" => '&',
            "lt" => '<',
            "gt" => '>',
            "quot" => '"',
            _ => entity
                .strip_prefix("#x")
                .and_then(|hex| u32::from_str_radix(hex, 16).ok())
                .and_then(char::from_u32)
                .with_context(|| format!("invalid character reference &{entity}; in path"))?,
        };
        out.push(ch);
        rest = &tail[end + 1..];
    }
    out.push_str(rest);
    Ok(out)
}

/// Reject paths that are absolute, escape the destination, or are not portable.
pub fn validate_path(path: &str) -> Result<()> {
    let unsafe_path = path.is_empty()
        || path
            .chars()
            .any(|c| c.is_control() || c == '\\' || c == ':')
        || path.split('/').any(|part| {
            let upper = part.to_ascii_uppercase();
            let stem = upper.split('.').next().unwrap_or("");
            part.is_empty()
                || part == "."
                || part == ".."
                || part.ends_with('.')
                || part.ends_with(' ')
                || matches!(stem, "CON" | "PRN" | "AUX" | "NUL")
                || ((stem.starts_with("COM") || stem.starts_with("LPT"))
                    && stem.len() == 4
                    && stem.as_bytes()[3].is_ascii_digit()
                    && stem.as_bytes()[3] != b'0')
        });
    if unsafe_path {
        bail!("unsafe file path {path:?}");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn document(files: &[(&str, Option<&str>)]) -> String {
        let mut out = String::from("<code_map>\nfake <code>\n</code_map>\n\n<code>\n");
        for (i, (path, content)) in files.iter().enumerate() {
            if i > 0 {
                out.push('\n');
            }
            write_record(&mut out, path, *content);
        }
        out.push_str("</code>\n");
        out
    }

    #[test]
    fn round_trips_tricky_content_and_paths() {
        let files: Vec<(&str, Option<&str>)> = vec![
            ("empty.txt", Some("")),
            ("no-newline.txt", Some("last line")),
            ("newlines.txt", Some("one\n\n\n")),
            ("windows.txt", Some("alpha\r\nbeta\r\n")),
            (
                "unicode.txt",
                Some("\u{feff}Привіт 🌍\nline\u{2028}separator\n"),
            ),
            (
                "fences.md",
                Some("<file path=\"x\" bytes=\"1\">\n</file>\n</code>\n"),
            ),
            ("nested/a space [%] & \"q\" <ü>.txt", Some("some content\n")),
            ("big.bin", None),
        ];
        let parsed = parse(document(&files).as_bytes()).unwrap();
        let expected: Vec<Record> = files
            .iter()
            .map(|(path, content)| Record {
                path: path.to_string(),
                content: content.map(|c| c.as_bytes().to_vec()),
            })
            .collect();
        assert_eq!(parsed, expected);
    }

    #[test]
    fn content_line_counts() {
        assert_eq!(content_lines(""), 0);
        assert_eq!(content_lines("a"), 1);
        assert_eq!(content_lines("a\n"), 1);
        assert_eq!(content_lines("a\n\n"), 2);
        assert_eq!(content_lines("a\r\nb"), 2);
    }

    #[test]
    fn rejects_wrong_byte_counts_and_unsafe_paths() {
        let mut doc = document(&[("a.txt", Some("hello\n"))]);
        doc = doc.replace("bytes=\"6\"", "bytes=\"4\"");
        assert!(parse(doc.as_bytes()).is_err());
        for path in [
            "../x", "/abs", "a//b", "a\\b", "c:x", "nul.txt", "COM1", "dir/x.", "a ", "./a",
        ] {
            assert!(validate_path(path).is_err(), "{path} should be rejected");
        }
        for path in ["a/b.txt", ".env.example", "COM0", "console.log", "con-tact"] {
            assert!(validate_path(path).is_ok(), "{path} should be accepted");
        }
        let doc = document(&[("a", Some("x")), ("a/b", Some("y"))]);
        assert!(parse(doc.as_bytes()).is_err());
        let doc = document(&[("a", Some("x")), ("a", Some("y"))]);
        assert!(parse(doc.as_bytes()).is_err());
    }

    #[test]
    fn missing_code_section_is_an_error() {
        assert!(parse(b"<code_map>\nproject/\n</code_map>\n").is_err());
        assert!(parse(b"<code>\n</code>\n").is_err());
    }
}
