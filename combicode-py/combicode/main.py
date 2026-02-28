import os
import re
import ast
import sys
import math
from pathlib import Path
import click
import pathspec
from importlib import metadata

# ---------------------------------------------------------------------------
# System Prompts (v2.0.0)
# ---------------------------------------------------------------------------

DEFAULT_SYSTEM_PROMPT = """\
You are an expert software architect. The user is providing you with the complete source code for a project, contained in a single file. Your task is to meticulously analyze the provided codebase to gain a comprehensive understanding of its structure, functionality, dependencies, and overall architecture.

A code map with expanded tree structure `<code_index>` is provided below to give you a high-level overview. The subsequent section `<merged_code>` contain the full content of each file (read using the command `sed -n '<ML_START>,<ML_END>p' combicode.txt`), clearly marked with a file header.

Your instructions are:
1.  Analyze Thoroughly: Read through every file to understand its purpose and how it interacts with other files.
2.  Identify Key Components: Pay close attention to configuration files (like package.json, pyproject.toml), entry points (like index.js, main.py), and core logic.
3.  Use the Code Map: The code map shows classes, functions, loops with their line numbers (OL = Original Line, ML = Merged Line) and sizes for precise navigation."""

LLMS_TXT_SYSTEM_PROMPT = """\
You are an expert software architect. The user is providing you with the full documentation for a project. This file contains the complete context needed to understand the project's features, APIs, and usage for a specific version. Your task is to act as a definitive source of truth based *only* on this provided documentation.

When answering questions or writing code, adhere strictly to the functions, variables, and methods described in this context. Do not use or suggest any deprecated or older functionalities that are not present here.

A code map with expanded tree structure is provided below for a high-level overview."""

# Minimal safety ignores
SAFETY_IGNORES = [".git", ".DS_Store"]


# ---------------------------------------------------------------------------
# Utility helpers
# ---------------------------------------------------------------------------

def is_likely_binary(path: Path) -> bool:
    try:
        with path.open('rb') as f:
            return b'\0' in f.read(1024)
    except IOError:
        return True


def format_bytes(size: int) -> str:
    if size == 0:
        return "0B"
    size_name = ("B", "KB", "MB", "GB", "TB")
    i = int(math.floor(math.log(size, 1024)))
    p = math.pow(1024, i)
    s = round(size / p, 1)
    return f"{s}{size_name[i]}"


# ---------------------------------------------------------------------------
# Code Parsers
# ---------------------------------------------------------------------------

def compute_byte_size(lines, start, end):
    """Compute byte size of lines[start..end] (0-indexed)."""
    size = 0
    for i in range(start, min(end + 1, len(lines))):
        size += len(lines[i].encode("utf-8")) + 1  # +1 for newline
    return size


def build_element(etype, label, start, end, lines):
    """Build a code element dict. start/end are 0-indexed."""
    return {
        "type": etype,
        "label": label,
        "start_line": start + 1,  # 1-indexed
        "end_line": end + 1,
        "size": compute_byte_size(lines, start, end),
        "children": [],
    }


# --- Block-end finders ---

def find_indent_block_end(lines, start_line):
    if start_line >= len(lines):
        return start_line
    base_indent = len(lines[start_line]) - len(lines[start_line].lstrip())
    for i in range(start_line + 1, len(lines)):
        line = lines[i]
        if line.strip() == "":
            continue
        indent = len(line) - len(line.lstrip())
        if indent <= base_indent:
            return i - 1
    return len(lines) - 1


def find_brace_block_end(lines, start_line):
    depth = 0
    found_open = False
    for i in range(start_line, len(lines)):
        for ch in lines[i]:
            if ch == "{":
                depth += 1
                found_open = True
            elif ch == "}":
                depth -= 1
                if found_open and depth == 0:
                    return i
    return len(lines) - 1


def find_ruby_block_end(lines, start_line):
    depth = 0
    for i in range(start_line, len(lines)):
        trimmed = lines[i].strip()
        if re.match(r'^(class|module|def|do|if|unless|case|while|until|for|begin)\b', trimmed):
            depth += 1
        if re.match(r'^end\b', trimmed):
            depth -= 1
            if depth == 0:
                return i
    return len(lines) - 1


def find_lua_block_end(lines, start_line):
    depth = 0
    for i in range(start_line, len(lines)):
        trimmed = lines[i].strip()
        if re.search(r'\b(function|if|for|while|repeat)\b', trimmed):
            depth += 1
        if re.match(r'^end\b', trimmed) or trimmed == "end":
            depth -= 1
            if depth == 0:
                return i
    return len(lines) - 1


# --- Python Parser (AST-based) ---

def parse_python(content, lines):
    elements = []
    try:
        tree = ast.parse(content)
    except SyntaxError:
        # Fallback to regex
        return parse_python_regex(lines)

    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef):
            start = node.lineno - 1
            end = node.end_lineno - 1 if hasattr(node, "end_lineno") and node.end_lineno else find_indent_block_end(lines, start)
            elements.append(build_element("class", f"class {node.name}", start, end, lines))

        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            start = node.lineno - 1
            end = node.end_lineno - 1 if hasattr(node, "end_lineno") and node.end_lineno else find_indent_block_end(lines, start)

            # Build signature
            args_list = []
            for arg in node.args.args:
                arg_str = arg.arg
                if arg.annotation and hasattr(arg.annotation, "id"):
                    arg_str += f": {arg.annotation.id}"
                elif arg.annotation:
                    try:
                        arg_str += f": {ast.unparse(arg.annotation)}"
                    except Exception:
                        pass
                args_list.append(arg_str)
            sig = ", ".join(args_list)

            ret = ""
            if node.returns:
                try:
                    ret = f" -> {ast.unparse(node.returns)}"
                except Exception:
                    pass

            name = node.name
            is_async = isinstance(node, ast.AsyncFunctionDef)

            if name == "__init__":
                etype = "ctor"
                label = f"ctor {name}({sig}){ret}"
            elif name.startswith("test_"):
                etype = "test"
                label = f"test {name}({sig}){ret}"
            elif is_async:
                etype = "async"
                label = f"async {name}({sig}){ret}"
            else:
                etype = "fn"
                label = f"fn {name}({sig}){ret}"

            elements.append(build_element(etype, label, start, end, lines))

        elif isinstance(node, (ast.For, ast.While)):
            start = node.lineno - 1
            end = node.end_lineno - 1 if hasattr(node, "end_lineno") and node.end_lineno else find_indent_block_end(lines, start)
            if end - start + 1 > 5:
                loop_line = lines[start].strip().rstrip(":")
                elements.append(build_element("loop", f"loop {loop_line}", start, end, lines))

    return elements


