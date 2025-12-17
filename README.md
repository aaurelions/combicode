# Combicode

[![NPM Version](https://img.shields.io/npm/v/combicode.svg)](https://www.npmjs.com/package/combicode)
[![PyPI Version](https://img.shields.io/pypi/v/combicode.svg)](https://pypi.org/project/combicode/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

<img align="center" src="https://github.com/aaurelions/combicode/raw/main/screenshot.png" width="800"/>

**Combicode** is a zero-dependency CLI tool that intelligently combines your project's source code into a single, LLM-friendly text file.

The generated file starts with a system prompt and a file tree overview, priming the LLM to understand your project's complete context instantly. Paste the contents of `combicode.txt` into ChatGPT, Claude, or any other LLM to get started.

## Why use Combicode?

- **Maximum Context:** Gives your LLM a complete picture of your project structure and code.
- **Intelligent Priming:** Starts the output with a system prompt and a file tree, directing the LLM to analyze the entire codebase before responding.
- **Intelligent Ignoring:** Automatically skips `node_modules`, `.venv`, `dist`, `.git`, binary files, and other common junk.
- **`.gitignore` Aware:** Respects your project's existing `.gitignore` rules out of the box.
- **Nested Ignore Support:** Correctly handles `.gitignore` files located in subdirectories, ensuring local exclusion rules are respected.
- **Zero-Install Usage:** Run it directly with `npx` or `pipx` without polluting your environment.
- **Customizable:** Easily filter by file extension or add custom ignore patterns.

## Quick Start

Navigate to your project's root directory in your terminal and run one of the following commands:

#### For Node.js/JavaScript/TypeScript projects (via `npx`):

```bash
npx combicode
```

#### For Python projects (or general use, via `pipx`):

```bash
pipx run combicode
```

This will create a `combicode.txt` file in your project directory, complete with the context-setting header.

## Usage and Options

### Preview which files will be included

Use the `--dry-run` or `-d` flag to see a list of files without creating the output file.

```bash
# npx
npx combicode --dry-run

# pipx
pipx run combicode -d
```

### Specify an output file

Use the `--output` or `-o` flag.

```bash
npx combicode -o my_project_context.md
```

### Include only specific file types

Use the `--include-ext` or `-i` flag with a comma-separated list of extensions.

```bash
# Include only TypeScript, TSX, and CSS files
npx combicode -i .ts,.tsx,.css

# Include only Python and YAML files
pipx run combicode -i .py,.yaml
```

### Add custom exclude patterns

Use the `--exclude` or `-e` flag with comma-separated glob patterns.

```bash
# Exclude all test files and anything in a 'docs' folder
npx combicode -e "**/*_test.py,docs/**"
```

### Skip content for specific files

Use the `--skip-content` flag to include files in the tree structure but omit their content. This is useful for large files (like test files) that you want visible in the project overview but don't need their full content.

```bash
# Include .test.ts files in tree but skip their content
npx combicode --skip-content "**/*.test.ts"

# Skip content for multiple patterns
npx combicode --skip-content "**/*.test.ts,**/*.spec.ts,**/tests/**"
```

Files with skipped content will be marked with `(content omitted)` in the file tree and will show a placeholder in the content section.

### Generating Context for `llms.txt`

The `--llms.txt` or `-l` flag is designed for projects that use an [`llms.txt`](https://llmstxt.org/) file to specify important documentation. When this flag is used, Combicode inserts a specialized system prompt telling the LLM that the provided context is the project's definitive documentation for a specific version. This helps the LLM provide more accurate answers and avoid using deprecated functions.

```bash
# Combine all markdown files for an llms.txt context
npx combicode -l -i .md -o llms.txt
```

## All CLI Options

| Option           | Alias | Description                                                                    | Default         |
| ---------------- | ----- | ------------------------------------------------------------------------------ | --------------- |
| `--output`       | `-o`  | The name of the output file.                                                   | `combicode.txt` |
| `--dry-run`      | `-d`  | Preview files without creating the output file.                                | `false`         |
| `--include-ext`  | `-i`  | Comma-separated list of extensions to exclusively include.                     | (include all)   |
| `--exclude`      | `-e`  | Comma-separated list of additional glob patterns to exclude.                   | (none)          |
| `--skip-content` |       | Comma-separated glob patterns for files to include in tree but omit content.   | (none)          |
| `--llms-txt`     | `-l`  | Use a specialized system prompt for context generated from an `llms.txt` file. | `false`         |
| `--no-gitignore` |       | Do not use patterns from the project's `.gitignore` file.                      | `false`         |
| `--no-header`    |       | Omit the introductory prompt and file tree from the output.                    | `false`         |
| `--version`      | `-v`  | Show the version number.                                                       |                 |
| `--help`         | `-h`  | Show the help message.                                                         |                 |

## License

This project is licensed under the MIT License.
