use std::fs;
use std::path::Path;
use std::process::{Command, Output, Stdio};

use regex::Regex;
use tempfile::TempDir;

fn combicode(dir: &Path, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_combicode"))
        .current_dir(dir)
        .args(args)
        .stdin(Stdio::null())
        .output()
        .expect("run combicode")
}

fn ok(dir: &Path, args: &[&str]) -> String {
    let output = combicode(dir, args);
    assert!(
        output.status.success(),
        "combicode {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).expect("stdout is UTF-8")
}

fn write(dir: &Path, path: &str, content: &str) {
    let path = dir.join(path);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, content).unwrap();
}

fn project() -> TempDir {
    let dir = TempDir::new().unwrap();
    write(
        dir.path(),
        "src/app.py",
        "import os\n\n\nclass App:\n    def __init__(self):\n        self.items = []\n\n    def run(\n        self,\n        fast: bool = False,\n    ) -> int:\n        return 0\n",
    );
    write(
        dir.path(),
        "src/util.ts",
        "export function add(a: number, b: number): number {\n  return a + b;\n}\n\nexport class Box {\n  constructor(value) {\n    this.value = value;\n  }\n}\n",
    );
    write(dir.path(), "src/windows.txt", "alpha\r\nbeta\r\n");
    write(
        dir.path(),
        "src/no-newline.rs",
        "fn main() {\n    println!(\"hi\");\n}",
    );
    write(dir.path(), "empty.md", "");
    write(dir.path(), "README.md", "# Demo\n\nSome text.\n");
    dir
}

/// Every file and symbol ML range must point at exactly the lines it describes.
fn assert_line_references(document: &str, root: &Path) {
    let lines: Vec<&str> = document.split('\n').collect();
    let entry =
        Regex::new(r"^([│ ]*)(?:├── |└── )(.+?) \[OL: (\d+)-(\d+) \| ML: (\d+)-(\d+)").unwrap();
    let mut stack: Vec<(usize, String)> = Vec::new();
    let mut checked = 0;
    let map_end = lines.iter().position(|l| *l == "</code_map>").unwrap();
    let map_start = lines.iter().position(|l| *l == "<code_map>").unwrap();
    let mut current_file: Option<String> = None;
    for line in &lines[map_start + 2..map_end] {
        let depth = line.chars().take_while(|c| matches!(c, '│' | ' ')).count() / 4;
        stack.truncate(depth);
        let name = line
            .trim_start_matches(['│', ' '])
            .trim_start_matches("├── ")
            .trim_start_matches("└── ");
        let name = name.split(" [").next().unwrap().to_string();
        let Some(c) = entry.captures(line) else {
            stack.push((depth, name.trim_end_matches('/').to_string()));
            continue;
        };
        let (ol_start, ol_end): (usize, usize) = (c[3].parse().unwrap(), c[4].parse().unwrap());
        let (ml_start, ml_end): (usize, usize) = (c[5].parse().unwrap(), c[6].parse().unwrap());
        assert_eq!(
            ol_end - ol_start,
            ml_end - ml_start,
            "range sizes differ: {line}"
        );
        let path = stack
            .iter()
            .map(|(_, n)| n.as_str())
            .chain([name.as_str()])
            .collect::<Vec<_>>()
            .join("/");
        let source_path = if root.join(&path).is_file() {
            current_file = Some(path.clone());
            path.clone()
        } else {
            current_file.clone().expect("symbol belongs to a file")
        };
        let source = fs::read_to_string(root.join(&source_path)).unwrap();
        let source_lines: Vec<&str> = source.split('\n').collect();
        for (offset, ml) in (ml_start..=ml_end).enumerate() {
            assert_eq!(
                lines[ml - 1],
                source_lines[ol_start - 1 + offset],
                "ML {ml} of {line:?} does not match {source_path} line {}",
                ol_start + offset
            );
        }
        if source_path == path {
            assert_eq!(
                lines[ml_start - 2],
                format!("<file path=\"{path}\" bytes=\"{}\">", source.len())
            );
        }
        stack.push((depth, name));
        checked += 1;
    }
    assert!(checked >= 8, "only {checked} entries checked");
}

