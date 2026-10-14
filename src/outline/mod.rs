//! Heuristic code outlines: classes, functions and other symbols with their line ranges.
//!
//! Outlines are approximate by design. They are produced with per-language regular
//! expressions plus lightweight scanners that skip comments and string literals when
//! looking for the end of a block. File contents are never altered by this module.

mod languages;
mod scan;

use regex::Captures;

/// A symbol found in a source file. Line numbers are 1-based and inclusive.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Symbol {
    pub label: String,
    pub start: usize,
    pub end: usize,
    pub bytes: usize,
    pub children: Vec<Symbol>,
}

/// How the extent of a symbol is determined once its first line is known.
#[derive(Debug, Clone, Copy)]
enum Block {
    /// `{ ... }`, skipping comments and strings.
    Braces,
    /// Python-style indentation.
    Indent,
    /// `... end` keywords (Ruby).
    Ruby,
    /// `... end` / `until` keywords (Lua).
    Lua,
    /// `do ... done` (shell loops).
    Shell,
    /// The symbol occupies only its first line.
    Line,
}

/// Comment and string syntax used by the brace scanner.
struct Syntax {
    line_comments: &'static [&'static str],
    block_comments: bool,
    /// Backtick strings may span multiple lines (JavaScript templates, Go raw strings).
    multiline_backticks: bool,
    /// `/.../` regular expression literals (JavaScript).
    regex_literals: bool,
    /// Double-quoted strings may span lines, and `r#"..."#` raw strings exist (Rust).
    rust_strings: bool,
}

/// Parameter list collected from a declaration, plus the text following its `)`.
#[derive(Default)]
struct Signature {
    params: String,
    after: String,
    close: Option<(usize, usize)>,
}

type Label = fn(&Captures, &Signature) -> Option<String>;

struct Rule {
    re: regex::Regex,
    block: Block,
    /// Minimum number of lines for the symbol to be reported (used to skip short loops).
    min_lines: usize,
    /// The pattern ends just after `(`; collect the balanced parameter list.
    params: bool,
    label: Label,
}

struct Language {
    syntax: Syntax,
    /// Only match rules on lines that start a statement (Python).
    statements_only: bool,
    rules: Vec<Rule>,
}

const MAX_LABEL_CHARS: usize = 120;

/// Return the nested outline of `content`, choosing a parser from the file extension.
pub fn outline(path: &str, content: &str) -> Vec<Symbol> {
    let extension = path
        .rsplit('/')
        .next()
        .and_then(|name| name.rsplit_once('.'))
        .map(|(_, ext)| ext.to_ascii_lowercase());
    let Some(language) = extension.as_deref().and_then(languages::for_extension) else {
        return Vec::new();
    };
    nest(flat_outline(language, content))
}

fn flat_outline(language: &Language, content: &str) -> Vec<Symbol> {
    let source = scan::Source::new(content);
    if source.is_empty() {
        return Vec::new();
    }
    let code_lines = if language.statements_only {
        scan::python_statement_starts(&source.text)
    } else {
        scan::code_line_starts(&source.text, &language.syntax)
    };

    let mut symbols = Vec::new();
    for (index, text) in source.text.iter().enumerate() {
        if !code_lines[index] {
            continue;
        }
        let trimmed = text.trim();
        if trimmed.is_empty() {
            continue;
        }
        let lead = text.len() - text.trim_start().len();
        for rule in &language.rules {
            let Some(captures) = rule.re.captures(trimmed) else {
                continue;
            };
            let signature = if rule.params {
                let open = lead + captures.get(0).map_or(0, |m| m.end());
                match scan::signature(&source.text, index, open) {
                    Some(signature) => signature,
                    None => continue,
                }
            } else {
                Signature::default()
            };
            let Some(label) = (rule.label)(&captures, &signature) else {
                continue;
            };
            let end = match rule.block {
                Block::Braces => {
                    let from = signature.close.unwrap_or((index, 0));
                    scan::brace_end(&source.text, from, &language.syntax)
                }
                Block::Indent => scan::indent_end(&source.text, index, &code_lines),
                Block::Ruby => scan::ruby_end(&source.text, index),
                Block::Lua => scan::lua_end(&source.text, index),
                Block::Shell => scan::shell_loop_end(&source.text, index),
                Block::Line => index,
            };
            let end = end.clamp(index, source.len() - 1);
            if end - index + 1 >= rule.min_lines {
                symbols.push(Symbol {
                    label: tidy_label(&label),
                    start: index + 1,
                    end: end + 1,
                    bytes: source.bytes(index, end),
                    children: Vec::new(),
                });
            }
            break;
        }
    }
    symbols
}

