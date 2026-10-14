//! Line-oriented scanners used to find where symbols end.

use std::sync::LazyLock;

use regex::Regex;

use super::{Signature, Syntax};

/// A Ruby endless method: `def name(args) = expression`.
static RUBY_ENDLESS_DEF: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^def\s+[\w.]+[?!]?(?:\s*\(.*?\)\s*|\s+)=(?:[^=~>]|$)").expect("valid regex")
});

/// File content split into lines. A trailing newline does not start an extra line.
pub(super) struct Source<'a> {
    /// Lines without `\n`; a trailing `\r` is kept so byte sizes stay exact.
    raw: Vec<&'a str>,
    /// Lines without line terminators, with a leading byte order mark removed.
    pub text: Vec<&'a str>,
    trailing_newline: bool,
}

impl<'a> Source<'a> {
    pub fn new(content: &'a str) -> Self {
        let trailing_newline = content.ends_with('\n');
        let body = content.strip_suffix('\n').unwrap_or(content);
        let raw: Vec<&str> = if content.is_empty() {
            Vec::new()
        } else {
            body.split('\n').collect()
        };
        let text = raw
            .iter()
            .enumerate()
            .map(|(i, line)| {
                let line = line.strip_suffix('\r').unwrap_or(line);
                if i == 0 {
                    line.strip_prefix('\u{feff}').unwrap_or(line)
                } else {
                    line
                }
            })
            .collect();
        Self {
            raw,
            text,
            trailing_newline,
        }
    }

    pub fn len(&self) -> usize {
        self.raw.len()
    }

    pub fn is_empty(&self) -> bool {
        self.raw.is_empty()
    }