#[test]
fn line_references_match_the_document() {
    let dir = project();
    let document = ok(dir.path(), &[]);
    assert!(document.starts_with("You are given the source code of the project"));
    assert_line_references(&document, dir.path());

    let without_prompt = ok(dir.path(), &["--no-prompt", "--no-size"]);
    assert!(without_prompt.starts_with("<code_map>\n"));
    assert_line_references(&without_prompt, dir.path());

    let prompt_dir = TempDir::new().unwrap();
    let prompt_file = prompt_dir.path().join("prompt.txt");
    fs::write(&prompt_file, "Line one\nLine two\n\nLine four").unwrap();
    let custom = ok(
        dir.path(),
        &["--prompt-file", prompt_file.to_str().unwrap()],
    );
    assert!(custom.starts_with("Line one\nLine two\n\nLine four\n\n<code_map>\n"));
    assert_line_references(&custom, dir.path());
}

#[test]
fn section_flags() {
    let dir = project();
    let only_map = ok(dir.path(), &["--only-map"]);
    assert!(only_map.starts_with("<code_map>\n") && only_map.ends_with("</code_map>\n"));
    assert!(
        !only_map.contains("ML:"),
        "ML is meaningless without code: {only_map}"
    );
    assert!(only_map.contains("app.py [OL: 1-12 | 158B]"));
    assert!(only_map.contains("fn run(self, fast: bool = False) -> int [OL: 8-12 |"));

    let no_size = ok(dir.path(), &["--only-map", "--no-size"]);
    assert!(no_size.contains("app.py [OL: 1-12]\n"));

    let no_outline = ok(dir.path(), &["--only-map", "--no-outline"]);
    assert!(!no_outline.contains("class App"));

    let no_code = ok(dir.path(), &["--no-code"]);
    assert!(no_code.starts_with("You are given") && no_code.ends_with("</code_map>\n"));
    assert!(no_code.contains("File contents are not included."));
    assert_eq!(ok(dir.path(), &["--no-prompt", "--no-code"]), only_map);

    let no_map = ok(dir.path(), &["--no-map"]);
    assert!(!no_map.contains("<code_map>") && no_map.contains("\n<code>\n"));
    assert!(!no_map.contains("ML ranges"));

    let code_only = ok(dir.path(), &["--no-prompt", "--no-map"]);
    assert!(code_only.starts_with("<code>\n<file path=\"README.md\" bytes=\"19\">\n"));

    let docs = ok(dir.path(), &["--prompt", "docs"]);
    assert!(docs.starts_with("You are given the documentation of the project"));

    for args in [
        &["--no-prompt", "--no-map", "--no-code"][..],
        &["--only-map", "--no-map"],
        &["--only-map", "--prompt", "docs"],
        &["--no-prompt", "--prompt-file", "x"],
        &["--not-an-option"],
    ] {
        assert!(
            !combicode(dir.path(), args).status.success(),
            "{args:?} should fail"
        );
    }
}

#[test]
fn include_exclude_and_omit_content() {
    let dir = project();
    write(dir.path(), "hello/a.txt", "a\n");
    write(dir.path(), "deep/world/b.txt", "b\n");
    write(dir.path(), "x/my.txt", "m\n");
    write(dir.path(), "other.txt", "o\n");
    let map = ok(
        dir.path(),
        &["--only-map", "--include", "hello,world,my.txt"],
    );
    for expected in ["a.txt", "b.txt", "my.txt"] {
        assert!(map.contains(expected), "{expected} missing from {map}");
    }
    assert!(!map.contains("other.txt") && !map.contains("app.py"));

    let map = ok(dir.path(), &["--only-map", "-i", "*.py", "-i", "*.ts"]);
    assert!(map.contains("app.py") && map.contains("util.ts") && !map.contains("README.md"));

    let map = ok(dir.path(), &["--only-map", "-e", "src/,*.md"]);
    assert!(!map.contains("src/") && !map.contains("README.md") && map.contains("other.txt"));

    let document = ok(dir.path(), &["--omit-content", "*.ts", "--no-prompt"]);
    assert!(document.contains("util.ts [content omitted | 143B]"));
    assert!(document.contains("<file path=\"src/util.ts\" omitted=\"true\" />\n"));
    assert!(!document.contains("export class Box"));
    assert_line_references(&document, dir.path());
}