def parse_python_regex(lines):
    elements = []
    for i, line in enumerate(lines):
        trimmed = line.strip()

        m = re.match(r'^class\s+(\w+)(\(.*?\))?\s*:', trimmed)
        if m:
            end = find_indent_block_end(lines, i)
            elements.append(build_element("class", f"class {m.group(1)}", i, end, lines))
            continue

        m = re.match(r'^async\s+def\s+(\w+)\s*\((.*?)\)(\s*->.*?)?\s*:', trimmed)
        if m:
            end = find_indent_block_end(lines, i)
            sig = f"{m.group(1)}({m.group(2)}){m.group(3) or ''}"
            etype = "ctor" if m.group(1) == "__init__" else "async"
            elements.append(build_element(etype, f"{etype} {sig}", i, end, lines))
            continue

        m = re.match(r'^def\s+(\w+)\s*\((.*?)\)(\s*->.*?)?\s*:', trimmed)
        if m:
            end = find_indent_block_end(lines, i)
            sig = f"{m.group(1)}({m.group(2)}){m.group(3) or ''}"
            if m.group(1) == "__init__":
                etype = "ctor"
            elif m.group(1).startswith("test_"):
                etype = "test"
            else:
                etype = "fn"
            label = f"{etype} {sig}"
            elements.append(build_element(etype, label, i, end, lines))
            continue

        m = re.match(r'^(for|while)\s+(.+):\s*$', trimmed)
        if m:
            end = find_indent_block_end(lines, i)
            if end - i + 1 > 5:
                elements.append(build_element("loop", f"loop {m.group(1)} {m.group(2)}", i, end, lines))

    return elements


# --- JavaScript/TypeScript Parsers ---

def parse_javascript(lines):
    elements = []
    for i, line in enumerate(lines):
        trimmed = line.strip()

        m = re.match(r'^(export\s+)?(default\s+)?class\s+(\w+)', trimmed)
        if m:
            end = find_brace_block_end(lines, i)
            elements.append(build_element("class", f"class {m.group(3)}", i, end, lines))
            continue

        m = re.match(r'^describe\s*\(\s*[\'"`]([^\'"`]+)[\'"`]', trimmed)
        if m:
            end = find_brace_block_end(lines, i)
            elements.append(build_element("describe", f"describe {m.group(1)}", i, end, lines))
            continue

        m = re.match(r'^(it|test)\s*\(\s*[\'"`]([^\'"`]+)[\'"`]', trimmed)
        if m:
            end = find_brace_block_end(lines, i)
            elements.append(build_element("test", f"test {m.group(2)}", i, end, lines))
            continue

        m = re.match(r'^(export\s+)?(default\s+)?async\s+function\s+(\w+)\s*\((.*?)\)', trimmed)
        if m:
            end = find_brace_block_end(lines, i)
            elements.append(build_element("async", f"async {m.group(3)}({m.group(4)})", i, end, lines))
            continue

        m = re.match(r'^(export\s+)?(default\s+)?function\s+(\w+)\s*\((.*?)\)', trimmed)
        if m:
            end = find_brace_block_end(lines, i)
            etype = "ctor" if m.group(3) == "constructor" else "fn"
            elements.append(build_element(etype, f"{etype} {m.group(3)}({m.group(4)})", i, end, lines))
            continue

        m = re.match(r'^(export\s+)?(const|let|var)\s+(\w+)\s*=\s*(async\s+)?\(?(.*?)\)?\s*=>', trimmed)
        if m and "{" in trimmed:
            end = find_brace_block_end(lines, i)
            if end > i:
                is_async = bool(m.group(4))
                etype = "async" if is_async else "fn"
                elements.append(build_element(etype, f"{etype} {m.group(3)}({m.group(5) or ''})", i, end, lines))
            continue

        m = re.match(r'^(for|while)\s*\((.+)\)\s*\{?', trimmed)
        if m:
            end = find_brace_block_end(lines, i)
            if end - i + 1 > 5:
                elements.append(build_element("loop", f"loop {m.group(1)} {m.group(2)}", i, end, lines))

    return elements


