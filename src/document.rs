//! Assembling the packed document: prompt, code map and code, with exact line references.

use std::collections::BTreeMap;

use crate::archive::{self, CODE_CLOSE, CODE_OPEN, MAP_CLOSE, MAP_OPEN};
use crate::files::SourceFile;
use crate::outline::{self, Symbol};
use crate::units::format_size;

pub struct Options {
    pub prompt: Option<String>,
    pub map: bool,
    pub outline: bool,
    pub code: bool,
    pub sizes: bool,
    /// Wrap the map in `<code_map>` tags.
    pub tags: bool,
}

/// Inclusive 1-based line range of a file's content within the document.
type Range = (usize, usize);

pub fn render(project: &str, files: &[SourceFile], options: &Options) -> String {
    let mut sections: Vec<String> = Vec::new();
    if let Some(prompt) = &options.prompt {
        let mut prompt = prompt.clone();
        if !prompt.ends_with('\n') {
            prompt.push('\n');
        }
        sections.push(prompt);
    }

    let outlines: Vec<Vec<Symbol>> = files
        .iter()
        .map(
            |file| match (&file.content, options.map && options.outline) {
                (Some(content), true) => outline::outline(&file.path, content),
                _ => Vec::new(),
            },
        )
        .collect();
    let map = Map {
        project,
        files,
        outlines: &outlines,
        sizes: options.sizes,
        tags: options.tags,
    };

    if options.code {
        // The map's line count does not depend on the numbers it contains, so it can be
        // measured before the code section's positions are known.
        let map_lines = options.map.then(|| map.render(None).matches('\n').count());
        let mut preceding: usize = sections.iter().map(|s| s.matches('\n').count()).sum();
        preceding += map_lines.unwrap_or(0);
        let separators = sections.len() + usize::from(options.map);
        let code_open_line = preceding + separators + 1;

        let (code, ranges) = code_section(files, code_open_line);
        if options.map {
            let rendered = map.render(Some(&ranges));
            debug_assert_eq!(Some(rendered.matches('\n').count()), map_lines);
            sections.push(rendered);
        }
        sections.push(code);
    } else if options.map {
        sections.push(map.render(None));
    }
    sections.join("\n")
}

/// Render the `<code>` section, whose first line is document line `open_line`.
fn code_section(files: &[SourceFile], open_line: usize) -> (String, Vec<Option<Range>>) {
    let mut out = format!("{CODE_OPEN}\n");
    let mut line = open_line;
    let mut ranges = Vec::with_capacity(files.len());
    for (index, file) in files.iter().enumerate() {
        if index > 0 {
            out.push('\n');
            line += 1;
        }
        archive::write_record(&mut out, &file.path, file.content.as_deref());
        line += 1;
        let range = file.content.as_deref().and_then(|content| {
            let count = archive::content_lines(content);
            let range = (count > 0).then_some((line + 1, line + count));
            line += count + 1;
            range
        });
        ranges.push(range);
    }
    out.push_str(CODE_CLOSE);
    out.push('\n');
    (out, ranges)
}

struct Map<'a> {
    project: &'a str,
    files: &'a [SourceFile],
    outlines: &'a [Vec<Symbol>],
    sizes: bool,
    tags: bool,
}

#[derive(Default)]
struct Dir<'a> {
    entries: BTreeMap<&'a str, Node<'a>>,
}

enum Node<'a> {
    Dir(Dir<'a>),
    File(usize),
}

