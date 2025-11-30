import os
import sys
import json
import math
from pathlib import Path
import click
import pathspec
from importlib import metadata

DEFAULT_SYSTEM_PROMPT = """You are an expert software architect. The user is providing you with the complete source code for a project, contained in a single file. Your task is to meticulously analyze the provided codebase to gain a comprehensive understanding of its structure, functionality, dependencies, and overall architecture.

A file tree is provided below to give you a high-level overview. The subsequent sections contain the full content of each file, clearly marked with a file header.

Your instructions are:
1.  **Analyze Thoroughly:** Read through every file to understand its purpose and how it interacts with other files.
2.  **Identify Key Components:** Pay close attention to configuration files (like package.json, pyproject.toml), entry points (like index.js, main.py), and core logic.
"""

LLMS_TXT_SYSTEM_PROMPT = """You are an expert software architect. The user is providing you with the full documentation for a project, sourced from the project's 'llms.txt' file. This file contains the complete context needed to understand the project's features, APIs, and usage for a specific version. Your task is to act as a definitive source of truth based *only* on this provided documentation.

When answering questions or writing code, adhere strictly to the functions, variables, and methods described in this context. Do not use or suggest any deprecated or older functionalities that are not present here.

A file tree of the documentation source is provided below for a high-level overview. The subsequent sections contain the full content of each file, clearly marked with a file header.
"""

def load_default_ignore_patterns():
    try:
        config_path = Path(__file__).resolve().parent / 'config' / 'ignore.json'
        with config_path.open('r', encoding='utf-8') as f:
            return json.load(f)
    except (IOError, json.JSONDecodeError) as e:
        click.echo(f"❌ Critical: Could not read or parse bundled ignore config: {e}", err=True)
        sys.exit(1)

def is_likely_binary(path: Path) -> bool:
    try:
        with path.open('rb') as f:
            return b'\0' in f.read(1024)
    except IOError:
        return True

def format_bytes(size: int) -> str:
    if size == 0:
        return "0 B"
    size_name = ("B", "KB", "MB", "GB", "TB")
    i = int(math.floor(math.log(size, 1024)))
    p = math.pow(1024, i)
    s = round(size / p, 1)
    return f"{s}{size_name[i]}"

def generate_file_tree(files_data: list[dict], root: Path) -> str:
    tree_lines = [f"{root.name}/"]
    structure = {}
    
    # Build structure
    for item in files_data:
        path_parts = item['relative_path'].parts
        current_level = structure
        for i, part in enumerate(path_parts):
            is_file = (i == len(path_parts) - 1)
            if is_file:
                current_level[part] = item['formatted_size']
            else:
                current_level = current_level.setdefault(part, {})

    def build_tree(level, prefix=""):
        entries = sorted(level.keys())
        for i, entry in enumerate(entries):
            is_last = i == len(entries) - 1
            connector = "└── " if is_last else "├── "
            
            value = level[entry]
            
            if isinstance(value, str):
                tree_lines.append(f"{prefix}{connector}[{value}] {entry}")
            else:
                tree_lines.append(f"{prefix}{connector}{entry}")
                if value:
                    new_prefix = prefix + ("    " if is_last else "│   ")
                    build_tree(value, new_prefix)

    build_tree(structure)
    return "\n".join(tree_lines)


@click.command(context_settings=dict(help_option_names=['-h', '--help']))
@click.option("-o", "--output", default="combicode.txt", help="The name of the output file.", show_default=True)
@click.option("-d", "--dry-run", is_flag=True, help="Preview files without creating the output file.")
@click.option("-i", "--include-ext", help="Comma-separated list of extensions to exclusively include (e.g., .py,.js).")
@click.option("-e", "--exclude", help="Comma-separated list of additional glob patterns to exclude.")
@click.option("-l", "--llms-txt", is_flag=True, help="Use the system prompt for llms.txt context.")
@click.option("--no-gitignore", is_flag=True, help="Do not use patterns from the project's .gitignore file.")
@click.option("--no-header", is_flag=True, help="Omit the introductory prompt and file tree from the output.")
@click.version_option(metadata.version("combicode"), '-v', '--version', prog_name="Combicode", message="%(prog)s (Python), version %(version)s")
def cli(output, dry_run, include_ext, exclude, llms_txt, no_gitignore, no_header):
    """Combicode combines your project's code into a single file for LLM context."""
    
    default_ignore_patterns = load_default_ignore_patterns()

    project_root = Path.cwd().resolve()
    click.echo(f"✨ Running Combicode in: {project_root}")

    all_ignore_patterns = default_ignore_patterns.copy()
    if not no_gitignore:
        gitignore_path = project_root / ".gitignore"
        if gitignore_path.exists():
            click.echo("🔎 Found and using .gitignore")
            with gitignore_path.open("r", encoding='utf-8') as f:
                all_ignore_patterns.extend(line for line in f.read().splitlines() if line and not line.startswith('#'))
    
    if exclude:
        all_ignore_patterns.extend(exclude.split(','))

    spec = pathspec.PathSpec.from_lines(pathspec.patterns.GitWildMatchPattern, all_ignore_patterns)

    all_paths = list(project_root.rglob("*"))
    
    included_files_data = []
    allowed_extensions = {f".{ext.strip('.')}" for ext in include_ext.split(',')} if include_ext else None

    for path in all_paths:
        if not path.is_file():
            continue
        
        try:
            relative_path = path.relative_to(project_root)
        except ValueError:
            continue

        relative_path_str = str(relative_path.as_posix())
        
        if spec.match_file(relative_path_str) or is_likely_binary(path):
            continue
        if allowed_extensions and path.suffix not in allowed_extensions:
            continue
            
        try:
            size = path.stat().st_size
            included_files_data.append({
                'path': path,
                'relative_path': relative_path,
                'formatted_size': format_bytes(size)
            })
        except OSError:
            continue

    if not included_files_data:
        click.echo("❌ No files to include. Check your path or filters.", err=True)
        sys.exit(1)

    included_files_data.sort(key=lambda x: x['path'])

    if dry_run:
        click.echo("\n📋 Files to be included (Dry Run):\n")
        tree = generate_file_tree(included_files_data, project_root)
        click.echo(tree)
        click.echo(f"\nTotal: {len(included_files_data)} files.")
        return

    try:
        with open(output, "w", encoding="utf-8", errors='replace') as outfile:
            if not no_header:
                system_prompt = LLMS_TXT_SYSTEM_PROMPT if llms_txt else DEFAULT_SYSTEM_PROMPT
                outfile.write(system_prompt + "\n")
                outfile.write("## Project File Tree\n\n")
                outfile.write("```\n")
                tree = generate_file_tree(included_files_data, project_root)
                outfile.write(tree + "\n")
                outfile.write("```\n\n")
                outfile.write("---\n\n");

            for item in included_files_data:
                relative_path = item['relative_path'].as_posix()
                outfile.write(f"### **FILE:** `{relative_path}`\n")
                outfile.write("```\n")
                try:
                    content = item['path'].read_text(encoding="utf-8")
                    outfile.write(content)
                except Exception as e:
                    outfile.write(f"... (error reading file: {e}) ...")
                outfile.write("\n```\n\n")
        click.echo(f"\n✅ Success! Combined {len(included_files_data)} files into '{output}'.")
    except IOError as e:
        click.echo(f"\n❌ Error writing to output file: {e}", err=True)
        sys.exit(1)

if __name__ == "__main__":
    cli()