def parse_typescript(lines):
    elements = []
    for i, line in enumerate(lines):
        trimmed = line.strip()

        m = re.match(r'^(export\s+)?(default\s+)?interface\s+(\w+)', trimmed)
        if m:
            end = find_brace_block_end(lines, i)
            elements.append(build_element("class", f"interface {m.group(3)}", i, end, lines))
            continue

        m = re.match(r'^(export\s+)?(default\s+)?(abstract\s+)?class\s+(\w+)', trimmed)
        if m:
            end = find_brace_block_end(lines, i)
            elements.append(build_element("class", f"class {m.group(4)}", i, end, lines))
            continue

        m = re.match(r'^describe\s*\(\s*[\'"`]([^\'"`]+)[\'"`]', trimmed)
        if m:
            end = find_brace_block_end(lines, i)
            elements.append(build_element("describe", f"describe {m.group(1)}", i, end, lines))
            continue

        m = re.match(r'^(it|test)\s*\(\s*[\'"`]([^\'"`]+)[\'"`]', trimmed)
        if m:
            end = find_brace_block_end(lines, i)
            elements.append(build_element("test", f"test {m.group(2)}", i, end, lines))
            continue

        m = re.match(r'^(export\s+)?(default\s+)?async\s+function\s+(\w+)\s*\((.*?)\)', trimmed)
        if m:
            end = find_brace_block_end(lines, i)
            elements.append(build_element("async", f"async {m.group(3)}({m.group(4)})", i, end, lines))
            continue

        m = re.match(r'^(export\s+)?(default\s+)?function\s+(\w+)\s*\((.*?)\)', trimmed)
        if m:
            end = find_brace_block_end(lines, i)
            elements.append(build_element("fn", f"fn {m.group(3)}({m.group(4)})", i, end, lines))
            continue

        m = re.match(r'^(export\s+)?(const|let|var)\s+(\w+)\s*=\s*(async\s+)?\(?(.*?)\)?\s*=>', trimmed)
        if m and "{" in trimmed:
            end = find_brace_block_end(lines, i)
            if end > i:
                is_async = bool(m.group(4))
                etype = "async" if is_async else "fn"
                elements.append(build_element(etype, f"{etype} {m.group(3)}({m.group(5) or ''})", i, end, lines))
            continue

        m = re.match(r'^(for|while)\s*\((.+)\)\s*\{?', trimmed)
        if m:
            end = find_brace_block_end(lines, i)
            if end - i + 1 > 5:
                elements.append(build_element("loop", f"loop {m.group(1)} {m.group(2)}", i, end, lines))

    return elements


# --- Go Parser ---

def parse_go(lines):
    elements = []
    for i, line in enumerate(lines):
        trimmed = line.strip()

        m = re.match(r'^type\s+(\w+)\s+struct\b', trimmed)
        if m:
            end = find_brace_block_end(lines, i)
            elements.append(build_element("class", f"struct {m.group(1)}", i, end, lines))
            continue

        m = re.match(r'^type\s+(\w+)\s+interface\b', trimmed)
        if m:
            end = find_brace_block_end(lines, i)
            elements.append(build_element("class", f"interface {m.group(1)}", i, end, lines))
            continue

        m = re.match(r'^func\s+(\(.*?\)\s*)?(\w+)\s*\((.*?)\)', trimmed)
        if m:
            end = find_brace_block_end(lines, i)
            receiver = (m.group(1) or "").strip()
            receiver = (receiver + " ") if receiver else ""
            name = m.group(2)
            etype = "test" if name.startswith("Test") else "fn"
            elements.append(build_element(etype, f"{etype} {receiver}{name}({m.group(3)})", i, end, lines))
            continue

        m = re.match(r'^for\s+(.+)\s*\{', trimmed)
        if m:
            end = find_brace_block_end(lines, i)
            if end - i + 1 > 5:
                elements.append(build_element("loop", f"loop for {m.group(1)}", i, end, lines))

    return elements


# --- Rust Parser ---

def parse_rust(lines):
    elements = []
    for i, line in enumerate(lines):
        trimmed = line.strip()

        m = re.match(r'^(pub\s+)?struct\s+(\w+)', trimmed)
        if m:
            end = find_brace_block_end(lines, i)
            elements.append(build_element("class", f"struct {m.group(2)}", i, end, lines))
            continue

        m = re.match(r'^(pub\s+)?enum\s+(\w+)', trimmed)
        if m:
            end = find_brace_block_end(lines, i)
            elements.append(build_element("class", f"enum {m.group(2)}", i, end, lines))
            continue

        m = re.match(r'^(pub\s+)?trait\s+(\w+)', trimmed)
        if m:
            end = find_brace_block_end(lines, i)
            elements.append(build_element("class", f"trait {m.group(2)}", i, end, lines))
            continue

        m = re.match(r'^impl\s+(.+?)\s*\{', trimmed)
        if m:
            end = find_brace_block_end(lines, i)
            elements.append(build_element("impl", f"impl {m.group(1)}", i, end, lines))
            continue

        m = re.match(r'^(pub\s+)?(async\s+)?fn\s+(\w+)\s*\((.*?)\)', trimmed)
        if m:
            end = find_brace_block_end(lines, i)
            is_async = bool(m.group(2))
            is_test = m.group(3).startswith("test_")
            etype = "test" if is_test else ("async" if is_async else "fn")
            elements.append(build_element(etype, f"{etype} {m.group(3)}({m.group(4)})", i, end, lines))
            continue

        m = re.match(r'^(for|while|loop)\b(.*)?\{', trimmed)
        if m:
            end = find_brace_block_end(lines, i)
            if end - i + 1 > 5:
                rest = (m.group(2) or "").strip()
                elements.append(build_element("loop", f"loop {m.group(1)}{' ' + rest if rest else ''}", i, end, lines))

    return elements


# --- Java Parser ---

def parse_java(lines):
    elements = []
    for i, line in enumerate(lines):
        trimmed = line.strip()

        m = re.match(r'^(public\s+|private\s+|protected\s+)?(static\s+)?(abstract\s+)?(final\s+)?class\s+(\w+)', trimmed)
        if m:
            end = find_brace_block_end(lines, i)
            elements.append(build_element("class", f"class {m.group(5)}", i, end, lines))
            continue

        m = re.match(r'^(public\s+|private\s+|protected\s+)?interface\s+(\w+)', trimmed)
        if m:
            end = find_brace_block_end(lines, i)
            elements.append(build_element("class", f"interface {m.group(2)}", i, end, lines))
            continue

        m = re.match(r'^(public\s+|private\s+|protected\s+)?enum\s+(\w+)', trimmed)
        if m:
            end = find_brace_block_end(lines, i)
            elements.append(build_element("class", f"enum {m.group(2)}", i, end, lines))
            continue

        m = re.match(r'^(public\s+|private\s+|protected\s+)?(static\s+)?(abstract\s+)?(final\s+)?(synchronized\s+)?(\w+\s+)?(\w+)\s*\((.*?)\)\s*(\{|throws)', trimmed)
        if m and m.group(7) not in ("if", "for", "while", "switch", "catch", "return"):
            end = find_brace_block_end(lines, i)
            name = m.group(7)
            has_return_type = m.group(6) and m.group(6).strip()
            etype = "ctor" if not has_return_type else ("test" if name.startswith("test") else "fn")
            elements.append(build_element(etype, f"{etype} {name}({m.group(8)})", i, end, lines))
            continue

        m = re.match(r'^(for|while)\s*\((.+)\)\s*\{?', trimmed)
        if m:
            end = find_brace_block_end(lines, i)
            if end - i + 1 > 5:
                elements.append(build_element("loop", f"loop {m.group(1)} {m.group(2)}", i, end, lines))

    return elements


