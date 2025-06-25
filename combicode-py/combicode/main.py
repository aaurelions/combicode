import os
import sys
from pathlib import Path
import click
import pathspec
from importlib import metadata

DEFAULT_IGNORE_PATTERNS = [
    ".git/", ".vscode/", ".idea/", "*.log", ".env", "*.lock",
    ".venv/", "venv/", "env/", "__pycache__/", "*.pyc", "*.egg-info/", "build/", "dist/", ".pytest_cache/",
    "node_modules/", ".npm/", "pnpm-lock.yaml", "package-lock.json", ".next/",
    ".DS_Store", "Thumbs.db",
    "*.png", "*.jpg", "*.jpeg", "*.gif", "*.ico", "*.svg", "*.webp",
    "*.mp3", "*.wav", "*.flac",
    "*.mp4", "*.mov", "*.avi",
    "*.zip", "*.tar.gz", "*.rar",
    "*.pdf", "*.doc", "*.docx", "*.xls", "*.xlsx",
    "*.dll", "*.exe", "*.so", "*.a", "*.lib", "*.o",
    "*.bin", "*.iso",
]

def is_likely_binary(path: Path) -> bool:
    try:
        with path.open('rb') as f:
            return b'\0' in f.read(1024)
    except IOError:
        return True

@click.command(context_settings=dict(help_option_names=['-h', '--help']))
@click.option("-o", "--output", default="combicode.txt", help="The name of the output file.", show_default=True)
@click.option("-d", "--dry-run", is_flag=True, help="Preview files without creating the output file.")
@click.option("-i", "--include-ext", help="Comma-separated list of extensions to exclusively include (e.g., .py,.js).")
@click.option("-e", "--exclude", help="Comma-separated list of additional glob patterns to exclude.")
@click.option("--no-gitignore", is_flag=True, help="Do not use patterns from the project's .gitignore file.")
@click.version_option(version=metadata.version("combicode"), prog_name="Combicode")
def cli(output, dry_run, include_ext, exclude, no_gitignore):
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
        relative_path_str = str(path.relative_to(project_root))
        if spec.match_file(relative_path_str) or is_likely_binary(path):
            continue
        if allowed_extensions and path.suffix not in allowed_extensions:
            continue
        included_files.append(path)

    if not included_files:
        click.echo("❌ No files to include. Check your path or filters.", err=True)
        sys.exit(1)

    # Sort files for deterministic output
    sorted_files = sorted(included_files)

    if dry_run:
        click.echo("\n📋 Files to be included (Dry Run):")
        for path in sorted_files:
            click.echo(f"  - {path.relative_to(project_root).as_posix()}")
        click.echo(f"\nTotal: {len(sorted_files)} files.")
        return

    try:
        with open(output, "w", encoding="utf-8", errors='replace') as outfile:
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