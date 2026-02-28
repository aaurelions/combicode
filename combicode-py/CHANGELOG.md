# Changelog

## [2.0.0](https://github.com/aaurelions/combicode/compare/combicode-py-v1.7.2...combicode-py-v2.0.0) (2026-02-28)

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
- **parsers:** AST-based Python parser with full class/function/loop detection
- **parsers:** regex-based parsers for JavaScript, TypeScript, Go, Rust, Java, C/C++, C#, PHP, Ruby, Swift, Kotlin, Scala, Lua, Perl, Bash

### Breaking Changes

- Output format changed: files are now wrapped in `<code_index>` and `<merged_code>` XML sections
- File headers changed from `### **FILE:** \`path\`` to `# FILE: path [OL: X-Y | ML: X-Y | SIZE]`
- System prompts updated to reference code map and line navigation

## [1.7.2](https://github.com/aaurelions/combicode/compare/combicode-py-v1.7.1...combicode-py-v1.7.2) (2025-01-XX)

### Bug Fixes

- **skip-content:** fix total size calculation to exclude files with skipped content
- **skip-content:** remove extra blank line after placeholder text in output

## [1.7.1](https://github.com/aaurelions/combicode/compare/combicode-py-v1.7.0...combicode-py-v1.7.1) (2025-01-XX)

### Bug Fixes

- **ci:** restore NPM_TOKEN for npm publishing to fix authentication issues

## [1.7.0](https://github.com/aaurelions/combicode/compare/combicode-py-v1.6.0...combicode-py-v1.7.0) (2025-01-XX)

### Maintenance

- **ci:** migrate npm publishing to trusted publishing (OIDC), remove NPM_TOKEN requirement

## [1.6.0](https://github.com/aaurelions/combicode/compare/combicode-py-v1.5.4...combicode-py-v1.6.0) (2025-01-XX)

### Features

- **skip-content:** add `--skip-content` option to include files in tree but omit their content (useful for large test files)

## [1.5.4](https://github.com/aaurelions/combicode/compare/combicode-py-v1.5.3...combicode-py-v1.5.4) (2025-12-03)

### Features

- **ignore:** implement full support for nested `.gitignore` files, ensuring exclusion rules are applied correctly within subdirectories

### Bug Fixes

- **walker:** refactor directory traversal to accurately respect hierarchical ignore patterns

## [1.5.3](https://github.com/aaurelions/combicode/compare/combicode-py-v1.5.2...combicode-py-v1.5.3) (2025-11-30)

### Bug Fixes

- **cli:** prevent the output file (e.g., `combicode.txt`) from recursively including itself in the generated content

## [1.5.2](https://github.com/aaurelions/combicode/compare/combicode-py-v1.4.0...combicode-py-v1.5.2) (2025-11-30)

### Features

- **tree:** display file sizes in the generated file tree (e.g., `[1.2KB]`)
- **output:** improve file header format (`### **FILE:**`) for better LLM parsing
- **tests:** add integration test suite using `pytest` and `click.testing`

## [1.4.0](https://github.com/aaurelions/combicode/compare/combicode-py-v1.3.0...combicode-py-v1.4.0) (2025-08-13)

### Features

- Add --llms-txt flag for llms.txt documentation context ([0817554](https://github.com/aaurelions/combicode/commit/081755435594b0ca5208609b2724eb47bd73c2dc))

## [1.3.0](https://github.com/aaurelions/combicode/compare/combicode-py-v1.2.1...combicode-py-v1.3.0) (2025-06-25)

### Features

- improve CLI output and version reporting ([7963a10](https://github.com/aaurelions/combicode/commit/7963a10782c2626608750de53023d37d327d51b2))
- improve CLI output and version reporting ([e74f6d8](https://github.com/aaurelions/combicode/commit/e74f6d8fbed4f9cdf8ad82f3dae87069f66f7bb6))

### Bug Fixes

- **ci:** create explicit config for all versioned files ([c6212e7](https://github.com/aaurelions/combicode/commit/c6212e7801cf99876a4f996d7e1273f88bac51c7))
- **ci:** permission error ([156b76d](https://github.com/aaurelions/combicode/commit/156b76d3ab1550123df2ded6b1da5d6e2e2cc008))
- **py:** correctly include package data via pyproject.toml ([de312b8](https://github.com/aaurelions/combicode/commit/de312b81a8dccb049ccb0c7ddf94fbd4ba510600))
- Use scoped npm package name and bump python version ([8a1b347](https://github.com/aaurelions/combicode/commit/8a1b347f6c54c9762acf354ef289c293d3ef21a3))

## [1.2.0](https://github.com/aaurelions/combicode/compare/combicode-py-v1.1.0...combicode-py-v1.2.0) (2025-06-25)

### Features

- improve CLI output and version reporting ([7963a10](https://github.com/aaurelions/combicode/commit/7963a10782c2626608750de53023d37d327d51b2))
- improve CLI output and version reporting ([e74f6d8](https://github.com/aaurelions/combicode/commit/e74f6d8fbed4f9cdf8ad82f3dae87069f66f7bb6))

### Bug Fixes

- **ci:** create explicit config for all versioned files ([c6212e7](https://github.com/aaurelions/combicode/commit/c6212e7801cf99876a4f996d7e1273f88bac51c7))
- **ci:** permission error ([156b76d](https://github.com/aaurelions/combicode/commit/156b76d3ab1550123df2ded6b1da5d6e2e2cc008))
- **py:** correctly include package data via pyproject.toml ([de312b8](https://github.com/aaurelions/combicode/commit/de312b81a8dccb049ccb0c7ddf94fbd4ba510600))
- Use scoped npm package name and bump python version ([8a1b347](https://github.com/aaurelions/combicode/commit/8a1b347f6c54c9762acf354ef289c293d3ef21a3))
