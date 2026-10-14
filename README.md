# Combicode

[![crates.io](https://img.shields.io/crates/v/combicode.svg)](https://crates.io/crates/combicode)
[![npm](https://img.shields.io/npm/v/combicode.svg)](https://www.npmjs.com/package/combicode)
[![PyPI](https://img.shields.io/pypi/v/combicode.svg)](https://pypi.org/project/combicode/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Combicode packs a project into one text file that you can give to an LLM. The file contains:

1. **A prompt** that tells the model what it is reading.
2. **A code map**: the directory tree plus the classes and functions in each file, with line numbers and sizes.
3. **The code**: every file, unchanged.

Every line number in the map is exact, so you and the model can jump straight to any file or function.

Combicode is a single native binary written in Rust. The npm and PyPI packages contain the same binary, so you do not need Rust, Node.js or Python beyond the tool you install it with.

## Install

| Tool | Run once | Install |
| --- | --- | --- |
| npm | `npx combicode` | `npm install -g combicode` |
| Python | `uvx combicode` or `pipx run combicode` | `pipx install combicode` or `pip install combicode` |
| Homebrew | | `brew install aaurelions/tap/combicode` |
| Cargo | | `cargo install combicode` |

`npx combicode` needs only Node.js 18 or newer: npm downloads the prebuilt binary for your platform (Linux, macOS or Windows on x64 or ARM64) as an optional dependency. On other platforms, or if optional dependencies are disabled (`--omit=optional`), use `cargo install combicode`.

Prebuilt binaries for Linux, macOS and Windows (x64 and ARM64) are attached to every [GitHub release](https://github.com/aaurelions/combicode/releases).

## Usage

Run it in your project directory:

```sh
combicode                     # saves combicode.txt
```

When you run it in a terminal, Combicode saves `combicode.txt`. When its output is redirected or piped, it writes to stdout instead, so both of these work:

```sh
combicode > combicode.txt
combicode | pbcopy            # copy to the clipboard on macOS
```

Status messages go to stderr, so they never end up in the file.

To print to the terminal instead of saving a file, use `--stdout` (or `-o -`). With `--only-map --no-tags` this makes Combicode a `tree` with code outlines and line counts:

```sh
combicode --only-map --no-tags --stdout -q     # the bare map, nothing else
alias ctree='combicode --only-map --no-tags --stdout -q'
ctree src/                                     # like `tree src/`, with classes and functions
```

`--no-tags` drops the `<code_map>` wrapper, which only helps an LLM find the section in a larger document. It works only when the map is the sole section. `-q` hides the summary line, which goes to stderr and would otherwise show up in the terminal.

### Choose what goes into the file

```sh
combicode --no-prompt > no-prompt.txt          # map and code, without the prompt
combicode --no-prompt --no-code > map.txt      # only the map
combicode --only-map > map.txt                 # the same, shorter
combicode --only-map --no-size > map.txt       # the map without sizes
combicode --no-map -o no-map.txt               # prompt and code, without the map
combicode --no-outline                         # the map lists files but not functions
```

### Choose which files to pack

```sh
combicode --include 'src/,*.md'                # only src/ and Markdown files
combicode --only-map --include 'hello,world,my.txt' -o combicode.txt
combicode --exclude '*.test.ts,fixtures/'      # skip more files
combicode --omit-content 'data/,*.csv'         # list these in the map, but leave out their content
combicode ../other-project -o other.txt        # pack another directory
```

Patterns use [gitignore syntax](https://git-scm.com/docs/gitignore#_pattern_format). A pattern without a slash, such as `hello` or `*.md`, matches at any depth, and a directory pattern matches everything inside it. Separate patterns with commas or repeat the option: `-i src/ -i '*.md'`.

## Output

For a small project, `combicode` produces this file (line numbers added for reference):

```text
 1  You are given the source code of the project "my-app", packed into a single document by Combicode.
 2
 3  <code_map> lists every included file as a directory tree, with the classes, functions and other symbols found in each file. Entries show OL (line range in the original file), ML (line range in this document) and size. <code> contains the files in map order, each inside a <file path="..."> element exactly as it appears on disk.
 4
 5  Before answering, study the project as a whole: its structure, entry points, configuration, dependencies and how the parts interact. When you refer to code, cite the file path and original line numbers. Use ML ranges to find a file or symbol in this document.
 6
 7  <code_map>
 8  my-app/
 9  ├── package.json [OL: 1-4 | ML: 18-21 | 43B]
10  └── src/
11      ├── greet.js [OL: 1-3 | ML: 25-27 | 60B]
12      │   └── fn greet(name) [OL: 1-3 | ML: 25-27 | 60B]
13      └── index.js [OL: 1-3 | ML: 31-33 | 66B]
14  </code_map>
15
16  <code>
17  <file path="package.json" bytes="43">
18  {
19    "name": "my-app",
20    "type": "module"
21  }
22  </file>
23
24  <file path="src/greet.js" bytes="60">
25  export function greet(name) {
26    return `Hello, ${name}!`;
27  }
28  </file>
29
30  <file path="src/index.js" bytes="66">
31  import { greet } from "./greet.js";
32
33  console.log(greet("world"));
34  </file>
35  </code>
```

Each map entry shows:

- **OL** (original lines): the line range in the source file. `fn greet(name) [OL: 1-3]` is lines 1–3 of `greet.js`.
- **ML** (merged lines): the line range in the output file, so `sed -n '25,27p' combicode.txt` prints exactly `greet`. ML appears only when the code is included.
- **Size** of the file or symbol. Hide it with `--no-size`.

Lines are counted by `\n`, the same way as `sed`, `wc -l` and editors. Windows line endings (`\r\n`) do not change the count. Empty files are shown as `[empty]`, and files left out with `--omit-content` as `[content omitted | size]`.

The map is a *code map*: a directory **tree** with an **outline** of each file. That is why the options are named `--no-map`, `--only-map` and `--no-outline`.

### Outlines

The outline lists classes, structs, interfaces, functions, methods, test cases and long loops (6 lines or more) for:

| Languages | Extensions |
| --- | --- |
| Python | `.py` `.pyi` |
| JavaScript, TypeScript | `.js` `.jsx` `.mjs` `.cjs` `.ts` `.tsx` `.mts` `.cts` |
| Rust, Go | `.rs` `.go` |
| C, C++, C#, Java | `.c` `.h` `.cc` `.cpp` `.cxx` `.hh` `.hpp` `.hxx` `.cs` `.java` |
| Kotlin, Swift, Scala | `.kt` `.kts` `.swift` `.scala` `.sc` |
| PHP, Ruby, Lua, Perl, shell | `.php` `.rb` `.lua` `.pl` `.pm` `.sh` `.bash` `.zsh` |

Other text files are included without an outline. Outlines are found with fast heuristics rather than a full parser: they skip comments and strings and handle multi-line signatures, but unusual syntax can be missed. File contents are never changed.

### Prompts

```sh
combicode --prompt docs -i '*.md' -o docs.txt    # a prompt for documentation (llms.txt style)
combicode --prompt-file my-prompt.md             # your own prompt
```

The built-in prompts describe only the sections that are present. `--prompt docs` tells the model to answer strictly from the packed documents.

## Which files are included

Combicode walks the directory and:

- respects `.gitignore` (including nested ones, `.git/info/exclude` and your global gitignore) and `.ignore` files. Use `--no-gitignore` to turn this off;
- respects a `.combicodeignore` file, in gitignore syntax, for project-specific rules that should not affect git;
- skips [common non-source files](src/defaults.gitignore): `.git`, dependencies such as `node_modules` and `.venv`, build output such as `target` and `dist`, lockfiles, `.env` files, media and archives. `--no-gitignore` does not turn these off;
- skips git submodules, symlinks, binary files and files that are not valid UTF-8 (with a warning);
- never packs its own output file, or an earlier Combicode output lying in the project.

Ignore rules are not secret detection. Check the file before you share it.

## Restore files

A Combicode file can be turned back into files:

```sh
combicode restore combicode.txt -o restored/       # recreate the files in restored/
combicode restore combicode.txt -o restored/ -n    # dry run: show what would be written
combicode restore combicode.txt --force            # replace files that already exist
```

The `bytes` attribute of each `<file>` element is the exact UTF-8 length of its content, so content that looks like a `</file>` tag, empty files, missing final newlines, `\r\n` line endings and Unicode all round-trip exactly. If you edit content inside the file, update `bytes` to match.

Restore never writes outside the target directory: absolute paths, `..`, symlinks, Windows device names and other unsafe paths are rejected before anything is written. Existing files are kept unless you pass `--force`, and replaced files are swapped in atomically. Files left out with `--omit-content` are not restored.

## Options

```text
combicode [OPTIONS] [PATH]
combicode restore [OPTIONS] [INPUT]
```

| Option | Description |
| --- | --- |
| `PATH` | Project directory to pack. Default: the current directory. |
| `-o, --output <FILE>` | Write to `FILE`; `-` means stdout. Default: stdout, or `combicode.txt` when stdout is a terminal. |
| `--stdout` | Write to stdout even when it is a terminal (same as `-o -`). |
| `-i, --include <PATTERNS>` | Pack only files matching these patterns. |
| `-e, --exclude <PATTERNS>` | Skip files matching these patterns. |
| `--omit-content <PATTERNS>` | List matching files in the map without their content. |
| `--no-gitignore` | Do not read `.gitignore`, `.ignore` or git exclude files. |
| `--no-prompt` | Leave out the prompt. |
| `--no-map` | Leave out the code map. |
| `--no-code` | Leave out file contents. |
| `--only-map` | Output only the code map (`--no-prompt --no-code`). |
| `--no-outline` | List files in the map without classes and functions. |
| `--no-size` | Hide sizes in the map. |
| `--no-tags` | Print the map without the `<code_map>` tags. Only when the map is the sole section. |
| `--prompt <code\|docs>` | Built-in prompt. Default: `code`. |
| `--prompt-file <FILE>` | Use the contents of `FILE` as the prompt. |
| `-q, --quiet` | Do not print the summary and warnings. |
| `-h, --help` / `-V, --version` | Print help or the version. |

`restore` options:

| Option | Description |
| --- | --- |
| `INPUT` | Combicode file to read; `-` means stdin. Default: `combicode.txt`. |
| `-o, --output <DIR>` | Directory to restore into. Default: the current directory. |
| `-n, --dry-run` | Show what would be written without changing anything. |
| `-f, --force` | Replace files that already exist. |
| `-q, --quiet` | Do not print the file list and summary. |

Exit status is 0 on success, 1 on errors and 2 on invalid options.

> **Windows PowerShell 5.1** saves redirected output as UTF-16. Use `-o combicode.txt` instead of `>` there (PowerShell 7 is fine).

## License

[MIT](LICENSE)