impl Map<'_> {
    fn render(&self, ranges: Option<&[Option<Range>]>) -> String {
        let mut root = Dir::default();
        for (index, file) in self.files.iter().enumerate() {
            let mut dir = &mut root;
            let mut parts = file.path.split('/').peekable();
            while let Some(part) = parts.next() {
                if parts.peek().is_none() {
                    dir.entries.insert(part, Node::File(index));
                } else {
                    let node = dir
                        .entries
                        .entry(part)
                        .or_insert_with(|| Node::Dir(Dir::default()));
                    dir = match node {
                        Node::Dir(dir) => dir,
                        Node::File(_) => {
                            unreachable!("a path cannot be both a file and a directory")
                        }
                    };
                }
            }
        }
        let mut out = String::new();
        if self.tags {
            out.push_str(MAP_OPEN);
            out.push('\n');
        }
        out.push_str(&format!("{}/\n", display_name(self.project)));
        self.render_dir(&mut out, &root, "", ranges);
        if self.tags {
            out.push_str(MAP_CLOSE);
            out.push('\n');
        }
        out
    }

    fn render_dir(
        &self,
        out: &mut String,
        dir: &Dir,
        prefix: &str,
        ranges: Option<&[Option<Range>]>,
    ) {
        let count = dir.entries.len();
        for (position, (name, node)) in dir.entries.iter().enumerate() {
            let (branch, child_prefix) = branch(prefix, position + 1 == count);
            match node {
                Node::Dir(child) => {
                    out.push_str(&format!("{prefix}{branch}{}/\n", display_name(name)));
                    self.render_dir(out, child, &child_prefix, ranges);
                }
                Node::File(index) => {
                    let file = &self.files[*index];
                    let range = ranges.and_then(|r| r[*index]);
                    let details = self.file_details(file, range, ranges.is_some());
                    out.push_str(&format!(
                        "{prefix}{branch}{} [{details}]\n",
                        display_name(name)
                    ));
                    let first_line = range.map(|(start, _)| start);
                    self.render_symbols(
                        out,
                        &self.outlines[*index],
                        &child_prefix,
                        first_line,
                        ranges.is_some(),
                    );
                }
            }
        }
    }

    fn file_details(&self, file: &SourceFile, range: Option<Range>, with_ml: bool) -> String {
        let mut parts = Vec::new();
        match file.content.as_deref() {
            None => parts.push("content omitted".to_string()),
            Some("") => return "empty".to_string(),
            Some(content) => {
                parts.push(format!("OL: 1-{}", archive::content_lines(content)));
                if with_ml {
                    let (start, end) = range.unwrap_or_default();
                    parts.push(format!("ML: {start}-{end}"));
                }
            }
        }
        if self.sizes {
            parts.push(format_size(file.size));
        }
        parts.join(" | ")
    }

    fn render_symbols(
        &self,
        out: &mut String,
        symbols: &[Symbol],
        prefix: &str,
        first_line: Option<usize>,
        with_ml: bool,
    ) {
        for (position, symbol) in symbols.iter().enumerate() {
            let (branch, child_prefix) = branch(prefix, position + 1 == symbols.len());
            let mut parts = vec![format!("OL: {}-{}", symbol.start, symbol.end)];
            if with_ml {
                let offset = first_line.unwrap_or(1) - 1;
                parts.push(format!(
                    "ML: {}-{}",
                    offset + symbol.start,
                    offset + symbol.end
                ));
            }
            if self.sizes {
                parts.push(format_size(symbol.bytes as u64));
            }
            out.push_str(&format!(
                "{prefix}{branch}{} [{}]\n",
                symbol.label,
                parts.join(" | ")
            ));
            self.render_symbols(out, &symbol.children, &child_prefix, first_line, with_ml);
        }
    }
}

fn branch(prefix: &str, last: bool) -> (&'static str, String) {
    if last {
        ("└── ", format!("{prefix}    "))
    } else {
        ("├── ", format!("{prefix}│   "))
    }
}

/// Map entries are single lines, so control characters in names are escaped.
fn display_name(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_control() {
                c.escape_default().to_string()
            } else {
                c.to_string()
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(path: &str, content: Option<&str>) -> SourceFile {
        SourceFile {
            path: path.to_string(),
            size: content.map_or(2048, |c| c.len() as u64),
            content: content.map(str::to_string),
        }
    }

    fn all_sections() -> Options {
        Options {
            prompt: Some("Prompt line one.\nPrompt line two.".to_string()),
            map: true,
            outline: true,
            code: true,
            sizes: true,
            tags: true,
        }
    }

    #[test]
    fn renders_the_expected_document() {
        let files = vec![
            file("src/lib.rs", Some("pub fn a() {\n    1;\n}\n")),
            file("src/empty.txt", Some("")),
            file("data.json", None),
            file("README.md", Some("# Title")),
        ];
        let mut sorted = files;
        sorted.sort_by(|a, b| a.path.split('/').cmp(b.path.split('/')));
        let doc = render("demo", &sorted, &all_sections());
        let expected = "\
Prompt line one.
Prompt line two.

<code_map>
demo/
├── README.md [OL: 1-1 | ML: 16-16 | 7B]
├── data.json [content omitted | 2KB]
└── src/
    ├── empty.txt [empty]
    └── lib.rs [OL: 1-3 | ML: 25-27 | 22B]
        └── fn a() [OL: 1-3 | ML: 25-27 | 22B]
</code_map>

<code>
<file path=\"README.md\" bytes=\"7\">
# Title
</file>

<file path=\"data.json\" omitted=\"true\" />

<file path=\"src/empty.txt\" bytes=\"0\">
</file>

<file path=\"src/lib.rs\" bytes=\"22\">
pub fn a() {
    1;
}
</file>
</code>
";
        assert_eq!(doc, expected);
    }

    #[test]
    fn sections_can_be_disabled() {
        let files = vec![file("a.py", Some("def f():\n    pass\n"))];
        let only_map = Options {
            prompt: None,
            code: false,
            sizes: false,
            ..all_sections()
        };
        assert_eq!(
            render("p", &files, &only_map),
            "<code_map>\np/\n└── a.py [OL: 1-2]\n    └── fn f() [OL: 1-2]\n</code_map>\n"
        );
        let untagged = Options {
            tags: false,
            ..only_map
        };
        assert_eq!(
            render("p", &files, &untagged),
            "p/\n└── a.py [OL: 1-2]\n    └── fn f() [OL: 1-2]\n"
        );
        let only_code = Options {
            prompt: None,
            map: false,
            ..all_sections()
        };
        assert_eq!(
            render("p", &files, &only_code),
            "<code>\n<file path=\"a.py\" bytes=\"18\">\ndef f():\n    pass\n</file>\n</code>\n"
        );
    }
}