    /// UTF-8 size of lines `start..=end` (0-based), including their line terminators.
    pub fn bytes(&self, start: usize, end: usize) -> usize {
        (start..=end)
            .map(|i| {
                let newline = i + 1 < self.raw.len() || self.trailing_newline;
                self.raw[i].len() + usize::from(newline)
            })
            .sum()
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum State {
    Code,
    BlockComment,
    Quoted(u8),
    /// Inside a Rust raw string closed by `"` and this many `#`.
    Raw(usize),
}

/// Scan one line, calling `visit(byte)` for every byte that is code (outside comments and
/// strings). Returns the state at the end of the line.
fn lex_line(line: &str, mut state: State, syntax: &Syntax, mut visit: impl FnMut(u8)) -> State {
    let bytes = line.as_bytes();
    let mut previous: Option<u8> = None;
    let mut j = 0;
    while j < bytes.len() {
        let ch = bytes[j];
        match state {
            State::BlockComment => {
                if bytes[j..].starts_with(b"*/") {
                    state = State::Code;
                    j += 1;
                }
            }
            State::Raw(hashes) => {
                if ch == b'"' && bytes[j + 1..].iter().take_while(|&&b| b == b'#').count() >= hashes
                {
                    state = State::Code;
                    j += hashes;
                }
            }
            State::Quoted(quote) => {
                if ch == b'\\' {
                    j += 1;
                } else if ch == quote {
                    state = State::Code;
                }
            }
            State::Code => {
                if syntax.block_comments && bytes[j..].starts_with(b"/*") {
                    state = State::BlockComment;
                    j += 1;
                } else if starts_line_comment(bytes, j, syntax) {
                    break;
                } else if let Some(hashes) = raw_string_start(bytes, j, syntax) {
                    state = State::Raw(hashes);
                    j += hashes + 1;
                } else if let Some(end) = regex_literal_end(bytes, j, previous, syntax) {
                    j = end;
                    previous = Some(b'/');
                } else if ch == b'"'
                    || (ch == b'`' && syntax.multiline_backticks)
                    || (ch == b'\'' && bytes[j + 1..].contains(&b'\''))
                {
                    state = State::Quoted(ch);
                    previous = Some(ch);
                } else {
                    if !ch.is_ascii_whitespace() {
                        previous = Some(ch);
                    }
                    visit(ch);
                }
            }
        }
        j += 1;
    }
    match state {
        State::Quoted(b'"') if syntax.rust_strings => state,
        State::Quoted(b'`') if syntax.multiline_backticks => state,
        State::Quoted(_) => State::Code,
        State::Code | State::BlockComment | State::Raw(_) => state,
    }
}

/// If a Rust raw string (`r"`, `r#"`, `br#"`) starts at `j`, the number of `#` marks.
fn raw_string_start(bytes: &[u8], j: usize, syntax: &Syntax) -> Option<usize> {
    let identifier = |b: u8| b.is_ascii_alphanumeric() || b == b'_';
    if !syntax.rust_strings || bytes[j] != b'r' {
        return None;
    }
    let standalone = match j {
        0 => true,
        _ if bytes[j - 1] == b'b' => j < 2 || !identifier(bytes[j - 2]),
        _ => !identifier(bytes[j - 1]),
    };
    let hashes = bytes[j + 1..].iter().take_while(|&&b| b == b'#').count();
    (standalone && bytes.get(j + 1 + hashes) == Some(&b'"')).then_some(hashes)
}

/// If a JavaScript regular expression literal starts at `j`, the index of its closing `/`.
fn regex_literal_end(
    bytes: &[u8],
    j: usize,
    previous: Option<u8>,
    syntax: &Syntax,
) -> Option<usize> {
    let starts_operand = previous.is_none_or(|p| b"(,=:[!&|?{};~+-*%<>^".contains(&p));
    if !syntax.regex_literals || bytes[j] != b'/' || !starts_operand {
        return None;
    }
    let mut in_class = false;
    let mut k = j + 1;
    while k < bytes.len() {
        match bytes[k] {
            b'\\' => k += 1,
            b'[' => in_class = true,
            b']' => in_class = false,
            b'/' if !in_class => return Some(k),
            _ => {}
        }
        k += 1;
    }
    None
}

fn starts_line_comment(bytes: &[u8], j: usize, syntax: &Syntax) -> bool {
    syntax.line_comments.iter().any(|marker| {
        bytes[j..].starts_with(marker.as_bytes())
            && (*marker != "#" || j == 0 || bytes[j - 1].is_ascii_whitespace())
    })
}

/// For each line, whether it starts outside block comments and multi-line strings.
pub(super) fn code_line_starts(lines: &[&str], syntax: &Syntax) -> Vec<bool> {
    let mut state = State::Code;
    lines
        .iter()
        .map(|line| {
            let starts_in_code = state == State::Code;
            state = lex_line(line, state, syntax, |_| {});
            starts_in_code
        })
        .collect()
}

/// For each line, whether it starts a Python statement (not inside brackets, a
/// triple-quoted string, or after a backslash continuation).
pub(super) fn python_statement_starts(lines: &[&str]) -> Vec<bool> {
    let mut depth = 0usize;
    let mut triple: Option<u8> = None;
    let mut continued = false;
    let mut starts = Vec::with_capacity(lines.len());
    for line in lines {
        starts.push(triple.is_none() && depth == 0 && !continued);
        continued = false;
        let bytes = line.as_bytes();
        let mut j = 0;
        while j < bytes.len() {
            let ch = bytes[j];
            if let Some(quote) = triple {
                if bytes[j..].starts_with(&[quote; 3]) {
                    triple = None;
                    j += 3;
                    continue;
                }
                if ch == b'\\' {
                    j += 1;
                }
                j += 1;
                continue;
            }
            match ch {
                b'#' => break,
                b'"' | b'\'' if bytes[j..].starts_with(&[ch; 3]) => {
                    triple = Some(ch);
                    j += 3;
                    continue;
                }
                b'"' | b'\'' => {
                    j += 1;
                    while j < bytes.len() && bytes[j] != ch {
                        if bytes[j] == b'\\' {
                            j += 1;
                        }
                        j += 1;
                    }
                }
                b'(' | b'[' | b'{' => depth += 1,
                b')' | b']' | b'}' => depth = depth.saturating_sub(1),
                b'\\' if j + 1 == bytes.len() => continued = true,
                _ => {}
            }
            j += 1;
        }
    }
    starts
}

/// Collect a balanced parameter list that starts just after `(` at `lines[line][col..]`.
pub(super) fn signature(lines: &[&str], line: usize, col: usize) -> Option<Signature> {
    const MAX_SIGNATURE_LINES: usize = 64;
    let mut depth = 1usize;
    let mut params = String::new();
    let mut in_string = false;
    for (offset, text) in lines[line..].iter().take(MAX_SIGNATURE_LINES).enumerate() {
        let start = if offset == 0 { col } else { 0 };
        let segment = text.get(start..)?;
        for (pos, ch) in segment.char_indices() {
            match ch {
                '"' => in_string = !in_string,
                '(' if !in_string => depth += 1,
                ')' if !in_string => {
                    depth -= 1;
                    if depth == 0 {
                        let mut params = params.split_whitespace().collect::<Vec<_>>().join(" ");
                        params = params.replace("( ", "(").replace(" )", ")");
                        let params = params.trim_end_matches(',').to_string();
                        let close = start + pos + 1;
                        return Some(Signature {
                            params,
                            after: segment[pos + 1..].to_string(),
                            close: Some((line + offset, close)),
                        });
                    }
                }
                _ => {}
            }
            params.push(ch);
        }
        params.push(' ');
    }
    None
}

/// End line of a `{ ... }` block whose declaration starts at `from` (line, byte column).
///
/// A declaration that reaches `;` or a line that cannot continue it before any `{` is
/// treated as having no body and ends on that line.
pub(super) fn brace_end(lines: &[&str], from: (usize, usize), syntax: &Syntax) -> usize {
    let (first, col) = from;
    let mut depth = 0usize;
    let mut opened = false;
    let mut parens = 0isize;
    let mut state = State::Code;
    for i in first..lines.len() {
        let line = if i == first {
            lines[i].get(col..).unwrap_or("")
        } else {
            lines[i]
        };
        let mut closed = false;
        let mut last = None;
        state = lex_line(line, state, syntax, |ch| {
            if closed {
                return;
            }
            match ch {
                b'{' => {
                    depth += 1;
                    opened = true;
                }
                b'}' if opened => {
                    depth -= 1;
                    closed = depth == 0;
                }
                b'(' => parens += 1,
                b')' => parens -= 1,
                _ => {}
            }
            if !ch.is_ascii_whitespace() {
                last = Some(ch);
            }
        });
        if closed {
            return i;
        }
        if !opened && parens <= 0 && state == State::Code {
            if last == Some(b';') {
                return i;
            }
            if !declaration_continues(lines, i) {
                return i;
            }
        }
    }
    lines.len() - 1
}

fn declaration_continues(lines: &[&str], i: usize) -> bool {
    const TAILS: &[&str] = &[",", "(", "=", "=>", "->", ":", "|", "&", "+", "where"];
    const HEADS: &[&str] = &[
        "{",
        "where",
        "->",
        "=>",
        ":",
        "throws",
        ".",
        "extends",
        "implements",
        ")",
        "&",
        "|",
        "+",
    ];
    let tail = lines[i].trim_end();
    if tail.is_empty() || TAILS.iter().any(|t| tail.ends_with(t)) {
        return true;
    }
    lines[i + 1..]
        .iter()
        .map(|line| line.trim())
        .find(|line| !line.is_empty())
        .is_some_and(|next| HEADS.iter().any(|h| next.starts_with(h)))
}

fn indent(line: &str) -> usize {
    line.len() - line.trim_start().len()
}

/// End line of an indentation block (Python). Comments at or below the block's own
/// indentation do not extend it.
pub(super) fn indent_end(lines: &[&str], start: usize, statements: &[bool]) -> usize {
    let base = indent(lines[start]);
    let mut last = start;
    for i in start + 1..lines.len() {
        let trimmed = lines[i].trim();
        if trimmed.is_empty() {
            continue;
        }
        if statements[i] && indent(lines[i]) <= base {
            if trimmed.starts_with('#') {
                continue;
            }
            break;
        }
        last = i;
    }
    last
}

/// A word in a line of code, with the nearest non-space byte before it and the byte after.
struct Word<'a> {
    text: &'a str,
    before: Option<u8>,
    after: Option<u8>,
    first: bool,
}

/// Words outside string literals and comments, for keyword-based block languages.
fn words<'a>(line: &'a str, comment: &str) -> Vec<Word<'a>> {
    let bytes = line.as_bytes();
    let mut out = Vec::new();
    let mut j = 0;
    let mut before = None;
    while j < bytes.len() {
        let ch = bytes[j];
        if bytes[j..].starts_with(comment.as_bytes()) {
            break;
        }
        if ch == b'"' || ch == b'\'' {
            j += 1;
            while j < bytes.len() && bytes[j] != ch {
                if bytes[j] == b'\\' {
                    j += 1;
                }
                j += 1;
            }
            before = Some(ch);
            j += 1;
            continue;
        }
        if ch.is_ascii_alphabetic() || ch == b'_' {
            let start = j;
            while j < bytes.len() && (bytes[j].is_ascii_alphanumeric() || bytes[j] == b'_') {
                j += 1;
            }
            if j < bytes.len() && matches!(bytes[j], b'?' | b'!') {
                j += 1;
            }
            out.push(Word {
                text: &line[start..j],
                before,
                after: bytes.get(j).copied(),
                first: out.is_empty() && before.is_none(),
            });
            before = Some(b'a');
            continue;
        }
        if !ch.is_ascii_whitespace() {
            before = Some(ch);
        }
        j += 1;
    }
    out
}

