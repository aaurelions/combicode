# Combicode

[![NPM Version](https://img.shields.io/npm/v/combicode.svg)](https://www.npmjs.com/package/combicode)
[![PyPI Version](https://img.shields.io/pypi/v/combicode.svg)](https://pypi.org/project/combicode/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

<img align="center" src="https://github.com/aaurelions/combicode/raw/main/screenshot.png" width="600"/>

**Combicode** is a zero-dependency CLI tool that intelligently combines your project's source code into a single, LLM-friendly text file.

Paste the contents of `combicode.txt` into ChatGPT, Claude, or any other LLM to give it the full context of your repository instantly.

## Why use Combicode?

- **Maximum Context:** Give your LLM a complete picture of your project structure and code.
- **Intelligent Ignoring:** Automatically skips `node_modules`, `.venv`, `dist`, `.git`, binary files, and other common junk.
- **`.gitignore` Aware:** Respects your project's existing `.gitignore` rules out of the box.
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

This will create a `combicode.txt` file in your project directory.

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

## All CLI Options

| Option           | Alias | Description                                                  | Default         |
| ---------------- | ----- | ------------------------------------------------------------ | --------------- |
| `--output`       | `-o`  | The name of the output file.                                 | `combicode.txt` |
| `--dry-run`      | `-d`  | Preview files without creating the output file.              | `false`         |
| `--include-ext`  | `-i`  | Comma-separated list of extensions to exclusively include.   | (include all)   |
| `--exclude`      | `-e`  | Comma-separated list of additional glob patterns to exclude. | (none)          |
| `--no-gitignore` |       | Do not use patterns from the project's `.gitignore` file.    | `false`         |
| `--version`      | `-v`  | Show the version number.                                     |                 |
| `--help`         | `-h`  | Show the help message.                                       |                 |

## License

This project is licensed under the MIT License.
