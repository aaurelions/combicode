//! Per-language outline rules. Patterns match a trimmed line; the first matching rule wins.

use std::sync::LazyLock;

use regex::{Captures, Regex};

use super::{Block, Label, Language, Rule, Signature, Syntax};

/// Loops shorter than this are not worth listing in the map.
const MIN_LOOP_LINES: usize = 6;

const C_LIKE: Syntax = Syntax {
    line_comments: &["//"],
    block_comments: true,
    multiline_backticks: false,
    regex_literals: false,
    rust_strings: false,
};
const JAVASCRIPT: Syntax = Syntax {
    line_comments: &["//"],
    block_comments: true,
    multiline_backticks: true,
    regex_literals: true,
    rust_strings: false,
};
const GO: Syntax = Syntax {
    line_comments: &["//"],
    block_comments: true,
    multiline_backticks: true,
    regex_literals: false,
    rust_strings: false,
};
const RUST: Syntax = Syntax {
    line_comments: &["//"],
    block_comments: true,
    multiline_backticks: false,
    regex_literals: false,
    rust_strings: true,
};
const PHP: Syntax = Syntax {
    line_comments: &["//", "#"],
    block_comments: true,
    multiline_backticks: false,
    regex_literals: false,
    rust_strings: false,
};
const HASH: Syntax = Syntax {
    line_comments: &["#"],
    block_comments: false,
    multiline_backticks: false,
    regex_literals: false,
    rust_strings: false,
};
const LUA: Syntax = Syntax {
    line_comments: &["--"],
    block_comments: false,
    multiline_backticks: false,
    regex_literals: false,
    rust_strings: false,
};

pub(super) fn for_extension(extension: &str) -> Option<&'static Language> {
    let language: &LazyLock<Language> = match extension {
        "py" | "pyi" => &PYTHON_RULES,
        "js" | "jsx" | "mjs" | "cjs" | "ts" | "tsx" | "mts" | "cts" => &JAVASCRIPT_RULES,
        "go" => &GO_RULES,
        "rs" => &RUST_RULES,
        "java" => &JAVA_RULES,
        "c" | "h" | "cc" | "cpp" | "cxx" | "hh" | "hpp" | "hxx" => &C_RULES,
        "cs" => &CSHARP_RULES,
        "php" => &PHP_RULES,
        "rb" => &RUBY_RULES,
        "swift" => &SWIFT_RULES,
        "kt" | "kts" => &KOTLIN_RULES,
        "scala" | "sc" => &SCALA_RULES,
        "lua" => &LUA_RULES,
        "pl" | "pm" => &PERL_RULES,
        "sh" | "bash" | "zsh" => &SHELL_RULES,
        _ => return None,
    };
    Some(language)
}

impl Rule {
    fn new(pattern: &str, block: Block, label: Label) -> Self {
        Self {
            re: Regex::new(pattern).unwrap_or_else(|e| panic!("invalid pattern {pattern}: {e}")),
            block,
            min_lines: 1,
            params: false,
            label,
        }
    }

    /// The pattern ends with `\(`; collect the parameter list that follows.
    fn with_params(mut self) -> Self {
        self.params = true;
        self
    }

    fn min_lines(mut self, lines: usize) -> Self {
        self.min_lines = lines;
        self
    }
}

fn group<'a>(captures: &'a Captures, index: usize) -> &'a str {
    captures.get(index).map_or("", |m| m.as_str())
}

fn is_keyword(name: &str, keywords: &[&str]) -> bool {
    keywords.contains(&name)
}

/// `[async ]fn name(params)`.
fn function(name: &str, asynchronous: bool, signature: &Signature) -> String {
    let prefix = if asynchronous { "async fn" } else { "fn" };
    format!("{prefix} {name}({})", signature.params)
}

/// A loop label such as `for x in items`, without a trailing `{`, `:` or `do`.
fn loop_label(keyword: &str, rest: &str) -> String {
    let rest = rest.trim().trim_end_matches('{').trim_end();
    if rest.is_empty() {
        keyword.to_string()
    } else {
        format!("{keyword} {rest}")
    }
}