/// End line of a Ruby block opened at `start`.
pub(super) fn ruby_end(lines: &[&str], start: usize) -> usize {
    if RUBY_ENDLESS_DEF.is_match(lines[start].trim()) {
        return start;
    }
    let mut depth = 0isize;
    for (i, line) in lines.iter().enumerate().skip(start) {
        let mut loop_line = false;
        let endless_def = RUBY_ENDLESS_DEF.is_match(line.trim());
        for word in words(line, "#") {
            if word.before == Some(b'.') || word.before == Some(b':') || word.after == Some(b':') {
                continue;
            }
            let statement_start = word.first
                || matches!(
                    word.before,
                    Some(b'=' | b'(' | b';' | b'|' | b'&' | b',' | b'[')
                );
            match word.text {
                "def" if endless_def => {}
                "class" | "module" | "def" | "begin" | "case" => depth += 1,
                "do" if !loop_line => depth += 1,
                "while" | "until" | "for" if statement_start => {
                    depth += 1;
                    loop_line = true;
                }
                "if" | "unless" if statement_start => depth += 1,
                "end" => {
                    depth -= 1;
                    if depth <= 0 {
                        return i;
                    }
                }
                _ => {}
            }
        }
    }
    lines.len() - 1
}

/// End line of a Lua block opened at `start`.
pub(super) fn lua_end(lines: &[&str], start: usize) -> usize {
    let mut depth = 0isize;
    for (i, line) in lines.iter().enumerate().skip(start) {
        for word in words(line, "--") {
            if word.before == Some(b'.') || word.before == Some(b':') {
                continue;
            }
            match word.text {
                "function" | "if" | "do" | "repeat" => depth += 1,
                "end" | "until" => {
                    depth -= 1;
                    if depth <= 0 {
                        return i;
                    }
                }
                _ => {}
            }
        }
    }
    lines.len() - 1
}

/// End line of a shell `for`/`while`/`until` loop opened at `start`.
pub(super) fn shell_loop_end(lines: &[&str], start: usize) -> usize {
    let mut depth = 0isize;
    for (i, line) in lines.iter().enumerate().skip(start) {
        for word in words(line, "#") {
            match word.text {
                "do" => depth += 1,
                "done" => {
                    depth -= 1;
                    if depth <= 0 {
                        return i;
                    }
                }
                _ => {}
            }
        }
    }
    lines.len() - 1
}