# --- C/C++ Parser ---

def parse_c_cpp(lines):
    elements = []
    for i, line in enumerate(lines):
        trimmed = line.strip()

        m = re.match(r'^class\s+(\w+)', trimmed)
        if m:
            end = find_brace_block_end(lines, i)
            elements.append(build_element("class", f"class {m.group(1)}", i, end, lines))
            continue

        m = re.match(r'^(typedef\s+)?struct\s+(\w+)', trimmed)
        if m:
            end = find_brace_block_end(lines, i)
            elements.append(build_element("class", f"struct {m.group(2)}", i, end, lines))
            continue

        m = re.match(r'^(\w[\w\s*&]+?)\s+(\w+)\s*\(([^)]*)\)\s*(\{|$)', trimmed)
        if m and m.group(2) not in ("if", "for", "while", "switch", "return", "typedef", "struct", "class", "enum"):
            end = find_brace_block_end(lines, i)
            elements.append(build_element("fn", f"fn {m.group(2)}({m.group(3)})", i, end, lines))
            continue

        m = re.match(r'^(for|while)\s*\((.+)\)\s*\{?', trimmed)
        if m:
            end = find_brace_block_end(lines, i)
            if end - i + 1 > 5:
                elements.append(build_element("loop", f"loop {m.group(1)} {m.group(2)}", i, end, lines))

    return elements


# --- C# Parser ---

def parse_csharp(lines):
    elements = []
    for i, line in enumerate(lines):
        trimmed = line.strip()

        m = re.match(r'^(public\s+|private\s+|protected\s+|internal\s+)?(static\s+)?(abstract\s+|sealed\s+)?(partial\s+)?(class|struct|interface|enum|record)\s+(\w+)', trimmed)
        if m:
            end = find_brace_block_end(lines, i)
            elements.append(build_element("class", f"{m.group(5)} {m.group(6)}", i, end, lines))
            continue

        m = re.match(r'^(public\s+|private\s+|protected\s+|internal\s+)?(static\s+)?(async\s+)?(virtual\s+|override\s+|abstract\s+)?(\w[\w<>\[\],\s]*?)\s+(\w+)\s*\((.*?)\)\s*\{?', trimmed)
        if m and m.group(6) not in ("if", "for", "while", "switch", "catch", "return", "class", "struct", "interface", "enum"):
            end = find_brace_block_end(lines, i)
            is_async = bool(m.group(3))
            etype = "async" if is_async else "fn"
            elements.append(build_element(etype, f"{etype} {m.group(6)}({m.group(7)})", i, end, lines))
            continue

        m = re.match(r'^(for|foreach|while)\s*\((.+)\)\s*\{?', trimmed)
        if m:
            end = find_brace_block_end(lines, i)
            if end - i + 1 > 5:
                elements.append(build_element("loop", f"loop {m.group(1)} {m.group(2)}", i, end, lines))

    return elements


# --- PHP Parser ---

def parse_php(lines):
    elements = []
    for i, line in enumerate(lines):
        trimmed = line.strip()

        m = re.match(r'^(abstract\s+)?(final\s+)?(class|interface|trait)\s+(\w+)', trimmed)
        if m:
            end = find_brace_block_end(lines, i)
            elements.append(build_element("class", f"{m.group(3)} {m.group(4)}", i, end, lines))
            continue

        m = re.match(r'^(public\s+|private\s+|protected\s+)?(static\s+)?function\s+(\w+)\s*\((.*?)\)', trimmed)
        if m:
            end = find_brace_block_end(lines, i)
            etype = "ctor" if m.group(3) == "__construct" else ("test" if m.group(3).startswith("test") else "fn")
            elements.append(build_element(etype, f"{etype} {m.group(3)}({m.group(4)})", i, end, lines))
            continue

        m = re.match(r'^(for|foreach|while)\s*\((.+)\)\s*\{?', trimmed)
        if m:
            end = find_brace_block_end(lines, i)
            if end - i + 1 > 5:
                elements.append(build_element("loop", f"loop {m.group(1)} {m.group(2)}", i, end, lines))

    return elements


# --- Ruby Parser ---

def parse_ruby(lines):
    elements = []
    for i, line in enumerate(lines):
        trimmed = line.strip()

        m = re.match(r'^class\s+(\w+)', trimmed)
        if m:
            end = find_ruby_block_end(lines, i)
            elements.append(build_element("class", f"class {m.group(1)}", i, end, lines))
            continue

        m = re.match(r'^module\s+(\w+)', trimmed)
        if m:
            end = find_ruby_block_end(lines, i)
            elements.append(build_element("class", f"module {m.group(1)}", i, end, lines))
            continue

        m = re.match(r'^def\s+(self\.)?(\w+[?!=]?)\s*(\(.*?\))?', trimmed)
        if m:
            end = find_ruby_block_end(lines, i)
            prefix = m.group(1) or ""
            etype = "ctor" if m.group(2) == "initialize" else ("test" if m.group(2).startswith("test_") else "fn")
            elements.append(build_element(etype, f"{etype} {prefix}{m.group(2)}{m.group(3) or ''}", i, end, lines))

    return elements


