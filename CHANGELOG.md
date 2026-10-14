# Changelog

## [4.1.0](https://github.com/aaurelions/combicode/compare/v4.0.1...v4.1.0) (2026-10-14)

### Features

- `--stdout` writes to stdout even when it is a terminal (same as `-o -`).
- `--no-tags` prints the map without the `<code_map>` tags, so `combicode --only-map --no-tags --stdout -q` works as a `tree` with code outlines.
- The summary after packing and restoring is a short aligned report instead of one long line, colored when stderr is a terminal (disable with `NO_COLOR`):

  ```text
  ✓ Packed 28 files into combicode.txt
    Source   167.7KB
    Output   5,337 lines · ~49,325 tokens
  ```

## [4.0.1](https://github.com/aaurelions/combicode/compare/v4.0.0...v4.0.1) (2026-10-14)

### Fixes

- npm: the platform binaries are published as `@aaurelions/combicode-{linux,darwin,win32}-{x64,arm64}`. npm's spam filter rejected the unscoped `combicode-win32-arm64`, so the 4.0.0 npm release was incomplete and `combicode@4.0.0` was never published to npm.


## [4.0.0](https://github.com/aaurelions/combicode/compare/v3.0.0...v4.0.0) (2026-10-14)

Combicode is now a single Rust binary. The npm and PyPI packages ship that binary, and it is also available from crates.io, Homebrew and GitHub releases.

### Breaking changes

- New output format: `<code_map>` and `<code>` sections, with each file in a `<file path="..." bytes="N">` element. Documents from earlier versions cannot be restored; regenerate them.
- Output goes to stdout when redirected or piped, and to `combicode.txt` when run in a terminal. `-o -` always writes to stdout.
- Options renamed: `--include-ext` → `--include` (gitignore patterns, e.g. `*.ts` or `src/`), `--skip-content` → `--omit-content`, `--no-parse` → `--no-outline`, `--no-header` → `--no-prompt --no-map`, `--llms-txt` → `--prompt docs`.
- Restoring is a subcommand: `combicode restore FILE -o DIR`, replacing `--recreate --input FILE`. `--overwrite` is now `-f/--force`.
- Combine-mode `--dry-run` is removed; use `--only-map` to preview the selected files. `-v` is now `-V`.

### Features

- `--no-prompt`, `--no-map`, `--no-code`, `--only-map` and `--no-size` choose what the document contains; the built-in prompt describes only the sections present.
- `--prompt-file` for a custom prompt, and an optional project directory argument.
- `.combicodeignore` files, `.ignore` files, `.git/info/exclude` and the global gitignore are respected.
- Earlier Combicode outputs in the project, and the file being written (including a shell redirect target), are never packed.
- The summary reports lines and an approximate token count; non-UTF-8 files are skipped with a warning instead of stopping the run.
- `restore -` reads from stdin.

### Fixes

- ML line numbers are computed from the exact rendered layout and verified by end-to-end tests for every file and symbol.
- Outlines handle multi-line signatures, destructured parameters, class methods, declarations without a body, regular-expression literals, multi-line strings and Ruby/Lua one-line blocks.


## [3.0.0](https://github.com/aaurelions/combicode/compare/v2.0.0...v3.0.0) (2026-09-15)

- Replace legacy archive extraction with validated, byte-length-framed records. Old archives must be regenerated.
- Preserve UTF-8 contents, line endings, final newlines, empty files, and embedded fences across both runtimes.
- Reject unsafe restore paths and symlinks; atomically replace files without modifying other hardlinks.
- Apply packaged default ignores, honor nested negations, and normalize extension filters.
- Separate archive and parser modules; fix filename collisions and code-range/byte-count errors.
- Update dependencies and runtime requirements, remove unused native parsers, and add cross-runtime regression tests and CI.
- Align human-readable byte-size formatting between the JavaScript and Python packages.
- Correct documentation and make release preparation portable.

## [2.0.0](https://github.com/aaurelions/combicode/compare/combicode-js-v1.7.2...combicode-js-v2.0.0) (2026-02-28)

### Features

- **code-map:** add expanded code map with classes, functions, loops, and constructors parsed from 15+ languages
- **code-map:** show OL (Original Line), ML (Merged Line), and SIZE references for every element
- **output:** wrap output in `<code_index>` and `<merged_code>` XML tags for clear section separation
- **output:** update file headers to `# FILE: path [OL: X-Y | ML: X-Y | SIZE]` format
- **output:** update system prompts to reference code map and OL/ML navigation
- **recreate:** add `--recreate` / `-r` flag to extract files from combicode.txt back to project structure
- **recreate:** add `--input` flag to specify input file for recreate
- **recreate:** add `--overwrite` flag to overwrite existing files when recreating
- **parse:** add `--no-parse` flag to disable code structure parsing (show only file tree)
- **parsers:** regex-based parsers for JavaScript, TypeScript, Go, Rust, Java, C/C++, C#, PHP, Ruby, Swift, Kotlin, Scala, Lua, Perl, Bash
- **parsers:** Python parser with indent-based block detection

### Breaking Changes

- Output format changed: files are now wrapped in `<code_index>` and `<merged_code>` XML sections
- File headers changed from `### **FILE:** \`path\`` to `# FILE: path [OL: X-Y | ML: X-Y | SIZE]`
- System prompts updated to reference code map and line navigation