#[test]
fn ignore_rules() {
    let dir = TempDir::new().unwrap();
    let root = dir.path();
    write(root, "main.py", "pass\n");
    write(root, ".gitignore", "*.tmp\n");
    write(root, "nested/.gitignore", "!keep.tmp\n");
    write(root, "nested/keep.tmp", "keep\n");
    write(root, "nested/drop.tmp", "drop\n");
    write(root, ".combicodeignore", "secret/\n");
    write(root, "secret/key.txt", "k\n");
    for path in [
        "node_modules/dep.js",
        ".venv/dep.py",
        "dist/bundle.js",
        ".env",
        "Cargo.lock",
    ] {
        write(root, path, "excluded\n");
    }
    write(root, ".env.example", "KEY=\n");
    write(
        root,
        ".gitmodules",
        "[submodule \"lib\"]\n\tpath = vendor/lib\n",
    );
    write(root, "vendor/lib/code.c", "int x;\n");
    fs::write(root.join("image.dat"), b"\x89PNG\x00\x00binary").unwrap();
    fs::write(root.join("latin1.txt"), b"caf\xe9\n").unwrap();
    #[cfg(unix)]
    std::os::unix::fs::symlink("main.py", root.join("alias.py")).unwrap();

    let output = combicode(root, &["--only-map", "--no-size"]);
    assert!(output.status.success());
    let map = String::from_utf8(output.stdout).unwrap();
    let stderr = String::from_utf8(output.stderr).unwrap();
    for expected in [
        "main.py",
        "keep.tmp",
        ".env.example",
        ".gitignore",
        ".gitmodules",
    ] {
        assert!(map.contains(expected), "{expected} missing from {map}");
    }
    for unexpected in [
        "drop.tmp",
        "key.txt",
        "dep.js",
        "dep.py",
        "bundle.js",
        "Cargo.lock",
        "code.c",
        "image.dat",
        "latin1.txt",
        "alias.py",
    ] {
        assert!(
            !map.contains(unexpected),
            "{unexpected} should be excluded from {map}"
        );
    }
    assert!(map.contains("├── .env.example"), "{map}");
    assert!(!map.contains(" .env [") && !map.contains("── .env\n"));
    assert!(
        stderr.contains("warning: skipping latin1.txt: not valid UTF-8"),
        "{stderr}"
    );
    assert!(stderr.contains("skipped 1 binary, 1 not UTF-8"), "{stderr}");

    let map = ok(root, &["--only-map", "--no-gitignore"]);
    assert!(map.contains("drop.tmp") && !map.contains("key.txt") && !map.contains("dep.js"));
}

#[test]
fn output_file_and_redirect_are_not_packed() {
    let dir = project();
    let root = dir.path();
    let output = combicode(root, &["-o", "out/context.txt"]);
    assert!(output.status.success());
    let stderr = String::from_utf8(output.stderr).unwrap();
    assert!(stderr.contains("combicode: packed 6 files"), "{stderr}");
    assert!(stderr.contains("into out/context.txt"), "{stderr}");
    let first = fs::read_to_string(root.join("out/context.txt")).unwrap();
    ok(root, &["-o", "out/context.txt"]);
    assert_eq!(
        fs::read_to_string(root.join("out/context.txt")).unwrap(),
        first
    );

    // Shell redirection: stdout is the file being written.
    let redirect = fs::File::create(root.join("redirect.txt")).unwrap();
    let status = Command::new(env!("CARGO_BIN_EXE_combicode"))
        .current_dir(root)
        .stdout(redirect)
        .stderr(Stdio::null())
        .status()
        .unwrap();
    assert!(status.success());
    let redirected = fs::read_to_string(root.join("redirect.txt")).unwrap();
    assert!(!redirected.contains("redirect.txt"));
    assert!(
        !redirected.contains("context.txt"),
        "previous outputs are skipped"
    );
    assert_eq!(redirected, first);
}