# --- Swift Parser ---

def parse_swift(lines):
    elements = []
    for i, line in enumerate(lines):
        trimmed = line.strip()

        m = re.match(r'^(public\s+|private\s+|internal\s+|open\s+|fileprivate\s+)?(final\s+)?(class|struct|enum|protocol)\s+(\w+)', trimmed)
        if m:
            end = find_brace_block_end(lines, i)
            elements.append(build_element("class", f"{m.group(3)} {m.group(4)}", i, end, lines))
            continue

        m = re.match(r'^(public\s+|private\s+|internal\s+|open\s+)?(static\s+|class\s+)?(override\s+)?func\s+(\w+)\s*\((.*?)\)', trimmed)
        if m:
            end = find_brace_block_end(lines, i)
            name = m.group(4)
            etype = "ctor" if name == "init" else ("test" if name.startswith("test") else "fn")
            elements.append(build_element(etype, f"{etype} {name}({m.group(5)})", i, end, lines))
            continue

        m = re.match(r'^(for|while)\s+(.+)\s*\{', trimmed)
        if m:
            end = find_brace_block_end(lines, i)
            if end - i + 1 > 5:
                elements.append(build_element("loop", f"loop {m.group(1)} {m.group(2)}", i, end, lines))

    return elements


# --- Kotlin Parser ---

def parse_kotlin(lines):
    elements = []
    for i, line in enumerate(lines):
        trimmed = line.strip()

        m = re.match(r'^(open\s+|abstract\s+|data\s+|sealed\s+)?(class|interface|object)\s+(\w+)', trimmed)
        if m:
            end = find_brace_block_end(lines, i)
            elements.append(build_element("class", f"{m.group(2)} {m.group(3)}", i, end, lines))
            continue

        m = re.match(r'^(public\s+|private\s+|protected\s+|internal\s+)?(override\s+)?(suspend\s+)?fun\s+(\w+)\s*\((.*?)\)', trimmed)
        if m:
            end = find_brace_block_end(lines, i)
            is_suspend = bool(m.group(3))
            etype = "test" if m.group(4).startswith("test") else ("async" if is_suspend else "fn")
            elements.append(build_element(etype, f"{etype} {m.group(4)}({m.group(5)})", i, end, lines))
            continue

        m = re.match(r'^(for|while)\s*\((.+)\)\s*\{?', trimmed)
        if m:
            end = find_brace_block_end(lines, i)
            if end - i + 1 > 5:
                elements.append(build_element("loop", f"loop {m.group(1)} {m.group(2)}", i, end, lines))

    return elements


# --- Scala Parser ---

def parse_scala(lines):
    elements = []
    for i, line in enumerate(lines):
        trimmed = line.strip()

        m = re.match(r'^(case\s+)?(class|object|trait)\s+(\w+)', trimmed)
        if m:
            end = find_brace_block_end(lines, i)
            prefix = m.group(1) or ""
            elements.append(build_element("class", f"{prefix}{m.group(2)} {m.group(3)}", i, end, lines))
            continue

        m = re.match(r'^(override\s+)?def\s+(\w+)\s*(\(.*?\))?', trimmed)
        if m:
            end = find_brace_block_end(lines, i)
            etype = "test" if m.group(2).startswith("test") else "fn"
            elements.append(build_element(etype, f"{etype} {m.group(2)}{m.group(3) or ''}", i, end, lines))

    return elements


# --- Lua Parser ---

def parse_lua(lines):
    elements = []
    for i, line in enumerate(lines):
        trimmed = line.strip()

        m = re.match(r'^(local\s+)?function\s+([\w.:]+)\s*\((.*?)\)', trimmed)
        if m:
            end = find_lua_block_end(lines, i)
            elements.append(build_element("fn", f"fn {m.group(2)}({m.group(3)})", i, end, lines))
            continue

        m = re.match(r'^(for|while)\s+(.+)\s+do', trimmed)
        if m:
            end = find_lua_block_end(lines, i)
            if end - i + 1 > 5:
                elements.append(build_element("loop", f"loop {m.group(1)} {m.group(2)}", i, end, lines))

    return elements


# --- Perl Parser ---

def parse_perl(lines):
    elements = []
    for i, line in enumerate(lines):
        trimmed = line.strip()

        m = re.match(r'^package\s+([\w:]+)', trimmed)
        if m:
            elements.append(build_element("class", f"package {m.group(1)}", i, i, lines))
            continue

        m = re.match(r'^sub\s+(\w+)', trimmed)
        if m:
            end = find_brace_block_end(lines, i)
            elements.append(build_element("fn", f"fn {m.group(1)}", i, end, lines))

    return elements


# --- Bash Parser ---

def parse_bash(lines):
    elements = []
    for i, line in enumerate(lines):
        trimmed = line.strip()

        m = re.match(r'^function\s+(\w+)', trimmed)
        if m:
            end = find_brace_block_end(lines, i)
            elements.append(build_element("fn", f"fn {m.group(1)}", i, end, lines))
            continue

        m = re.match(r'^(\w+)\s*\(\s*\)\s*\{?', trimmed)
        if m and "()" in trimmed:
            end = find_brace_block_end(lines, i)
            elements.append(build_element("fn", f"fn {m.group(1)}", i, end, lines))
            continue

        m = re.match(r'^(for|while)\s+(.+?);\s*do', trimmed)
        if not m:
            m = re.match(r'^(for|while)\s+(.+)', trimmed)
        if m:
            end = i
            for j in range(i + 1, len(lines)):
                if lines[j].strip() == "done":
                    end = j
                    break
            if end - i + 1 > 5:
                elements.append(build_element("loop", f"loop {m.group(1)} {m.group(2)}", i, end, lines))

    return elements


# --- Dispatcher ---

