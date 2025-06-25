import os
import sys
import json
from pathlib import Path
import click
import pathspec
from importlib import metadata

SYSTEM_PROMPT = """You are an expert software architect. The user is providing you with the complete source code for a project, contained in a single file. Your task is to meticulously analyze the provided codebase to gain a comprehensive understanding of its structure, functionality, dependencies, and overall architecture.

A file tree is provided below to give you a high-level overview. The subsequent sections contain the full content of each file, clearly marked with "// FILE: <path>".

Your instructions are:
1.  **Analyze Thoroughly:** Read through every file to understand its purpose and how it interacts with other files.
2.  **Identify Key Components:** Pay close attention to configuration files (like package.json, pyproject.toml), entry points (like index.js, main.py), and core logic.
"""

def load_default_ignore_patterns():
    try:
        config_path = Path(__file__).resolve().parent / 'config' / 'ignore.json'
        with config_path.open('r', encoding='utf-8') as f:
            return json.load(f)
    except (IOError, json.JSONDecodeError) as e:
        click.echo(f"❌ Critical: Could not read or parse bundled ignore config: {e}", err=True)
        sys.exit(1)

DEFAULT_IGNORE_PATTERNS = load_default_ignore_patterns()

def is_likely_binary(path: Path) -> bool:
    try:
        with path.open('rb') as f:
            return b'\0' in f.read(1024)
    except IOError:
        return True

def generate_file_tree(relative_paths: list[Path], root: Path) -> str:
    tree_lines = [f"{root.name}/"]
    structure = {}
    for path in sorted(relative_paths):
        parts = path.parts
        current_level = structure
        for part in parts:
            current_level = current_level.setdefault(part, {})

    def build_tree(level, prefix=""):
        entries = sorted(level.keys())
        for i, entry in enumerate(entries):
            is_last = i == len(entries) - 1
            connector = "└── " if is_last else "├── "
            tree_lines.append(f"{prefix}{connector}{entry}")
            if level[entry]:
                new_prefix = prefix + ("    " if is_last else "│   ")
                build_tree(level[entry], new_prefix)

    build_tree(structure)
    return "\n".join(tree_lines)


@click.command(context_settings=dict(help_option_names=['-h', '--help']))
@click.option("-o", "--output", default="combicode.txt", help="The name of the output file.", show_default=True)
@click.option("-d", "--dry-run", is_flag=True, help="Preview files without creating the output file.")
@click.option("-i", "--include-ext", help="Comma-separated list of extensions to exclusively include (e.g., .py,.js).")
@click.option("-e", "--exclude", help="Comma-separated list of additional glob patterns to exclude.")
@click.option("--no-gitignore", is_flag=True, help="Do not use patterns from the project's .gitignore file.")
@click.option("--no-header", is_flag=True, help="Omit the introductory prompt and file tree from the output.")
@click.version_option(metadata.version("combicode"), '-v', '--version', prog_name="Combicode", message="%(prog)s (Python), version %(version)s")
def cli(output, dry_run, include_ext, exclude, no_gitignore, no_header):
    """Combicode combines your project's code into a single file for LLM context."""
    project_root = Path.cwd()
    click.echo(f"✨ Running Combicode in: {project_root}")

    all_ignore_patterns = DEFAULT_IGNORE_PATTERNS.copy()
    if not no_gitignore:
        gitignore_path = project_root / ".gitignore"
        if gitignore_path.exists():
            click.echo("🔎 Found and using .gitignore")
            with gitignore_path.open("r", encoding='utf-8') as f:
                all_ignore_patterns.extend(line for line in f.read().splitlines() if line and not line.startswith('#'))
    
    if exclude:
        all_ignore_patterns.extend(exclude.split(','))

    spec = pathspec.PathSpec.from_lines(pathspec.patterns.GitWildMatchPattern, all_ignore_patterns)

    all_paths = project_root.rglob("*")
    
    included_files = []
    allowed_extensions = {f".{ext.strip('.')}" for ext in include_ext.split(',')} if include_ext else None

    for path in all_paths:
        if not path.is_file():
            continue
        relative_path_str = str(path.relative_to(project_root).as_posix())
        if spec.match_file(relative_path_str) or is_likely_binary(path):
            continue
        if allowed_extensions and path.suffix not in allowed_extensions:
            continue
        included_files.append(path)

    if not included_files:
        click.echo("❌ No files to include. Check your path or filters.", err=True)
        sys.exit(1)

    sorted_files = sorted(included_files)
    relative_paths = [p.relative_to(project_root) for p in sorted_files]

    if dry_run:
        click.echo("\n📋 Files to be included (Dry Run):\n")
        tree = generate_file_tree(relative_paths, project_root)
        click.echo(tree)
        click.echo(f"\nTotal: {len(sorted_files)} files.")
        return

    try:
        with open(output, "w", encoding="utf-8", errors='replace') as outfile:
            if not no_header:
                outfile.write(SYSTEM_PROMPT + "\n")
                outfile.write("## Project File Tree\n\n")
                outfile.write("```\n")
                tree = generate_file_tree(relative_paths, project_root)
                outfile.write(tree + "\n")
                outfile.write("```\n\n")
                outfile.write("---\n\n")

            for path in sorted_files:
                relative_path = path.relative_to(project_root).as_posix()
                outfile.write(f"// FILE: {relative_path}\n")
                outfile.write("```\n")
                try:
                    content = path.read_text(encoding="utf-8")
                    outfile.write(content)
                except Exception as e:
                    outfile.write(f"... (error reading file: {e}) ...")
                outfile.write("\n```\n\n")
        click.echo(f"\n✅ Success! Combined {len(sorted_files)} files into '{output}'.")
    except IOError as e:
        click.echo(f"\n❌ Error writing to output file: {e}", err=True)
        sys.exit(1)

if __name__ == "__main__":
    cli()