## [1.7.2](https://github.com/aaurelions/combicode/compare/combicode-js-v1.7.1...combicode-js-v1.7.2) (2025-01-XX)

### Bug Fixes

- **skip-content:** fix total size calculation to exclude files with skipped content
- **skip-content:** remove extra blank line after placeholder text in output

## [1.7.1](https://github.com/aaurelions/combicode/compare/combicode-js-v1.7.0...combicode-js-v1.7.1) (2025-01-XX)

### Bug Fixes

- **ci:** restore NPM_TOKEN for npm publishing to fix authentication issues

## [1.7.0](https://github.com/aaurelions/combicode/compare/combicode-js-v1.6.0...combicode-js-v1.7.0) (2025-01-XX)

### Maintenance

- **ci:** migrate to npm trusted publishing (OIDC), remove NPM_TOKEN requirement

## [1.6.0](https://github.com/aaurelions/combicode/compare/combicode-js-v1.5.4...combicode-js-v1.6.0) (2025-01-XX)

### Features

- **skip-content:** add `--skip-content` option to include files in tree but omit their content (useful for large test files)

## [1.5.4](https://github.com/aaurelions/combicode/compare/combicode-js-v1.5.3...combicode-js-v1.5.4) (2025-12-03)

### Features

- **ignore:** implement full support for nested `.gitignore` files, ensuring exclusion rules are applied correctly within subdirectories

### Bug Fixes

- **deps:** replace `fast-glob` with `ignore` and recursive directory walking for accurate git-like pattern matching

## [1.5.3](https://github.com/aaurelions/combicode/compare/combicode-js-v1.5.2...combicode-js-v1.5.3) (2025-11-30)

### Bug Fixes

- **cli:** prevent the output file (e.g., `combicode.txt`) from recursively including itself in the generated content

## [1.5.2](https://github.com/aaurelions/combicode/compare/combicode-js-v1.4.0...combicode-js-v1.5.2) (2025-11-30)

### Features

- **tree:** display file sizes in the generated file tree (e.g., `[1.2KB]`)
- **output:** improve file header format (`### **FILE:**`) for better LLM parsing
- **tests:** add integration test suite using native Node.js modules

## [1.4.0](https://github.com/aaurelions/combicode/compare/combicode-js-v1.3.0...combicode-js-v1.4.0) (2025-08-13)

### Features

- Add --llms-txt flag for llms.txt documentation context ([0817554](https://github.com/aaurelions/combicode/commit/081755435594b0ca5208609b2724eb47bd73c2dc))

## [1.3.0](https://github.com/aaurelions/combicode/compare/combicode-js-v1.2.1...combicode-js-v1.3.0) (2025-06-25)

### Features

- Add package-lock.json for reproducible builds ([06a417a](https://github.com/aaurelions/combicode/commit/06a417a155e9b72e26d0e091d181cfb8c53f0d28))
- **ci:** implement independent package versioning for monorepo ([d02cf23](https://github.com/aaurelions/combicode/commit/d02cf233239c7af8db19061f34b769178334b388))
- improve CLI output and version reporting ([7963a10](https://github.com/aaurelions/combicode/commit/7963a10782c2626608750de53023d37d327d51b2))
- improve CLI output and version reporting ([e74f6d8](https://github.com/aaurelions/combicode/commit/e74f6d8fbed4f9cdf8ad82f3dae87069f66f7bb6))

### Bug Fixes

- **ci:** permission error ([156b76d](https://github.com/aaurelions/combicode/commit/156b76d3ab1550123df2ded6b1da5d6e2e2cc008))
- **npm:** Set public access for publishing and bump version to 1.0.1 ([6c91eb7](https://github.com/aaurelions/combicode/commit/6c91eb714c81ec0201bb0fcfad8ad9fb4124cd7e))
- Use scoped npm package name and bump python version ([8a1b347](https://github.com/aaurelions/combicode/commit/8a1b347f6c54c9762acf354ef289c293d3ef21a3))

## [1.2.0](https://github.com/aaurelions/combicode/compare/combicode-js-v1.1.0...combicode-js-v1.2.0) (2025-06-25)

### Features

- Add package-lock.json for reproducible builds ([06a417a](https://github.com/aaurelions/combicode/commit/06a417a155e9b72e26d0e091d181cfb8c53f0d28))
- **ci:** implement independent package versioning for monorepo ([d02cf23](https://github.com/aaurelions/combicode/commit/d02cf233239c7af8db19061f34b769178334b388))
- improve CLI output and version reporting ([7963a10](https://github.com/aaurelions/combicode/commit/7963a10782c2626608750de53023d37d327d51b2))
- improve CLI output and version reporting ([e74f6d8](https://github.com/aaurelions/combicode/commit/e74f6d8fbed4f9cdf8ad82f3dae87069f66f7bb6))

### Bug Fixes

- **ci:** permission error ([156b76d](https://github.com/aaurelions/combicode/commit/156b76d3ab1550123df2ded6b1da5d6e2e2cc008))
- **npm:** Set public access for publishing and bump version to 1.0.1 ([6c91eb7](https://github.com/aaurelions/combicode/commit/6c91eb714c81ec0201bb0fcfad8ad9fb4124cd7e))
- Use scoped npm package name and bump python version ([8a1b347](https://github.com/aaurelions/combicode/commit/8a1b347f6c54c9762acf354ef289c293d3ef21a3))