PARSER_MAP = {
    ".py": "python",
    ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript", ".cjs": "javascript",
    ".ts": "typescript", ".tsx": "typescript", ".mts": "typescript", ".cts": "typescript",
    ".go": "go",
    ".rs": "rust",
    ".java": "java",
    ".c": "c_cpp", ".h": "c_cpp", ".cpp": "c_cpp", ".hpp": "c_cpp", ".cc": "c_cpp", ".cxx": "c_cpp",
    ".cs": "csharp",
    ".php": "php",
    ".rb": "ruby",
    ".swift": "swift",
    ".kt": "kotlin", ".kts": "kotlin",
    ".scala": "scala", ".sc": "scala",
    ".lua": "lua",
    ".pl": "perl", ".pm": "perl",
    ".sh": "bash", ".bash": "bash", ".zsh": "bash",
}

PARSER_FUNCS = {
    "python": None,  # handled specially (AST)
    "javascript": parse_javascript,
    "typescript": parse_typescript,
    "go": parse_go,
    "rust": parse_rust,
    "java": parse_java,
    "c_cpp": parse_c_cpp,
    "csharp": parse_csharp,
    "php": parse_php,
    "ruby": parse_ruby,
    "swift": parse_swift,
    "kotlin": parse_kotlin,
    "scala": parse_scala,
    "lua": parse_lua,
    "perl": parse_perl,
    "bash": parse_bash,
}


def parse_code_structure(file_path, content):
    ext = Path(file_path).suffix.lower()
    parser_name = PARSER_MAP.get(ext)
    if not parser_name:
        return []

    lines = content.split("\n")

    if parser_name == "python":
        return parse_python(content, lines)

    func = PARSER_FUNCS.get(parser_name)
    if func:
        return func(lines)
    return []


# ---------------------------------------------------------------------------
# Nesting
# ---------------------------------------------------------------------------

def nest_elements(elements):
    if not elements:
        return []

    sorted_els = sorted(elements, key=lambda e: (e["start_line"], -(e["end_line"] - e["start_line"])))

    root = []
    stack = []

    for el in sorted_els:
        node = {**el, "children": []}

        while stack:
            parent = stack[-1]
            if el["start_line"] >= parent["start_line"] and el["end_line"] <= parent["end_line"]:
                break
            stack.pop()

        if stack:
            stack[-1]["children"].append(node)
        else:
            root.append(node)

        stack.append(node)

    return root


# ---------------------------------------------------------------------------
# Code Index Tree
# ---------------------------------------------------------------------------

def generate_code_index(files_meta, root: Path, skip_content_set: set, no_parse: bool) -> str:
    tree_lines = [f"{root.name}/"]

    # Build directory structure
    structure = {}
    for f in files_meta:
        parts = f["relative_path"].parts
        current = structure
        for idx, part in enumerate(parts):
            is_file = idx == len(parts) - 1
            if is_file:
                current[part] = {"__file": f}
            else:
                current = current.setdefault(part, {})

    def render_tree(level, prefix):
        keys = sorted(level.keys())
        for idx, key in enumerate(keys):
            is_last = idx == len(keys) - 1
            connector = "\u2514\u2500\u2500 " if is_last else "\u251c\u2500\u2500 "
            child_prefix = prefix + ("    " if is_last else "\u2502   ")
            value = level[key]

            if "__file" in value:
                f = value["__file"]
                ol_range = f"OL: 1-{f['line_count']}"
                ml_range = f"ML: {f['ml_start']}-{f['ml_end']}"
                size_str = f["formatted_size"]
                rel_str = f["relative_path"].as_posix()
                is_skipped = rel_str in skip_content_set

                tree_lines.append(f"{prefix}{connector}{key} [{ol_range} | {ml_range} | {size_str}]")

                if is_skipped:
                    tree_lines.append(f"{child_prefix}(Content omitted - file size: {size_str})")
                elif not no_parse and f.get("code_elements"):
                    render_code_elements(f["code_elements"], child_prefix, f["ml_start"])
            else:
                tree_lines.append(f"{prefix}{connector}{key}/")
                render_tree(value, child_prefix)

    def render_code_elements(elements, prefix, ml_offset):
        for idx, el in enumerate(elements):
            is_last = idx == len(elements) - 1
            connector = "\u2514\u2500\u2500 " if is_last else "\u251c\u2500\u2500 "
            child_prefix = prefix + ("    " if is_last else "\u2502   ")

            ol_range = f"OL: {el['start_line']}-{el['end_line']}"
            ml_start = ml_offset + el["start_line"] - 1
            ml_end = ml_offset + el["end_line"] - 1
            ml_range = f"ML: {ml_start}-{ml_end}"
            size_str = format_bytes(el["size"])

            tree_lines.append(f"{prefix}{connector}{el['label']} [{ol_range} | {ml_range} | {size_str}]")

            if el.get("children"):
                render_code_elements(el["children"], child_prefix, ml_offset)

    render_tree(structure, "")
    return "\n".join(tree_lines) + "\n"


# ---------------------------------------------------------------------------
# Recreate
# ---------------------------------------------------------------------------