fn tidy_label(label: &str) -> String {
    let collapsed = label.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.chars().count() <= MAX_LABEL_CHARS {
        return collapsed;
    }
    let mut short: String = collapsed.chars().take(MAX_LABEL_CHARS - 1).collect();
    short.push('…');
    short
}

/// Nest symbols whose line range lies within another symbol's range.
fn nest(mut flat: Vec<Symbol>) -> Vec<Symbol> {
    flat.sort_by(|a, b| a.start.cmp(&b.start).then(b.end.cmp(&a.end)));
    let mut roots: Vec<Symbol> = Vec::new();
    let mut stack: Vec<Symbol> = Vec::new();
    for symbol in flat {
        while let Some(parent) = stack.last() {
            let inside = symbol.start >= parent.start
                && symbol.end <= parent.end
                && (symbol.start > parent.start || symbol.end < parent.end);
            if inside {
                break;
            }
            let done = stack.pop().expect("stack is not empty");
            attach(&mut stack, &mut roots, done);
        }
        stack.push(symbol);
    }
    while let Some(done) = stack.pop() {
        attach(&mut stack, &mut roots, done);
    }
    roots
}

fn attach(stack: &mut [Symbol], roots: &mut Vec<Symbol>, symbol: Symbol) {
    match stack.last_mut() {
        Some(parent) => parent.children.push(symbol),
        None => roots.push(symbol),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn labels(symbols: &[Symbol]) -> Vec<(String, usize, usize)> {
        let mut out = Vec::new();
        fn walk(symbols: &[Symbol], out: &mut Vec<(String, usize, usize)>) {
            for s in symbols {
                out.push((s.label.clone(), s.start, s.end));
                walk(&s.children, out);
            }
        }
        walk(symbols, &mut out);
        out
    }

    fn find(symbols: &[Symbol], prefix: &str) -> Symbol {
        fn walk<'a>(symbols: &'a [Symbol], prefix: &str) -> Option<&'a Symbol> {
            symbols.iter().find_map(|s| {
                if s.label.starts_with(prefix) {
                    Some(s)
                } else {
                    walk(&s.children, prefix)
                }
            })
        }
        walk(symbols, prefix)
            .cloned()
            .unwrap_or_else(|| panic!("no symbol {prefix:?} in {symbols:#?}"))
    }

    #[test]
    fn braces_in_strings_and_comments_are_ignored() {
        let content =
            "function example() {\n  const brace = \"}\";\n  /* } */\n  // }\n  return brace;\n}\n";
        let symbols = outline("a.js", content);
        let f = find(&symbols, "fn example");
        assert_eq!((f.start, f.end), (1, 6));
        assert_eq!(f.bytes, content.len());
    }

    #[test]
    fn destructured_parameters_do_not_end_the_block() {
        let content = "export function App({ title }) {\n  return title;\n}\n";
        let f = find(&outline("a.jsx", content), "fn App");
        assert_eq!(f.label, "fn App({ title })");
        assert_eq!((f.start, f.end), (1, 3));
    }

    #[test]
    fn multiline_signatures_are_collected() {
        let content = "pub fn build(\n    name: &str,\n    size: usize,\n) -> String {\n    String::new()\n}\n";
        let f = find(&outline("lib.rs", content), "fn build");
        assert_eq!(f.label, "fn build(name: &str, size: usize)");
        assert_eq!((f.start, f.end), (1, 6));
    }

    #[test]
    fn declarations_without_body_end_on_their_line() {
        let content = "pub struct Marker;\n\npub struct Point {\n    x: i32,\n}\n";
        let symbols = outline("lib.rs", content);
        assert_eq!(
            labels(&symbols),
            vec![
                ("struct Marker".into(), 1, 1),
                ("struct Point".into(), 3, 5)
            ]
        );
    }

    #[test]
    fn python_blocks_nest_and_skip_strings_and_comments() {
        let content = "class Greeter:\n    def __init__(self, name):\n        self.name = name\n\n# comment\n    def greet(\n        self,\n        loud: bool = False,\n    ) -> str:\n        text = \"\"\"\ndef fake():\n\"\"\"\n        return text\n\n\nasync def main() -> None:\n    pass\n";
        let symbols = outline("a.py", content);
        assert_eq!(
            labels(&symbols),
            vec![
                ("class Greeter".into(), 1, 13),
                ("fn __init__(self, name)".into(), 2, 3),
                ("fn greet(self, loud: bool = False) -> str".into(), 6, 13),
                ("async fn main() -> None".into(), 16, 17),
            ]
        );
    }

    #[test]
    fn python_signature_preserves_all_parameters() {
        let content = "def example(a=1, /, *args: str, flag=True, **kwargs) -> None:\n    pass\n";
        let f = find(&outline("a.py", content), "fn example");
        assert_eq!(
            f.label,
            "fn example(a=1, /, *args: str, flag=True, **kwargs) -> None"
        );
        assert_eq!((f.end, f.bytes), (2, content.len()));
    }

    #[test]
    fn javascript_classes_methods_and_tests() {
        let content = "class Store {\n  constructor(items) {\n    this.items = items;\n  }\n  async load() {\n    if (x) {\n    }\n  }\n}\ndescribe(\"store\", () => {\n  it(\"loads\", async () => {\n  });\n});\n";
        let symbols = outline("store.ts", content);
        assert_eq!(
            labels(&symbols),
            vec![
                ("class Store".into(), 1, 9),
                ("fn constructor(items)".into(), 2, 4),
                ("async fn load()".into(), 5, 8),
                ("describe store".into(), 10, 13),
                ("test loads".into(), 11, 12),
            ]
        );
    }

    #[test]
    fn short_loops_are_skipped_and_long_loops_reported() {
        let content = "fn main() {\n    for i in 0..3 {\n        a();\n        b();\n        c();\n        d();\n    }\n    while x { y(); }\n}\n";
        let symbols = outline("main.rs", content);
        assert_eq!(
            labels(&symbols),
            vec![("fn main()".into(), 1, 9), ("for i in 0..3".into(), 2, 7)]
        );
    }

    #[test]
    fn ruby_and_lua_keyword_blocks() {
        let ruby = "module Shop\n  class Cart\n    def add(item) = items << item\n    def total\n      items.each do |i|\n      end\n      if empty? then 0 end\n    end\n  end\nend\n";
        assert_eq!(
            labels(&outline("cart.rb", ruby)),
            vec![
                ("module Shop".into(), 1, 10),
                ("class Cart".into(), 2, 9),
                ("fn add(item)".into(), 3, 3),
                ("fn total".into(), 4, 8),
            ]
        );
        let lua = "local function f(a)\n  if a then return 1 end\n  for i = 1, 3 do\n  end\nend\nM.g = function(b)\nend\n";
        assert_eq!(
            labels(&outline("m.lua", lua)),
            vec![("fn f(a)".into(), 1, 5), ("fn M.g(b)".into(), 6, 7)]
        );
    }

    #[test]
    fn rust_multiline_and_raw_strings_are_skipped() {
        let content = "fn outer() {\n    let a = \"\nfn fake() {\n\";\n    let b = r#\"\n}\"#;\n}\nfn next() {}\n";
        assert_eq!(
            labels(&outline("lib.rs", content)),
            vec![("fn outer()".into(), 1, 7), ("fn next()".into(), 8, 8)]
        );
    }

    #[test]
    fn unknown_extensions_and_empty_files_have_no_outline() {
        assert!(outline("notes.txt", "class A {}\n").is_empty());
        assert!(outline("a.rs", "").is_empty());
    }

    #[test]
    fn crlf_lines_are_measured_in_bytes() {
        let content = "def a():\r\n    pass\r\n";
        let f = find(&outline("a.py", content), "fn a");
        assert_eq!((f.start, f.end, f.bytes), (1, 2, content.len()));
    }
}