fn kind_and_name(c: &Captures, _: &Signature) -> Option<String> {
    Some(format!("{} {}", group(c, 1), group(c, 2)))
}

fn parenthesized_loop(c: &Captures, s: &Signature) -> Option<String> {
    Some(format!("{} ({})", group(c, 1), s.params))
}

static PYTHON_RULES: LazyLock<Language> = LazyLock::new(|| Language {
    syntax: HASH,
    statements_only: true,
    rules: vec![
        Rule::new(r"^class\s+(\w+)", Block::Indent, |c, _| {
            Some(format!("class {}", group(c, 1)))
        }),
        Rule::new(
            r"^(async\s+)?def\s+(\w+)\s*(?:\[[^\]]*\])?\s*\(",
            Block::Indent,
            |c, s| {
                let returns = s
                    .after
                    .trim()
                    .strip_prefix("->")
                    .and_then(|rest| rest.rsplit_once(':'))
                    .map(|(annotation, _)| format!(" -> {}", annotation.trim()))
                    .unwrap_or_default();
                Some(function(group(c, 2), c.get(1).is_some(), s) + &returns)
            },
        )
        .with_params(),
        Rule::new(
            r"^(async\s+)?(for|while)\s+(.+?):\s*(?:#.*)?$",
            Block::Indent,
            |c, _| Some(loop_label(group(c, 2), group(c, 3))),
        )
        .min_lines(MIN_LOOP_LINES),
    ],
});