def recreate_from_file(input_file: str, output_dir: str, dry_run: bool, overwrite: bool):
    input_path = Path(input_file).resolve()
    if not input_path.exists():
        click.echo(f"\n\u274c Input file not found: {input_file}", err=True)
        sys.exit(1)

    content = input_path.read_text(encoding="utf-8")

    files = []
    # Match: # FILE: path [...]  followed by ```` block
    for m in re.finditer(r'# FILE:\s*(.+?)\s*\[.*?\]\n````\n([\s\S]*?)\n````', content):
        file_path = m.group(1).strip()
        file_content = m.group(2)
        if file_content.strip().startswith("(Content omitted"):
            continue
        files.append({"path": file_path, "content": file_content})

    if not files:
        # Try legacy format
        for m in re.finditer(r'### \*\*FILE:\*\*\s*`(.+?)`\n````\n([\s\S]*?)\n````', content):
            file_path = m.group(1).strip()
            file_content = m.group(2)
            if file_content.strip().startswith("(Content omitted"):
                continue
            files.append({"path": file_path, "content": file_content})

    if not files:
        click.echo("\n\u274c No files found in the input file.", err=True)
        sys.exit(1)

    resolved_output = Path(output_dir).resolve()
    click.echo(f"\n\U0001F4C2 Output directory: {resolved_output}\n")

    total_size = 0
    for f in files:
        size = len(f["content"].encode("utf-8"))
        total_size += size
        click.echo(f"   {f['path']} ({format_bytes(size)})")

        if not dry_run:
            full_path = resolved_output / f["path"]
            if full_path.exists() and not overwrite:
                click.echo(f"   \u26a0\ufe0f  Skipped (exists): {f['path']}")
                continue
            full_path.parent.mkdir(parents=True, exist_ok=True)
            full_path.write_text(f["content"], encoding="utf-8")

    click.echo(f"\n\U0001F4CA Summary:")
    label = "Files to recreate" if dry_run else "Files recreated"
    click.echo(f"   \u2022 {label}: {len(files)}")
    click.echo(f"   \u2022 Total size: {format_bytes(total_size)}")
    click.echo(f"\n\u2705 Done!")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

