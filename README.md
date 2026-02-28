# Combicode

[![NPM Version](https://img.shields.io/npm/v/combicode.svg)](https://www.npmjs.com/package/combicode)
[![PyPI Version](https://img.shields.io/pypi/v/combicode.svg)](https://pypi.org/project/combicode/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

<img align="center" src="https://github.com/aaurelions/combicode/raw/main/screenshot.png" width="800"/>

**Combicode** is a CLI tool that intelligently combines your project's source code into a single, LLM-friendly text file with an **expanded code map** showing classes, functions, and loops with precise line references.

The generated file starts with a system prompt and an **expanded tree structure** that shows not just files, but also the code elements inside them (classes, functions, loops) with their line numbers and sizes. This gives the LLM a complete mental model of your codebase architecture before it reads a single line of code.

---

## Table of Contents

- [Why use Combicode?](#why-use-combicode)
- [Quick Start](#quick-start)
- [Supported Languages](#supported-languages)
- [Usage and Options](#usage-and-options)
- [All CLI Options](#all-cli-options)
- [How the Code Map Works](#how-the-code-map-works)
- [Examples](#examples)
- [License](#license)

---

## Why use Combicode?

| Feature                      | Description                                                                                                      |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 🗺️ **Expanded Code Map**     | Shows classes, functions, and loops with line numbers and sizes - LLMs understand your architecture instantly    |
| 🎯 **Precise Navigation**    | Every element has `[OL: X-Y \| ML: X-Y \| SIZE]` references for both original and merged line numbers            |
| 📦 **Maximum Context**       | Gives your LLM a complete picture of your project structure and code                                             |
| 🌍 **40+ Languages**         | Python (AST-based), JavaScript, TypeScript, Go, Rust, Java, C/C++, C#, PHP, Ruby, Swift, Kotlin, Scala, and more |
| 🧹 **Intelligent Ignoring**  | Automatically skips `node_modules`, `.venv`, `dist`, `.git`, binary files, and other common junk                 |
| 📝 **`.gitignore` Aware**    | Respects your project's existing `.gitignore` rules out of the box                                               |
| 📁 **Nested Ignore Support** | Correctly handles `.gitignore` files located in subdirectories                                                   |
| ⚡ **Zero-Install Usage**    | Run it directly with `npx` or `pipx` without polluting your environment                                          |
| 🔄 **Recreate Support**      | Extract files from `combicode.txt` back to original project structure                                            |

---

## Quick Start

Navigate to your project's root directory in your terminal and run one of the following commands:

### For Node.js/JavaScript/TypeScript projects (via `npx`)

```bash
npx combicode
```

### For Python projects (via `pipx`)

```bash
pipx run combicode
```

This will create a `combicode.txt` file in your project directory with the expanded code map.

---

## Supported Languages

Combicode parses code structure for 40+ programming languages:

### Full Language Support Table

| Language   | Parser         | Elements Detected                                      |
| ---------- | -------------- | ------------------------------------------------------ |
| Python     | AST (built-in) | `class`, `def`, `async def`, `for`, `while`            |
| JavaScript | Regex          | `class`, `function`, `async function`, arrow functions |
| TypeScript | Regex          | `class`, `interface`, `function`, `async function`     |
| Go         | Regex          | `struct`, `interface`, `func`                          |
| Rust       | Regex          | `struct`, `enum`, `trait`, `impl`, `fn`                |
| Java       | Regex          | `class`, `interface`, `enum`, methods                  |
| C/C++      | Regex          | `class`, `struct`, functions                           |
| C#         | Regex          | `class`, `struct`, `interface`, `enum`, `record`       |
| PHP        | Regex          | `class`, `interface`, `trait`, `function`              |
| Ruby       | Regex          | `class`, `module`, `def`                               |
| Swift      | Regex          | `class`, `struct`, `enum`, `protocol`, `func`          |
| Kotlin     | Regex          | `class`, `interface`, `object`, `fun`                  |
| Scala      | Regex          | `class`, `object`, `trait`, `def`                      |
| Lua        | Regex          | `function`, `local function`                           |
| Perl       | Regex          | `sub`, `package`                                       |
| Bash       | Regex          | `function`, `for`, `while`                             |

### Configuration Files (No Parsing)

These files are included in the tree but not parsed for code structure:

| Type   | Extensions                                        |
| ------ | ------------------------------------------------- |
| Config | `.json`, `.yaml`, `.yml`, `.toml`, `.ini`, `.env` |
| Markup | `.md`, `.rst`, `.txt`                             |
| Styles | `.css`, `.scss`, `.less`, `.sass`                 |

---

## Usage and Options

### Preview which files will be included

Use the `--dry-run` or `-d` flag to see a list of files without creating the output file.

```bash
npx combicode --dry-run
pipx run combicode -d
```

**Example output:**

```text
✨ Combicode v2.0.0

📂 Root: /home/user/my-project

📋 Files to include (dry run):

   src/index.ts (2.1KB)
   src/server.ts (3.4KB)
   src/utils/db.ts (1.2KB)
   package.json (0.8KB)
   tsconfig.json (0.3KB)

📊 Summary:
   • Total files: 5
   • Total size: 7.8KB

✅ Done!
```

### Specify an output file

Use the `--output` or `-o` flag.

```bash
npx combicode -o my_project_context.md
pipx run combicode --output ./output/context.txt
```

### Include only specific file types

Use the `--include-ext` or `-i` flag with a comma-separated list of extensions.

```bash
# Include only TypeScript, TSX, and CSS files
npx combicode -i .ts,.tsx,.css

# Include only Python and YAML files
pipx run combicode -i .py,.yaml

# Include only markdown documentation
npx combicode -i .md -o llms.txt
```

### Add custom exclude patterns

Use the `--exclude` or `-e` flag with comma-separated glob patterns.

```bash
# Exclude all test files and anything in a 'docs' folder
npx combicode -e "**/*_test.py,docs/**"

# Exclude generated files and fixtures
pipx run combicode -e "**/*.generated.*,fixtures/**"
```

### Skip content for specific files

Use the `--skip-content` flag to include files in the tree structure but omit their content. This is useful for large files (like test files) that you want visible in the project overview but don't need their full content.

```bash
# Include .test.ts files in tree but skip their content
npx combicode --skip-content "**/*.test.ts"

# Skip content for multiple patterns
npx combicode --skip-content "**/*.test.ts,**/*.spec.ts,**/tests/**"

# Skip large generated files
pipx run combicode --skip-content "**/*.min.js,dist/**"
```

**Output with skipped content:**

```text
└── tests/
    └── test_server.py [OL: 1-450 | ML: 183-184 | 12.1KB]
        (Content omitted - file size: 12.1KB)
```

### Disable code structure parsing

Use the `--no-parse` flag to generate a simple file tree without parsing classes, functions, or loops. This is useful for quick overviews or when parsing is not needed.

```bash
npx combicode --no-parse
```

**Output with `--no-parse`:**

```text
<code_index>
project-root/
├── src/
│   ├── server.py [OL: 1-85 | ML: 53-137 | 2.4KB]
│   └── utils/
│       └── db.py [OL: 1-45 | ML: 138-182 | 1.2KB]
└── tests/
    └── test_server.py [OL: 1-50 | ML: 183-232 | 1.1KB]
</code_index>
```

### Generating Context for `llms.txt`

The `--llms-txt` or `-l` flag is designed for projects that use an [`llms.txt`](https://llmstxt.org/) file to specify important documentation.

```bash
# Combine all markdown files for an llms.txt context
npx combicode -l -i .md -o llms.txt

# Combine documentation from docs folder
pipx run combicode -l -i .md,.rst -o llms.txt
```

### Recreate Project from combicode.txt

The `--recreate` or `-r` flag extracts all files from a `combicode.txt` file and recreates the original project structure. This is useful for:

- 🔄 Restoring a project from an LLM-generated context
- 📤 Extracting code shared by others in `combicode.txt` format
- 🛠️ Converting the merged file back to individual source files

```bash
# Recreate project from combicode.txt (default)
npx combicode --recreate

# Specify input file and output directory
npx combicode --recreate --input my_context.txt -o ./restored_project

# Short form
npx combicode -r -i my_context.txt -o ./output

# Dry run to see what files would be extracted
npx combicode --recreate --dry-run

# Overwrite existing files
npx combicode --recreate --overwrite
```

**Example output:**

```text
✨ Combicode v2.0.0

📂 Root: /home/user/projects

📂 Output directory: /home/user/projects

   src/index.ts (2.1KB)
   src/server.ts (3.4KB)
   src/utils/db.ts (1.2KB)
   src/utils/logger.ts (0.8KB)
   src/handlers/user.ts (1.5KB)
   src/handlers/auth.ts (1.2KB)
   config/app.yaml (0.4KB)
   package.json (0.8KB)
   tsconfig.json (0.3KB)
   ...

📊 Summary:
   • Files recreated: 15
   • Total size: 45.2KB

✅ Done!
```

---

## All CLI Options

| Option           | Alias | Description                                                                    | Default         |
| ---------------- | ----- | ------------------------------------------------------------------------------ | --------------- |
| `--output`       | `-o`  | Output file (combine) or directory (recreate).                                 | `combicode.txt` |
| `--dry-run`      | `-d`  | Preview without making changes.                                                | `false`         |
| `--include-ext`  | `-i`  | Comma-separated list of extensions to exclusively include.                     | (include all)   |
| `--exclude`      | `-e`  | Comma-separated list of additional glob patterns to exclude.                   | (none)          |
| `--skip-content` |       | Comma-separated glob patterns for files to include in tree but omit content.   | (none)          |
| `--no-parse`     |       | Disable code structure parsing (show only file tree).                          | `false`         |
| `--llms-txt`     | `-l`  | Use a specialized system prompt for context generated from an `llms.txt` file. | `false`         |
| `--no-gitignore` |       | Do not use patterns from the project's `.gitignore` file.                      | `false`         |
| `--no-header`    |       | Omit the introductory prompt and file tree from the output.                    | `false`         |
| `--recreate`     | `-r`  | Recreate project from a combicode.txt file.                                    | `false`         |
| `--input`        |       | Input combicode.txt file for recreate.                                         | `combicode.txt` |
| `--overwrite`    |       | Overwrite existing files when recreating.                                      | `false`         |
| `--version`      | `-v`  | Show the version number.                                                       |                 |
| `--help`         | `-h`  | Show the help message.                                                         |                 |

---

## How the Code Map Works

### Line Reference System

Every element has dual line references:

| Reference              | Description                                       | Usage                           |
| ---------------------- | ------------------------------------------------- | ------------------------------- |
| **OL (Original Line)** | Line numbers in the source file on disk           | Find code in original project   |
| **ML (Merged Line)**   | Line numbers in the combined `combicode.txt` file | Extract code with `sed` command |

**Extracting code using ML:**

```bash
# Extract lines 100-150 from combicode.txt
sed -n '100,150p' combicode.txt

# Extract a specific function
sed -n '69,97p' combicode.txt  # Extracts async start() method
```

### Element Types

The code map extracts these element types:

| Label      | Description                                 | Example                          |
| ---------- | ------------------------------------------- | -------------------------------- |
| `class`    | Classes, structs, interfaces, enums, traits | `class Server`                   |
| `fn`       | Functions and methods                       | `fn parse_args()`                |
| `async`    | Async functions                             | `async fetch_data()`             |
| `ctor`     | Constructors (`__init__`, `constructor`)    | `ctor __init__(self, port: int)` |
| `loop`     | For/while loops (only if > 5 lines)         | `loop for item in items`         |
| `impl`     | Implementation blocks (Rust)                | `impl Server`                    |
| `test`     | Test functions                              | `test test_server_start`         |
| `describe` | Test suites                                 | `describe Server`                |

### Filtering Rules

| Category                   | Elements                                                 |
| -------------------------- | -------------------------------------------------------- |
| **Always included**        | Files, classes, functions, constructors                  |
| **Conditionally included** | Loops and try/catch blocks (only if > 5-10 lines)        |
| **Excluded**               | Imports, comments, single-line elements, getters/setters |

---

## Examples

### Python Project

```text
src/
├── main.py [OL: 1-85 | ML: 53-137 | 2.4KB]
│   ├── class Server [OL: 5-60 | ML: 57-112 | 1.8KB]
│   │   ├── ctor __init__(self, host: str, port: int) [OL: 7-15 | ML: 59-67 | 284B]
│   │   ├── async start(self) -> None [OL: 17-45 | ML: 69-97 | 892B]
│   │   └── fn stop(self) -> None [OL: 47-55 | ML: 99-107 | 256B]
│   └── fn parse_args() -> dict [OL: 63-85 | ML: 115-137 | 612B]
├── utils/
│   └── db.py [OL: 1-45 | ML: 138-182 | 1.2KB]
│       └── class Database [OL: 5-40 | ML: 142-177 | 1.1KB]
│           ├── ctor __init__(self, connection_string: str) [OL: 7-15 | ML: 144-152 | 312B]
│           └── fn query(self, sql: str) -> list [OL: 17-40 | ML: 154-177 | 756B]
└── config.py [OL: 1-20 | ML: 183-202 | 0.4KB]
```

### TypeScript Project

```text
src/
├── index.ts [OL: 1-52 | ML: 53-104 | 2.1KB]
│   ├── class Server [OL: 5-42 | ML: 57-94 | 1.5KB]
│   │   ├── ctor (port: number, host?: string) [OL: 7-14 | ML: 59-66 | 256B]
│   │   ├── async start(): Promise<void> [OL: 16-32 | ML: 68-84 | 612B]
│   │   └── fn stop(): void [OL: 34-42 | ML: 86-94 | 298B]
│   └── fn createApp(config: Config): Express [OL: 45-52 | ML: 97-104 | 412B]
├── handlers/
│   └── user.ts [OL: 1-78 | ML: 105-182 | 2.4KB]
│       ├── interface UserRoutes [OL: 5-15 | ML: 109-119 | 312B]
│       └── fn createUser(req: Request, res: Response) [OL: 17-78 | ML: 121-182 | 1.8KB]
└── types/
    └── index.ts [OL: 1-25 | ML: 183-207 | 0.5KB]
        └── interface Config [OL: 3-25 | ML: 185-207 | 456B]
```

### Go Project

```text
cmd/
└── server/
    └── main.go [OL: 1-60 | ML: 53-112 | 1.6KB]
        └── fn main() [OL: 5-60 | ML: 57-112 | 1.4KB]

internal/
├── handlers/
│   └── user.go [OL: 1-120 | ML: 113-232 | 3.2KB]
│       ├── struct UserHandler [OL: 8-25 | ML: 120-137 | 512B]
│       └── fn NewUserHandler(db *sql.DB) *UserHandler [OL: 27-35 | ML: 139-147 | 234B]
└── models/
    └── user.go [OL: 1-45 | ML: 233-277 | 1.1KB]
        └── struct User [OL: 5-45 | ML: 237-277 | 945B]
```

### Rust Project

```text
src/
├── main.rs [OL: 1-45 | ML: 53-97 | 1.2KB]
│   └── fn main() [OL: 3-45 | ML: 55-97 | 1.0KB]
├── server/
│   └── mod.rs [OL: 1-120 | ML: 98-217 | 3.4KB]
│       ├── struct Server [OL: 5-25 | ML: 102-122 | 612B]
│       ├── impl Server [OL: 27-100 | ML: 124-197 | 2.5KB]
│       │   ├── fn new(host: &str, port: u16) -> Self [OL: 29-45 | ML: 126-142 | 456B]
│       │   └── async fn start(&self) -> Result<()> [OL: 47-100 | ML: 144-197 | 1.8KB]
│       └── fn create_server(config: Config) -> Server [OL: 102-120 | ML: 199-217 | 534B]
└── config.rs [OL: 1-35 | ML: 218-252 | 0.8KB]
    └── struct Config [OL: 3-35 | ML: 220-252 | 712B]
```

### Java Project

```text
src/main/java/com/example/
├── Application.java [OL: 1-30 | ML: 53-82 | 0.9KB]
│   └── class Application [OL: 3-30 | ML: 55-82 | 756B]
│       └── fn main(String[] args) [OL: 5-30 | ML: 57-82 | 654B]
├── server/
│   └── Server.java [OL: 1-150 | ML: 83-232 | 4.2KB]
│       ├── class Server [OL: 5-120 | ML: 87-202 | 3.4KB]
│       │   ├── ctor Server(int port, String host) [OL: 15-35 | ML: 97-117 | 612B]
│       │   ├── fn start() [OL: 37-80 | ML: 119-162 | 1.2KB]
│       │   └── fn stop() [OL: 82-120 | ML: 164-202 | 1.1KB]
│       └── class ServerBuilder [OL: 122-150 | ML: 204-232 | 756B]
└── config/
    └── Config.java [OL: 1-45 | ML: 233-277 | 1.1KB]
        └── class Config [OL: 3-45 | ML: 235-277 | 1.0KB]
```

---

## License

This project is licensed under the MIT License.