#[test]
fn restore_round_trip() {
    let dir = project();
    let root = dir.path();
    write(
        root,
        "tricky/fences.md",
        "<file path=\"x\" bytes=\"1\">\n</file>\n</code>\n",
    );
    write(
        root,
        "tricky/a space [%] & ü.txt",
        "\u{feff}Привіт 🌍\nline\u{2028}sep\n",
    );
    let work = TempDir::new().unwrap();
    let packed = work.path().join("packed.txt");
    let restored = work.path().join("restored");
    let (packed_arg, restored_arg) = (packed.to_str().unwrap(), restored.to_str().unwrap());
    ok(root, &["-o", packed_arg, "--omit-content", "README.md"]);

    let output = combicode(root, &["restore", packed_arg, "-o", restored_arg, "-n"]);
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        output.status.success() && stderr.contains("would restore 7 files"),
        "{stderr}"
    );
    assert!(!restored.exists());

    ok(root, &["restore", packed_arg, "-o", restored_arg]);
    for path in [
        "src/app.py",
        "src/util.ts",
        "src/windows.txt",
        "src/no-newline.rs",
        "empty.md",
        "tricky/fences.md",
        "tricky/a space [%] & ü.txt",
    ] {
        assert_eq!(
            fs::read(restored.join(path)).unwrap(),
            fs::read(root.join(path)).unwrap(),
            "{path}"
        );
    }
    assert!(
        !restored.join("README.md").exists(),
        "omitted files are not restored"
    );

    write(&restored, "src/app.py", "changed\n");
    let output = combicode(root, &["restore", packed_arg, "-o", restored_arg]);
    assert!(String::from_utf8_lossy(&output.stderr).contains("exists, kept"));
    assert_eq!(
        fs::read_to_string(restored.join("src/app.py")).unwrap(),
        "changed\n"
    );
    ok(
        root,
        &["restore", packed_arg, "-o", restored_arg, "--force"],
    );
    assert_eq!(
        fs::read(restored.join("src/app.py")).unwrap(),
        fs::read(root.join("src/app.py")).unwrap()
    );

    let packed_stdin = fs::File::open(&packed).unwrap();
    let from_stdin = work.path().join("from-stdin");
    let status = Command::new(env!("CARGO_BIN_EXE_combicode"))
        .args(["restore", "-", "-q", "-o", from_stdin.to_str().unwrap()])
        .stdin(packed_stdin)
        .status()
        .unwrap();
    assert!(status.success() && from_stdin.join("src/app.py").is_file());

    let map = work.path().join("map.txt");
    ok(root, &["--only-map", "-o", map.to_str().unwrap()]);
    let output = combicode(
        root,
        &["restore", map.to_str().unwrap(), "-o", restored_arg],
    );
    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("no <code> section"));
}

#[test]
fn restore_rejects_unsafe_paths() {
    let dir = TempDir::new().unwrap();
    let root = dir.path();
    write(
        root,
        "evil.txt",
        "<code>\n<file path=\"../escape.txt\" bytes=\"2\">\nx\n</file>\n</code>\n",
    );
    let output = combicode(root, &["restore", "evil.txt", "-o", "out"]);
    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("unsafe file path"));
    assert!(!root.join("escape.txt").exists());

    #[cfg(unix)]
    {
        let outside = TempDir::new().unwrap();
        fs::create_dir(root.join("out")).unwrap();
        std::os::unix::fs::symlink(outside.path(), root.join("out/link")).unwrap();
        write(
            root,
            "link.txt",
            "<code>\n<file path=\"link/x.txt\" bytes=\"2\">\nx\n</file>\n</code>\n",
        );
        let output = combicode(root, &["restore", "link.txt", "-o", "out"]);
        assert!(!output.status.success());
        assert!(!outside.path().join("x.txt").exists());
    }
}

#[test]
fn errors_are_reported() {
    let dir = TempDir::new().unwrap();
    let output = combicode(dir.path(), &[]);
    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("no files to pack"));
    let output = combicode(dir.path(), &["missing-dir"]);
    assert!(String::from_utf8_lossy(&output.stderr).contains("is not a directory"));
    let version = ok(dir.path(), &["--version"]);
    assert_eq!(
        version,
        format!("combicode {}\n", env!("CARGO_PKG_VERSION"))
    );
}