static JS_FUNCTION_BODY: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^\s*(?::[^{=;]+)?(?:=>\s*[{(]|\{)").expect("valid regex"));
static JS_METHOD_BODY: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^\s*(?::[^{;=]+)?\{").expect("valid regex"));

const JS_NOT_METHODS: &[&str] = &[
    "if", "for", "while", "switch", "catch", "function", "return", "with", "else", "do", "typeof",
    "await", "new", "super", "delete", "void", "yield",
];

static JAVASCRIPT_RULES: LazyLock<Language> = LazyLock::new(|| {
    Language {
    syntax: JAVASCRIPT,
    statements_only: false,
    rules: vec![
        Rule::new(
            r"^(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(class|interface)\s+([\w$]+)",
            Block::Braces,
            kind_and_name,
        ),
        Rule::new(
            r"^(?:export\s+)?(?:declare\s+)?(?:const\s+)?(enum|namespace)\s+([\w$.]+)",
            Block::Braces,
            kind_and_name,
        ),
        Rule::new(
            r#"^(?:describe|suite)(?:\.\w+)?\s*\(\s*(['"`])(.*?)['"`]"#,
            Block::Braces,
            |c, _| Some(format!("describe {}", group(c, 2))),
        ),
        Rule::new(
            r#"^(?:it|test)(?:\.\w+)?\s*\(\s*(['"`])(.*?)['"`]"#,
            Block::Braces,
            |c, _| Some(format!("test {}", group(c, 2))),
        ),
        Rule::new(
            r"^(?:export\s+)?(?:default\s+)?(?:declare\s+)?(async\s+)?function\s*\*?\s*([\w$]+)\s*(?:<[^>]*>)?\s*\(",
            Block::Braces,
            |c, s| Some(function(group(c, 2), c.get(1).is_some(), s)),
        )
        .with_params(),
        Rule::new(
            r"^(?:export\s+)?(?:const|let|var)\s+([\w$]+)\s*(?::[^=]+)?=\s*(async\s+)?(?:function\b\s*\*?\s*[\w$]*\s*)?(?:<[^>]*>\s*)?\(",
            Block::Braces,
            |c, s| {
                JS_FUNCTION_BODY
                    .is_match(&s.after)
                    .then(|| function(group(c, 1), c.get(2).is_some(), s))
            },
        )
        .with_params(),
        Rule::new(
            r"^(?:export\s+)?(?:const|let|var)\s+([\w$]+)\s*=\s*(async\s+)?([\w$]+)\s*=>\s*[{(]",
            Block::Braces,
            |c, _| {
                let prefix = if c.get(2).is_some() { "async fn" } else { "fn" };
                Some(format!("{prefix} {}({})", group(c, 1), group(c, 3)))
            },
        ),
        Rule::new(r"^(for|while)\s*(?:await\s*)?\(", Block::Braces, parenthesized_loop)
            .with_params()
            .min_lines(MIN_LOOP_LINES),
        Rule::new(
            r"^((?:(?:public|private|protected|static|readonly|override|abstract|async|get|set|declare)\s+)*)\*?\s*(#?[\w$]+)\s*(?:<[^>]*>)?\s*\(",
            Block::Braces,
            |c, s| {
                let name = group(c, 2);
                if is_keyword(name, JS_NOT_METHODS) || !JS_METHOD_BODY.is_match(&s.after) {
                    return None;
                }
                let asynchronous = group(c, 1).split_whitespace().any(|m| m == "async");
                Some(function(name, asynchronous, s))
            },
        )
        .with_params(),
    ],
}
});

static GO_RULES: LazyLock<Language> = LazyLock::new(|| Language {
    syntax: GO,
    statements_only: false,
    rules: vec![
        Rule::new(
            r"^type\s+(\w+)(?:\[[^\]]*\])?\s+(struct|interface)\b",
            Block::Braces,
            |c, _| Some(format!("{} {}", group(c, 2), group(c, 1))),
        ),
        Rule::new(
            r"^func\s+(?:(\([^)]*\))\s*)?(\w+)\s*(?:\[[^\]]*\])?\s*\(",
            Block::Braces,
            |c, s| {
                let receiver = c
                    .get(1)
                    .map(|m| format!("{} ", m.as_str()))
                    .unwrap_or_default();
                Some(format!("fn {receiver}{}({})", group(c, 2), s.params))
            },
        )
        .with_params(),
        Rule::new(r"^for\b(.*)\{\s*$", Block::Braces, |c, _| {
            Some(loop_label("for", group(c, 1)))
        })
        .min_lines(MIN_LOOP_LINES),
    ],
});

static RUST_RULES: LazyLock<Language> = LazyLock::new(|| {
    Language {
    syntax: RUST,
    statements_only: false,
    rules: vec![
        Rule::new(
            r"^(?:pub(?:\([^)]*\))?\s+)?(?:unsafe\s+)?(struct|enum|union|trait)\s+(\w+)",
            Block::Braces,
            kind_and_name,
        ),
        Rule::new(r"^(?:unsafe\s+)?impl\b(.*)", Block::Braces, |c, _| {
            let rest = group(c, 1);
            let rest = rest.split(" where").next().unwrap_or(rest);
            Some(format!("impl{}", rest.trim_end().trim_end_matches('{').trim_end()))
        }),
        Rule::new(
            r"^(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*\{",
            Block::Braces,
            |c, _| Some(format!("mod {}", group(c, 1))),
        ),
        Rule::new(r"^macro_rules!\s*(\w+)", Block::Braces, |c, _| {
            Some(format!("macro {}!", group(c, 1)))
        }),
        Rule::new(
            r#"^(?:pub(?:\([^)]*\))?\s+)?(?:default\s+)?(?:const\s+)?(async\s+)?(?:unsafe\s+)?(?:extern\s+"[^"]*"\s+)?fn\s+(\w+)\s*(?:<.*?>)?\s*\("#,
            Block::Braces,
            |c, s| Some(function(group(c, 2), c.get(1).is_some(), s)),
        )
        .with_params(),
        Rule::new(
            r"^(?:'\w+:\s*)?(for|while|loop)\b(.*)$",
            Block::Braces,
            |c, _| Some(loop_label(group(c, 1), group(c, 2))),
        )
        .min_lines(MIN_LOOP_LINES),
    ],
}
});

static JAVA_METHOD_TAIL: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^\s*(?:throws\b[^{;]*)?(?:\{.*)?$").expect("valid regex"));
const JAVA_NOT_METHODS: &[&str] = &[
    "if",
    "for",
    "while",
    "switch",
    "catch",
    "return",
    "new",
    "else",
    "synchronized",
    "try",
    "this",
    "super",
    "throw",
];

static JAVA_RULES: LazyLock<Language> = LazyLock::new(|| {
    Language {
    syntax: C_LIKE,
    statements_only: false,
    rules: vec![
        Rule::new(
            r"^(?:@\w+\s+)*(?:(?:public|private|protected|static|abstract|final|sealed|non-sealed|strictfp)\s+)*(class|interface|enum|record|@interface)\s+(\w+)",
            Block::Braces,
            kind_and_name,
        ),
        Rule::new(r"^(for|while)\s*\(", Block::Braces, parenthesized_loop)
            .with_params()
            .min_lines(MIN_LOOP_LINES),
        Rule::new(
            r"^(?:@\w+\s+)*(?:(?:public|private|protected|static|abstract|final|synchronized|native|default|strictfp)\s+)*(?:<[^>]+>\s+)?(?:[\w<>\[\],.?]+(?:\s*<[^>]*>)?\s+)?(\w+)\s*\(",
            Block::Braces,
            |c, s| {
                let name = group(c, 1);
                (!is_keyword(name, JAVA_NOT_METHODS) && JAVA_METHOD_TAIL.is_match(&s.after))
                    .then(|| function(name, false, s))
            },
        )
        .with_params(),
    ],
}
});

static C_FUNCTION_TAIL: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^\s*(?:const\s*)?(?:noexcept\s*)?(?:override\s*)?(?:final\s*)?(?:->\s*[^{;]+)?(?::.*)?(?:\{.*)?$")
        .expect("valid regex")
});
const C_NOT_FUNCTIONS: &[&str] = &[
    "if", "for", "while", "switch", "return", "sizeof", "else", "do", "case", "delete", "new",
];

static C_RULES: LazyLock<Language> = LazyLock::new(|| Language {
    syntax: C_LIKE,
    statements_only: false,
    rules: vec![
        Rule::new(
            r"^(?:template\s*<.*>\s*)?(?:typedef\s+)?(class|struct|union|enum(?:\s+class)?|namespace)\s+(\w+)[^;]*$",
            Block::Braces,
            kind_and_name,
        ),
        Rule::new(r"^(for|while)\s*\(", Block::Braces, parenthesized_loop)
            .with_params()
            .min_lines(MIN_LOOP_LINES),
        Rule::new(
            r"^(?:template\s*<.*>\s*)?(?:[\w:<>,]+[\s*&]+)+(~?[\w:]+)\s*\(",
            Block::Braces,
            |c, s| {
                let name = group(c, 1);
                (!is_keyword(name, C_NOT_FUNCTIONS) && C_FUNCTION_TAIL.is_match(&s.after))
                    .then(|| function(name, false, s))
            },
        )
        .with_params(),
    ],
});

static CSHARP_METHOD_TAIL: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^\s*(?::\s*(?:base|this)\s*\(.*\)\s*)?(?:where\b[^{;]*)?(?:\{.*|=>.*)?$")
        .expect("valid regex")
});
const CSHARP_NOT_METHODS: &[&str] = &[
    "if", "for", "foreach", "while", "switch", "catch", "using", "lock", "return", "new", "nameof",
    "typeof", "sizeof", "fixed", "else", "await", "throw",
];

static CSHARP_RULES: LazyLock<Language> = LazyLock::new(|| {
    Language {
    syntax: C_LIKE,
    statements_only: false,
    rules: vec![
        Rule::new(
            r"^(?:\[.*\]\s*)?(?:(?:public|private|protected|internal|static|abstract|sealed|partial|readonly|ref|unsafe|file)\s+)*(class|struct|interface|enum|record(?:\s+struct|\s+class)?|namespace)\s+([\w.]+)",
            Block::Braces,
            kind_and_name,
        ),
        Rule::new(r"^(for|foreach|while)\s*\(", Block::Braces, parenthesized_loop)
            .with_params()
            .min_lines(MIN_LOOP_LINES),
        Rule::new(
            r"^((?:(?:public|private|protected|internal|static|virtual|override|abstract|sealed|async|extern|unsafe|new|partial|readonly)\s+)*)(?:[\w<>\[\],.?]+\s+)?(\w+)\s*(?:<[^>]*>)?\s*\(",
            Block::Braces,
            |c, s| {
                let name = group(c, 2);
                if is_keyword(name, CSHARP_NOT_METHODS) || !CSHARP_METHOD_TAIL.is_match(&s.after)
                {
                    return None;
                }
                let asynchronous = group(c, 1).split_whitespace().any(|m| m == "async");
                Some(function(name, asynchronous, s))
            },
        )
        .with_params(),
    ],
}
});

static PHP_RULES: LazyLock<Language> =
    LazyLock::new(|| Language {
        syntax: PHP,
        statements_only: false,
        rules: vec![
        Rule::new(
            r"^(?:(?:abstract|final|readonly)\s+)*(class|interface|trait|enum)\s+(\w+)",
            Block::Braces,
            kind_and_name,
        ),
        Rule::new(
            r"^(?:(?:public|private|protected|static|abstract|final)\s+)*function\s+&?(\w+)\s*\(",
            Block::Braces,
            |c, s| Some(function(group(c, 1), false, s)),
        )
        .with_params(),
        Rule::new(r"^(for|foreach|while)\s*\(", Block::Braces, parenthesized_loop)
            .with_params()
            .min_lines(MIN_LOOP_LINES),
    ],
    });

static RUBY_RULES: LazyLock<Language> = LazyLock::new(|| Language {
    syntax: HASH,
    statements_only: false,
    rules: vec![
        Rule::new(r"^(class|module)\s+([\w:]+)", Block::Ruby, kind_and_name),
        Rule::new(
            r"^def\s+((?:self\.)?\w+[?!=]?)\s*(\(.*?\))?",
            Block::Ruby,
            |c, _| Some(format!("fn {}{}", group(c, 1), group(c, 2))),
        ),
        Rule::new(
            r#"^(?:RSpec\.)?(?:describe|context)\s+['"]?(.*?)['"]?\s+do\b"#,
            Block::Ruby,
            |c, _| Some(format!("describe {}", group(c, 1))),
        ),
        Rule::new(r#"^it\s+['"](.*?)['"]\s+do\b"#, Block::Ruby, |c, _| {
            Some(format!("test {}", group(c, 1)))
        }),
    ],
});

static SWIFT_RULES: LazyLock<Language> = LazyLock::new(|| {
    Language {
    syntax: C_LIKE,
    statements_only: false,
    rules: vec![
        Rule::new(
            r"^(?:@\w+\s+)*(?:(?:public|private|internal|open|fileprivate|final|indirect)\s+)*(class|struct|enum|protocol|extension|actor)\s+([\w.]+)",
            Block::Braces,
            kind_and_name,
        ),
        Rule::new(
            r"^(?:@\w+\s+)*(?:(?:public|private|internal|open|fileprivate|static|class|override|final|mutating|nonisolated)\s+)*func\s+([^\s(<]+)\s*(?:<[^>]*>)?\s*\(",
            Block::Braces,
            |c, s| {
                let asynchronous = s.after.split_whitespace().any(|w| w == "async");
                Some(function(group(c, 1), asynchronous, s))
            },
        )
        .with_params(),
        Rule::new(
            r"^(?:(?:public|private|internal|open|fileprivate|required|convenience|override)\s+)*(init[?!]?)\s*\(",
            Block::Braces,
            |c, s| Some(format!("{}({})", group(c, 1), s.params)),
        )
        .with_params(),
        Rule::new(r"^(for|while)\s+(.+?)\s*\{", Block::Braces, |c, _| {
            Some(loop_label(group(c, 1), group(c, 2)))
        })
        .min_lines(MIN_LOOP_LINES),
    ],
}
});

static KOTLIN_RULES: LazyLock<Language> = LazyLock::new(|| {
    Language {
    syntax: C_LIKE,
    statements_only: false,
    rules: vec![
        Rule::new(
            r"^(?:(?:public|private|protected|internal|open|abstract|sealed|data|enum|inner|annotation|value|final)\s+)*(class|interface|object)\s+(\w+)",
            Block::Braces,
            kind_and_name,
        ),
        Rule::new(r"^companion\s+object\b", Block::Braces, |_, _| {
            Some("companion object".to_string())
        }),
        Rule::new(
            r"^((?:(?:public|private|protected|internal|open|override|abstract|final|suspend|inline|operator|infix|tailrec|external)\s+)*)fun\s+(?:<[^>]*>\s*)?(?:[\w.<>]+\.)?(\w+)\s*\(",
            Block::Braces,
            |c, s| {
                let suspending = group(c, 1).split_whitespace().any(|m| m == "suspend");
                Some(function(group(c, 2), suspending, s))
            },
        )
        .with_params(),
        Rule::new(r"^(for|while)\s*\(", Block::Braces, parenthesized_loop)
            .with_params()
            .min_lines(MIN_LOOP_LINES),
    ],
}
});

static SCALA_RULES: LazyLock<Language> = LazyLock::new(|| Language {
    syntax: C_LIKE,
    statements_only: false,
    rules: vec![
        Rule::new(
            r"^(?:(?:final|sealed|abstract|implicit|private|protected|case|lazy)\s+)*(class|object|trait|enum)\s+(\w+)",
            Block::Braces,
            kind_and_name,
        ),
        Rule::new(
            r"^(?:(?:override|private|protected|final|implicit|inline)\s+)*def\s+(\w+)\s*(?:\[[^\]]*\])?(\(.*?\))?",
            Block::Braces,
            |c, _| Some(format!("fn {}{}", group(c, 1), group(c, 2))),
        ),
    ],
});

static LUA_RULES: LazyLock<Language> = LazyLock::new(|| Language {
    syntax: LUA,
    statements_only: false,
    rules: vec![
        Rule::new(
            r"^(?:local\s+)?function\s+([\w.:]+)\s*\(",
            Block::Lua,
            |c, s| Some(function(group(c, 1), false, s)),
        )
        .with_params(),
        Rule::new(
            r"^(?:local\s+)?([\w.:]+)\s*=\s*function\s*\(",
            Block::Lua,
            |c, s| Some(function(group(c, 1), false, s)),
        )
        .with_params(),
        Rule::new(r"^(for|while)\s+(.+?)\s+do\b", Block::Lua, |c, _| {
            Some(loop_label(group(c, 1), group(c, 2)))
        })
        .min_lines(MIN_LOOP_LINES),
    ],
});

static PERL_RULES: LazyLock<Language> = LazyLock::new(|| Language {
    syntax: HASH,
    statements_only: false,
    rules: vec![
        Rule::new(r"^package\s+([\w:]+)", Block::Line, |c, _| {
            Some(format!("package {}", group(c, 1)))
        }),
        Rule::new(r"^sub\s+(\w+)", Block::Braces, |c, _| {
            Some(format!("fn {}", group(c, 1)))
        }),
    ],
});

static SHELL_RULES: LazyLock<Language> = LazyLock::new(|| Language {
    syntax: HASH,
    statements_only: false,
    rules: vec![
        Rule::new(
            r"^(?:function\s+([\w.:-]+)(?:\s*\(\s*\))?|([\w.:-]+)\s*\(\s*\))",
            Block::Braces,
            |c, _| Some(format!("fn {}{}", group(c, 1), group(c, 2))),
        ),
        Rule::new(
            r"^(for|while|until)\s+(.+?)(?:\s*;\s*do)?\s*$",
            Block::Shell,
            |c, _| Some(loop_label(group(c, 1), group(c, 2))),
        )
        .min_lines(MIN_LOOP_LINES),
    ],
});
