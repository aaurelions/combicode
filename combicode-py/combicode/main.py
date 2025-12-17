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

# Minimal safety ignores
SAFETY_IGNORES = [".git", ".DS_Store"]

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

def generate_file_tree(files_data: list[dict], root: Path, skip_content_set: set = None) -> str:
    tree_lines = [f"{root.name}/"]
    structure = {}
    
    if skip_content_set is None:
        skip_content_set = set()
    
    # Build structure
    for item in files_data:
        path_parts = item['relative_path'].parts
        current_level = structure
        for i, part in enumerate(path_parts):
            is_file = (i == len(path_parts) - 1)
            if is_file:
                rel_path_str = str(item['relative_path'].as_posix())
                should_skip = rel_path_str in skip_content_set
                current_level[part] = {
                    'size': item['formatted_size'],
                    'skip_content': should_skip
                }
            else:
                current_level = current_level.setdefault(part, {})

    def build_tree(level, prefix=""):
        entries = sorted(level.keys())
        for i, entry in enumerate(entries):
            is_last = i == len(entries) - 1
            connector = "└── " if is_last else "├── "
            
            value = level[entry]
            
            if isinstance(value, dict) and 'size' in value:
                marker = " (content omitted)" if value['skip_content'] else ""
                tree_lines.append(f"{prefix}{connector}[{value['size']}] {entry}{marker}")
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
@click.option("--skip-content", help="Comma-separated glob patterns for files to include in tree but omit content.")
@click.version_option(metadata.version("combicode"), '-v', '--version', prog_name="Combicode", message="%(prog)s (Python), version %(version)s")
def cli(output, dry_run, include_ext, exclude, llms_txt, no_gitignore, no_header, skip_content):
    """Combicode combines your project's code into a single file for LLM context."""
    
    project_root = Path.cwd().resolve()
    click.echo(f"\n✨ Combicode v{metadata.version('combicode')}")
    click.echo(f"📂 Root: {project_root}")

    # 1. Base Ignore Spec (Safety + CLI)
    default_ignore_patterns = list(SAFETY_IGNORES)
    if exclude:
        default_ignore_patterns.extend(exclude.split(','))
    
    root_spec = pathspec.PathSpec.from_lines(pathspec.patterns.GitWildMatchPattern, default_ignore_patterns)
    
    # 2. Skip Content Spec
    skip_content_spec = None
    if skip_content:
        skip_content_patterns = skip_content.split(',')
        skip_content_spec = pathspec.PathSpec.from_lines(pathspec.patterns.GitWildMatchPattern, skip_content_patterns)

    try:
        output_path = (project_root / output).resolve()
    except OSError:
        output_path = None

    included_files_data = []
    allowed_extensions = {f".{ext.strip('.')}" for ext in include_ext.split(',')} if include_ext else None

    # Map: Path -> List of (root, spec)
    spec_map = { project_root: [] }

    # Stats
    stats_ignored = 0
    stats_total_size = 0

    # Walk the tree
    for dirpath, dirnames, filenames in os.walk(project_root, topdown=True):
        current_dir = Path(dirpath)
        
        # 1. Get inherited chain
        if current_dir == project_root:
            current_chain = []
        else:
            current_chain = spec_map.get(current_dir, [])

        # 2. Check for local .gitignore
        my_chain = list(current_chain)
        if not no_gitignore:
            gitignore_path = current_dir / ".gitignore"
            if gitignore_path.exists():
                try:
                    with gitignore_path.open("r", encoding='utf-8') as f:
                        lines = f.read().splitlines()
                        new_spec = pathspec.PathSpec.from_lines(
                            pathspec.patterns.GitWildMatchPattern, lines
                        )
                        my_chain.append((current_dir, new_spec))
                except Exception:
                    pass
        
        # 3. Propagate chain
        for d in dirnames:
            spec_map[current_dir / d] = my_chain

        # Helper
        def is_ignored(name, is_dir=False):
            full_path = current_dir / name
            try:
                rel_to_project = full_path.relative_to(project_root).as_posix()
            except ValueError:
                return False

            # Global Check
            if root_spec.match_file(rel_to_project):
                return True
            
            # Chain Check
            for (spec_root, spec) in my_chain:
                try:
                    rel_to_spec = full_path.relative_to(spec_root).as_posix()
                    if spec.match_file(rel_to_spec):
                        return True
                    if is_dir and spec.match_file(rel_to_spec + "/"):
                        return True
                except ValueError:
                    continue
            return False

        # 4. Prune directories
        i = 0
        while i < len(dirnames):
            if is_ignored(dirnames[i], is_dir=True):
                del dirnames[i]
                stats_ignored += 1
            else:
                i += 1
        
        # 5. Process Files
        for fname in filenames:
            f_path = current_dir / fname
            
            if output_path and f_path.resolve() == output_path:
                continue

            if is_ignored(fname):
                stats_ignored += 1
                continue

            if is_likely_binary(f_path):
                stats_ignored += 1
                continue
            
            if allowed_extensions and f_path.suffix not in allowed_extensions:
                stats_ignored += 1
                continue

            try:
                size = f_path.stat().st_size
                stats_total_size += size
                included_files_data.append({
                    'path': f_path,
                    'relative_path': f_path.relative_to(project_root),
                    'formatted_size': format_bytes(size)
                })
            except OSError:
                continue

    if not included_files_data:
        click.echo("❌ No files to include. Check your path or filters.", err=True)
        sys.exit(1)

    included_files_data.sort(key=lambda x: x['path'])
    
    # Determine which files should have content skipped
    skip_content_set = set()
    if skip_content_spec:
        for item in included_files_data:
            rel_path_str = item['relative_path'].as_posix()
            if skip_content_spec.match_file(rel_path_str):
                skip_content_set.add(rel_path_str)

    if dry_run:
        click.echo("\n📋 Files to be included (Dry Run):\n")
        tree = generate_file_tree(included_files_data, project_root, skip_content_set)
        click.echo(tree)
        
        click.echo(f"\n📊 Summary (Dry Run):")
        click.echo(f"   • Included: {len(included_files_data)} files ({format_bytes(stats_total_size)})")
        if skip_content_set:
            click.echo(f"   • Content omitted: {len(skip_content_set)} files")
        click.echo(f"   • Ignored:  {stats_ignored} files/dirs")
        return

    total_lines = 0
    try:
        with open(output, "w", encoding="utf-8", errors='replace') as outfile:
            if not no_header:
                system_prompt = LLMS_TXT_SYSTEM_PROMPT if llms_txt else DEFAULT_SYSTEM_PROMPT
                outfile.write(system_prompt + "\n")
                total_lines += system_prompt.count('\n') + 1

                outfile.write("## Project File Tree\n\n")
                outfile.write("```\n")
                tree = generate_file_tree(included_files_data, project_root, skip_content_set)
                outfile.write(tree + "\n")
                outfile.write("```\n\n")
                outfile.write("---\n\n");
                total_lines += tree.count('\n') + 6

            for item in included_files_data:
                relative_path = item['relative_path'].as_posix()
                should_skip_content = relative_path in skip_content_set
                
                outfile.write(f"### **FILE:** `{relative_path}`\n")
                outfile.write("```\n")
                if should_skip_content:
                    outfile.write(f"(Content omitted - file size: {item['formatted_size']})\n")
                    total_lines += 1
                else:
                    try:
                        content = item['path'].read_text(encoding="utf-8")
                        outfile.write(content)
                        total_lines += content.count('\n') + 1
                    except Exception as e:
                        outfile.write(f"... (error reading file: {e}) ...")
                outfile.write("\n```\n\n")
                total_lines += 4
        
        click.echo(f"\n📊 Summary:")
        click.echo(f"   • Included: {len(included_files_data)} files ({format_bytes(stats_total_size)})")
        if skip_content_set:
            click.echo(f"   • Content omitted: {len(skip_content_set)} files")
        click.echo(f"   • Ignored:  {stats_ignored} files/dirs")
        click.echo(f"   • Output:   {output} (~{total_lines} lines)")
        click.echo(f"\n✅ Done!")
    except IOError as e:
        click.echo(f"\n❌ Error writing to output file: {e}", err=True)
        sys.exit(1)

if __name__ == "__main__":
    cli()