@click.command(context_settings=dict(help_option_names=['-h', '--help']))
@click.option("-o", "--output", default="combicode.txt", help="Output file (combine) or directory (recreate).", show_default=True)
@click.option("-d", "--dry-run", is_flag=True, help="Preview without making changes.")
@click.option("-i", "--include-ext", help="Comma-separated list of extensions to exclusively include (e.g., .py,.js).")
@click.option("-e", "--exclude", help="Comma-separated list of additional glob patterns to exclude.")
@click.option("-l", "--llms-txt", is_flag=True, help="Use the system prompt for llms.txt context.")
@click.option("--no-gitignore", is_flag=True, help="Do not use patterns from the project's .gitignore file.")
@click.option("--no-header", is_flag=True, help="Omit the introductory prompt and file tree from the output.")
@click.option("--skip-content", help="Comma-separated glob patterns for files to include in tree but omit content.")
@click.option("--no-parse", is_flag=True, help="Disable code structure parsing (show only file tree).")
@click.option("-r", "--recreate", is_flag=True, help="Recreate project from a combicode.txt file.")
@click.option("--input", default="combicode.txt", help="Input combicode.txt file for recreate.", show_default=True)
@click.option("--overwrite", is_flag=True, help="Overwrite existing files when recreating.")
@click.version_option(metadata.version("combicode"), '-v', '--version', prog_name="Combicode", message="%(prog)s (Python), version %(version)s")
def cli(output, dry_run, include_ext, exclude, llms_txt, no_gitignore, no_header, skip_content, no_parse, recreate, input, overwrite):
    """Combicode combines your project's code into a single file for LLM context."""

    project_root = Path.cwd().resolve()
    click.echo(f"\u2728 Combicode v{metadata.version('combicode')}")
    click.echo(f"\U0001F4C2 Root: {project_root}")

    # --- Recreate mode ---
    if recreate:
        input_file = str((project_root / input).resolve())
        output_dir = output if output != "combicode.txt" else str(project_root)
        recreate_from_file(input_file, output_dir, dry_run, overwrite)
        return

    # --- Combine mode ---
    default_ignore_patterns = list(SAFETY_IGNORES)
    if exclude:
        default_ignore_patterns.extend(exclude.split(','))

    # Parse .gitmodules
    gitmodules_path = project_root / ".gitmodules"
    if gitmodules_path.exists():
        try:
            with gitmodules_path.open("r", encoding="utf-8") as f:
                for line in f:
                    stripped = line.strip()
                    if stripped.startswith("path") and "=" in stripped:
                        key, value = stripped.split("=", 1)
                        if key.strip() == "path":
                            default_ignore_patterns.append(value.strip())
        except Exception:
            pass

    root_spec = pathspec.PathSpec.from_lines(pathspec.patterns.GitWildMatchPattern, default_ignore_patterns)

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

    spec_map = {project_root: []}
    stats_ignored = 0

    for dirpath, dirnames, filenames in os.walk(project_root, topdown=True):
        current_dir = Path(dirpath)

        if current_dir == project_root:
            current_chain = []
        else:
            current_chain = spec_map.get(current_dir, [])

        my_chain = list(current_chain)
        if not no_gitignore:
            gitignore_path = current_dir / ".gitignore"
            if gitignore_path.exists():
                try:
                    with gitignore_path.open("r", encoding='utf-8') as f:
                        lines = f.read().splitlines()
                        new_spec = pathspec.PathSpec.from_lines(pathspec.patterns.GitWildMatchPattern, lines)
                        my_chain.append((current_dir, new_spec))
                except Exception:
                    pass

        for d in dirnames:
            spec_map[current_dir / d] = my_chain

        def is_ignored(name, is_dir=False):
            nonlocal stats_ignored
            full_path = current_dir / name
            try:
                rel_to_project = full_path.relative_to(project_root).as_posix()
            except ValueError:
                return False
            if root_spec.match_file(rel_to_project):
                return True
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

        i = 0
        while i < len(dirnames):
            if is_ignored(dirnames[i], is_dir=True):
                del dirnames[i]
                stats_ignored += 1
            else:
                i += 1

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
                included_files_data.append({
                    'path': f_path,
                    'relative_path': f_path.relative_to(project_root),
                    'size': size,
                    'formatted_size': format_bytes(size),
                })
            except OSError:
                continue

    if not included_files_data:
        click.echo("\u274c No files to include. Check your path or filters.", err=True)
        sys.exit(1)

    included_files_data.sort(key=lambda x: x['path'])

    # Determine skip-content set
    skip_content_set = set()
    if skip_content_spec:
        for item in included_files_data:
            rel_path_str = item['relative_path'].as_posix()
            if skip_content_spec.match_file(rel_path_str):
                skip_content_set.add(rel_path_str)

    # Read contents & parse code structure
    for item in included_files_data:
        rel_str = item["relative_path"].as_posix()
        is_skipped = rel_str in skip_content_set

        if is_skipped:
            item["content"] = None
            item["line_count"] = 0
            item["code_elements"] = []
        else:
            try:
                content = item["path"].read_text(encoding="utf-8")
                item["content"] = content
                # Count actual lines: for content ending with \n, count("\n") gives the right number
                item["line_count"] = content.count("\n") if content.endswith("\n") else content.count("\n") + 1
                if not no_parse:
                    flat = parse_code_structure(str(item["relative_path"]), content)
                    item["code_elements"] = nest_elements(flat)
                else:
                    item["code_elements"] = []
            except Exception as e:
                item["content"] = f"... (error reading file: {e}) ..."
                item["line_count"] = 1
                item["code_elements"] = []

    # Calculate ML offsets (two-pass)
    system_prompt = LLMS_TXT_SYSTEM_PROMPT if llms_txt else DEFAULT_SYSTEM_PROMPT

    # Pass 1: provisional ML
    temp_ml = 1
    for item in included_files_data:
        item["ml_start"] = temp_ml
        rel_str = item["relative_path"].as_posix()
        is_skipped = rel_str in skip_content_set
        if is_skipped:
            item["ml_end"] = temp_ml + 1
            temp_ml += 4 + 1
        else:
            item["ml_end"] = temp_ml + item["line_count"] - 1
            temp_ml += 4 + item["line_count"]

    # Pass 2: count code_index lines
    code_index = generate_code_index(included_files_data, project_root, skip_content_set, no_parse)
    # code_index ends with \n, so count("\n") gives the actual line count
    code_index_line_count = code_index.count("\n") if code_index.endswith("\n") else code_index.count("\n") + 1

    total_header_lines = 0
    if not no_header:
        total_header_lines += system_prompt.count("\n") + 1 + 1  # prompt + trailing newline
        total_header_lines += 1  # <code_index>
        total_header_lines += code_index_line_count
        total_header_lines += 1  # </code_index>
        total_header_lines += 1  # blank line
        total_header_lines += 1  # <merged_code>
    else:
        total_header_lines += 1  # <merged_code>

    # Pass 3: real ML offsets
    current_ml = total_header_lines + 1
    for item in included_files_data:
        rel_str = item["relative_path"].as_posix()
        is_skipped = rel_str in skip_content_set
        item["ml_start"] = current_ml + 2  # content starts after file header (2 lines)
        if is_skipped:
            item["ml_end"] = item["ml_start"]
            current_ml += 2 + 1 + 2
        else:
            item["ml_end"] = item["ml_start"] + item["line_count"] - 1
            current_ml += 2 + item["line_count"] + 2

    # Regenerate code_index with real MLs
    code_index = generate_code_index(included_files_data, project_root, skip_content_set, no_parse)

    # Total content size
    total_size_bytes = sum(
        item['size'] for item in included_files_data
        if item['relative_path'].as_posix() not in skip_content_set
    )

    # --- Dry run ---
    if dry_run:
        click.echo("\n\U0001F4CB Files to include (dry run):\n")
        click.echo(code_index)
        click.echo(f"\n\U0001F4CA Summary:")
        click.echo(f"   \u2022 Total files: {len(included_files_data)}")
        click.echo(f"   \u2022 Total size: {format_bytes(total_size_bytes)}")
        if skip_content_set:
            click.echo(f"   \u2022 Content omitted: {len(skip_content_set)} files")
        click.echo(f"\n\u2705 Done!")
        return

    # --- Write output ---
    total_lines = 0
    try:
        with open(output, "w", encoding="utf-8", errors="replace") as outfile:
            if not no_header:
                outfile.write(system_prompt + "\n\n")
                total_lines += system_prompt.count("\n") + 2

                outfile.write("<code_index>\n")
                outfile.write(code_index)
                outfile.write("</code_index>\n\n")
                total_lines += code_index_line_count + 3

                outfile.write("<merged_code>\n")
                total_lines += 1
            else:
                outfile.write("<merged_code>\n")
                total_lines += 1

            for item in included_files_data:
                rel_path = item["relative_path"].as_posix()
                is_skipped = rel_path in skip_content_set

                ol_range = f"OL: 1-{item['line_count']}"
                ml_range = f"ML: {item['ml_start']}-{item['ml_end']}"
                size_str = item["formatted_size"]

                outfile.write(f"# FILE: {rel_path} [{ol_range} | {ml_range} | {size_str}]\n")
                outfile.write("````\n")
                total_lines += 2

                if is_skipped:
                    outfile.write(f"(Content omitted - file size: {size_str})\n")
                    total_lines += 1
                else:
                    outfile.write(item["content"])
                    if not item["content"].endswith("\n"):
                        outfile.write("\n")
                    total_lines += item["line_count"]

                outfile.write("````\n\n")
                total_lines += 2

            outfile.write("</merged_code>\n")
            total_lines += 1

        click.echo(f"\n\U0001F4CA Summary:")
        click.echo(f"   \u2022 Included: {len(included_files_data)} files ({format_bytes(total_size_bytes)})")
        if skip_content_set:
            click.echo(f"   \u2022 Content omitted: {len(skip_content_set)} files")
        click.echo(f"   \u2022 Ignored:  {stats_ignored} files/dirs")
        click.echo(f"   \u2022 Output:   {output} (~{total_lines} lines)")
        click.echo(f"\n\u2705 Done!")
    except IOError as e:
        click.echo(f"\n\u274c Error writing to output file: {e}", err=True)
        sys.exit(1)


if __name__ == "__main__":
    cli()
