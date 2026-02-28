#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const yargs = require("yargs/yargs");
const { hideBin } = require("yargs/helpers");
const ignore = require("ignore");

const { version } = require("./package.json");

// ---------------------------------------------------------------------------
// System Prompts (v2.0.0)
// ---------------------------------------------------------------------------

const DEFAULT_SYSTEM_PROMPT = `You are an expert software architect. The user is providing you with the complete source code for a project, contained in a single file. Your task is to meticulously analyze the provided codebase to gain a comprehensive understanding of its structure, functionality, dependencies, and overall architecture.

A code map with expanded tree structure \`<code_index>\` is provided below to give you a high-level overview. The subsequent section \`<merged_code>\` contain the full content of each file (read using the command \`sed -n '<ML_START>,<ML_END>p' combicode.txt\`), clearly marked with a file header.

Your instructions are:
1.  Analyze Thoroughly: Read through every file to understand its purpose and how it interacts with other files.
2.  Identify Key Components: Pay close attention to configuration files (like package.json, pyproject.toml), entry points (like index.js, main.py), and core logic.
3.  Use the Code Map: The code map shows classes, functions, loops with their line numbers (OL = Original Line, ML = Merged Line) and sizes for precise navigation.
`;

const LLMS_TXT_SYSTEM_PROMPT = `You are an expert software architect. The user is providing you with the full documentation for a project. This file contains the complete context needed to understand the project's features, APIs, and usage for a specific version. Your task is to act as a definitive source of truth based *only* on this provided documentation.

When answering questions or writing code, adhere strictly to the functions, variables, and methods described in this context. Do not use or suggest any deprecated or older functionalities that are not present here.

A code map with expanded tree structure is provided below for a high-level overview.
`;

// Minimal safety ignores
const SAFETY_IGNORES = [".git", ".DS_Store"];

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function isLikelyBinary(filePath) {
  const buffer = Buffer.alloc(512);
  let fd;
  try {
    fd = fs.openSync(filePath, "r");
    const bytesRead = fs.readSync(fd, buffer, 0, 512, 0);
    return buffer.slice(0, bytesRead).includes(0);
  } catch (e) {
    return true;
  } finally {
    if (fd) fs.closeSync(fd);
  }
}

function formatBytes(bytes, decimals = 1) {
  if (bytes === 0) return "0B";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + sizes[i];
}

// ---------------------------------------------------------------------------
// Code Parsers (regex-based for all languages)
// ---------------------------------------------------------------------------

/**
 * Parse code structure from file content. Returns array of elements:
 * { type, label, startLine, endLine, startByte, endByte }
 *
 * type: "class" | "fn" | "async" | "ctor" | "loop" | "impl" | "test" | "describe"
 */
function parseCodeStructure(filePath, content) {
  const ext = path.extname(filePath).toLowerCase();
  const lines = content.split("\n");

  switch (ext) {
    case ".py":
      return parsePython(lines);
    case ".js":
    case ".jsx":
    case ".mjs":
    case ".cjs":
      return parseJavaScript(lines);
    case ".ts":
    case ".tsx":
    case ".mts":
    case ".cts":
      return parseTypeScript(lines);
    case ".go":
      return parseGo(lines);
    case ".rs":
      return parseRust(lines);
    case ".java":
      return parseJava(lines);
    case ".c":
    case ".h":
    case ".cpp":
    case ".hpp":
    case ".cc":
    case ".cxx":
      return parseCCpp(lines);
    case ".cs":
      return parseCSharp(lines);
    case ".php":
      return parsePHP(lines);
    case ".rb":
      return parseRuby(lines);
    case ".swift":
      return parseSwift(lines);
    case ".kt":
    case ".kts":
      return parseKotlin(lines);
    case ".scala":
    case ".sc":
      return parseScala(lines);
    case ".lua":
      return parseLua(lines);
    case ".pl":
    case ".pm":
      return parsePerl(lines);
    case ".sh":
    case ".bash":
    case ".zsh":
      return parseBash(lines);
    default:
      return [];
  }
}

/**
 * Find the end of a block that starts at `startLine` using brace/indent counting.
 * For brace-based languages.
 */
function findBraceBlockEnd(lines, startLine) {
  let depth = 0;
  let foundOpen = false;
  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i];
    for (const ch of line) {
      if (ch === "{") {
        depth++;
        foundOpen = true;
      } else if (ch === "}") {
        depth--;
        if (foundOpen && depth === 0) {
          return i;
        }
      }
    }
  }
  return lines.length - 1;
}

/**
 * Find block end for Python (indent-based).
 */
function findIndentBlockEnd(lines, startLine) {
  if (startLine >= lines.length) return startLine;
  const defLine = lines[startLine];
  const baseIndent = defLine.match(/^(\s*)/)[1].length;

  for (let i = startLine + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue; // skip blank lines
    const indent = line.match(/^(\s*)/)[1].length;
    if (indent <= baseIndent) {
      return i - 1;
    }
  }
  return lines.length - 1;
}

/**
 * Find block end for Ruby-like (def/end, class/end, module/end).
 */
function findRubyBlockEnd(lines, startLine) {
  let depth = 0;
  for (let i = startLine; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    // Keywords that open blocks
    if (
      /^(class|module|def|do|if|unless|case|while|until|for|begin)\b/.test(
        trimmed,
      ) ||
      /\bdo\s*(\|[^|]*\|)?\s*$/.test(trimmed)
    ) {
      depth++;
    }
    if (/^end\b/.test(trimmed)) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return lines.length - 1;
}

/**
 * Find block end for Lua (function/end).
 */
function findLuaBlockEnd(lines, startLine) {
  let depth = 0;
  for (let i = startLine; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (/\b(function|if|for|while|repeat)\b/.test(trimmed)) depth++;
    if (
      /^end\b/.test(trimmed) ||
      /\bend\s*[,)\]]/.test(trimmed) ||
      trimmed === "end"
    ) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return lines.length - 1;
}

function computeByteSize(lines, startLine, endLine) {
  let size = 0;
  for (let i = startLine; i <= endLine && i < lines.length; i++) {
    size += Buffer.byteLength(lines[i], "utf8") + 1; // +1 for newline
  }
  return size;
}

function buildElement(type, label, startLine, endLine, lines) {
  return {
    type,
    label,
    startLine: startLine + 1, // 1-indexed
    endLine: endLine + 1,
    size: computeByteSize(lines, startLine, endLine),
  };
}

// --- Language Parsers ---

function parsePython(lines) {
  const elements = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // class
    let m = trimmed.match(/^class\s+(\w+)(\(.*?\))?\s*:/);
    if (m) {
      const end = findIndentBlockEnd(lines, i);
      elements.push(buildElement("class", `class ${m[1]}`, i, end, lines));
      continue;
    }

    // async def
    m = trimmed.match(/^async\s+def\s+(\w+)\s*\((.*?)\)(\s*->.*?)?\s*:/);
    if (m) {
      const end = findIndentBlockEnd(lines, i);
      const sig = `${m[1]}(${m[2]})${m[3] || ""}`;
      const type = m[1] === "__init__" ? "ctor" : "async";
      elements.push(
        buildElement(
          type,
          `${type === "ctor" ? "ctor" : "async"} ${sig}`,
          i,
          end,
          lines,
        ),
      );
      continue;
    }

    // def
    m = trimmed.match(/^def\s+(\w+)\s*\((.*?)\)(\s*->.*?)?\s*:/);
    if (m) {
      const end = findIndentBlockEnd(lines, i);
      const sig = `${m[1]}(${m[2]})${m[3] || ""}`;
      let type = "fn";
      if (m[1] === "__init__") type = "ctor";
      else if (m[1].startsWith("test_")) type = "test";
      const label =
        type === "ctor"
          ? `ctor ${sig}`
          : type === "test"
            ? `test ${sig}`
            : `fn ${sig}`;
      elements.push(buildElement(type, label, i, end, lines));
      continue;
    }

    // for/while loops (> 5 lines)
    m = trimmed.match(/^(for|while)\s+(.+):\s*$/);
    if (m) {
      const end = findIndentBlockEnd(lines, i);
      if (end - i + 1 > 5) {
        elements.push(
          buildElement("loop", `loop ${m[1]} ${m[2]}`, i, end, lines),
        );
      }
      continue;
    }
  }
  return elements;
}

function parseJavaScript(lines) {
  const elements = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // class
    let m = trimmed.match(/^(export\s+)?(default\s+)?class\s+(\w+)/);
    if (m) {
      const end = findBraceBlockEnd(lines, i);
      elements.push(buildElement("class", `class ${m[3]}`, i, end, lines));
      continue;
    }

    // describe (test suite)
    m = trimmed.match(/^describe\s*\(\s*['"`]([^'"`]+)['"`]/);
    if (m) {
      const end = findBraceBlockEnd(lines, i);
      elements.push(
        buildElement("describe", `describe ${m[1]}`, i, end, lines),
      );
      continue;
    }

    // test/it blocks
    m = trimmed.match(/^(it|test)\s*\(\s*['"`]([^'"`]+)['"`]/);
    if (m) {
      const end = findBraceBlockEnd(lines, i);
      elements.push(buildElement("test", `test ${m[2]}`, i, end, lines));
      continue;
    }

    // async function
    m = trimmed.match(
      /^(export\s+)?(default\s+)?async\s+function\s+(\w+)\s*\((.*?)\)/,
    );
    if (m) {
      const end = findBraceBlockEnd(lines, i);
      elements.push(
        buildElement("async", `async ${m[3]}(${m[4]})`, i, end, lines),
      );
      continue;
    }

    // function
    m = trimmed.match(/^(export\s+)?(default\s+)?function\s+(\w+)\s*\((.*?)\)/);
    if (m) {
      const end = findBraceBlockEnd(lines, i);
      const type = m[3] === "constructor" ? "ctor" : "fn";
      elements.push(
        buildElement(type, `${type} ${m[3]}(${m[4]})`, i, end, lines),
      );
      continue;
    }

    // arrow functions assigned to const/let/var (with explicit function body)
    m = trimmed.match(
      /^(export\s+)?(const|let|var)\s+(\w+)\s*=\s*(async\s+)?\(?(.*?)\)?\s*=>/,
    );
    if (m && (trimmed.includes("{") || i + 1 < lines.length)) {
      // Only include if it has a block body
      if (
        trimmed.includes("{") ||
        (i + 1 < lines.length && lines[i + 1].trim().startsWith("{"))
      ) {
        const end = findBraceBlockEnd(lines, i);
        if (end > i) {
          const isAsync = !!m[4];
          const type = isAsync ? "async" : "fn";
          elements.push(
            buildElement(type, `${type} ${m[3]}(${m[5] || ""})`, i, end, lines),
          );
        }
      }
      continue;
    }

    // for/while loops (> 5 lines)
    m = trimmed.match(/^(for|while)\s*\((.+)\)\s*\{?/);
    if (m) {
      const end = findBraceBlockEnd(lines, i);
      if (end - i + 1 > 5) {
        elements.push(
          buildElement("loop", `loop ${m[1]} ${m[2]}`, i, end, lines),
        );
      }
      continue;
    }
  }
  return elements;
}

function parseTypeScript(lines) {
  const elements = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // interface
    let m = trimmed.match(/^(export\s+)?(default\s+)?interface\s+(\w+)/);
    if (m) {
      const end = findBraceBlockEnd(lines, i);
      elements.push(buildElement("class", `interface ${m[3]}`, i, end, lines));
      continue;
    }

    // class
    m = trimmed.match(/^(export\s+)?(default\s+)?(abstract\s+)?class\s+(\w+)/);
    if (m) {
      const end = findBraceBlockEnd(lines, i);
      elements.push(buildElement("class", `class ${m[4]}`, i, end, lines));
      continue;
    }

    // describe
    m = trimmed.match(/^describe\s*\(\s*['"`]([^'"`]+)['"`]/);
    if (m) {
      const end = findBraceBlockEnd(lines, i);
      elements.push(
        buildElement("describe", `describe ${m[1]}`, i, end, lines),
      );
      continue;
    }

    // test/it
    m = trimmed.match(/^(it|test)\s*\(\s*['"`]([^'"`]+)['"`]/);
    if (m) {
      const end = findBraceBlockEnd(lines, i);
      elements.push(buildElement("test", `test ${m[2]}`, i, end, lines));
      continue;
    }

    // async function
    m = trimmed.match(
      /^(export\s+)?(default\s+)?async\s+function\s+(\w+)\s*\((.*?)\)/,
    );
    if (m) {
      const end = findBraceBlockEnd(lines, i);
      elements.push(
        buildElement("async", `async ${m[3]}(${m[4]})`, i, end, lines),
      );
      continue;
    }

    // function
    m = trimmed.match(/^(export\s+)?(default\s+)?function\s+(\w+)\s*\((.*?)\)/);
    if (m) {
      const end = findBraceBlockEnd(lines, i);
      elements.push(buildElement("fn", `fn ${m[3]}(${m[4]})`, i, end, lines));
      continue;
    }

    // arrow functions
    m = trimmed.match(
      /^(export\s+)?(const|let|var)\s+(\w+)\s*=\s*(async\s+)?\(?(.*?)\)?\s*=>/,
    );
    if (m && trimmed.includes("{")) {
      const end = findBraceBlockEnd(lines, i);
      if (end > i) {
        const isAsync = !!m[4];
        const type = isAsync ? "async" : "fn";
        elements.push(
          buildElement(type, `${type} ${m[3]}(${m[5] || ""})`, i, end, lines),
        );
      }
      continue;
    }

    // for/while loops (> 5 lines)
    m = trimmed.match(/^(for|while)\s*\((.+)\)\s*\{?/);
    if (m) {
      const end = findBraceBlockEnd(lines, i);
      if (end - i + 1 > 5) {
        elements.push(
          buildElement("loop", `loop ${m[1]} ${m[2]}`, i, end, lines),
        );
      }
    }
  }
  return elements;
}

function parseGo(lines) {
  const elements = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    // struct
    let m = trimmed.match(/^type\s+(\w+)\s+struct\b/);
    if (m) {
      const end = findBraceBlockEnd(lines, i);
      elements.push(buildElement("class", `struct ${m[1]}`, i, end, lines));
      continue;
    }

    // interface
    m = trimmed.match(/^type\s+(\w+)\s+interface\b/);
    if (m) {
      const end = findBraceBlockEnd(lines, i);
      elements.push(buildElement("class", `interface ${m[1]}`, i, end, lines));
      continue;
    }

    // func
    m = trimmed.match(/^func\s+(\(.*?\)\s*)?(\w+)\s*\((.*?)\)/);
    if (m) {
      const end = findBraceBlockEnd(lines, i);
      const receiver = m[1] ? m[1].trim() + " " : "";
      const name = m[2];
      const type = name.startsWith("Test") ? "test" : "fn";
      elements.push(
        buildElement(
          type,
          `${type === "test" ? "test" : "fn"} ${receiver}${name}(${m[3]})`,
          i,
          end,
          lines,
        ),
      );
      continue;
    }

    // for loops (> 5 lines) - Go only has for
    m = trimmed.match(/^for\s+(.+)\s*\{/);
    if (m) {
      const end = findBraceBlockEnd(lines, i);
      if (end - i + 1 > 5) {
        elements.push(buildElement("loop", `loop for ${m[1]}`, i, end, lines));
      }
    }
  }
  return elements;
}

function parseRust(lines) {
  const elements = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    // struct
    let m = trimmed.match(/^(pub\s+)?struct\s+(\w+)/);
    if (m) {
      const end = findBraceBlockEnd(lines, i);
      elements.push(buildElement("class", `struct ${m[2]}`, i, end, lines));
      continue;
    }

    // enum
    m = trimmed.match(/^(pub\s+)?enum\s+(\w+)/);
    if (m) {
      const end = findBraceBlockEnd(lines, i);
      elements.push(buildElement("class", `enum ${m[2]}`, i, end, lines));
      continue;
    }

    // trait
    m = trimmed.match(/^(pub\s+)?trait\s+(\w+)/);
    if (m) {
      const end = findBraceBlockEnd(lines, i);
      elements.push(buildElement("class", `trait ${m[2]}`, i, end, lines));
      continue;
    }

    // impl
    m = trimmed.match(/^impl\s+(.+?)\s*\{/);
    if (m) {
      const end = findBraceBlockEnd(lines, i);
      elements.push(buildElement("impl", `impl ${m[1]}`, i, end, lines));
      continue;
    }

    // fn
    m = trimmed.match(/^(pub\s+)?(async\s+)?fn\s+(\w+)\s*\((.*?)\)/);
    if (m) {
      const end = findBraceBlockEnd(lines, i);
      const isAsync = !!m[2];
      const isTest = m[3].startsWith("test_");
      const type = isTest ? "test" : isAsync ? "async" : "fn";
      elements.push(
        buildElement(type, `${type} ${m[3]}(${m[4]})`, i, end, lines),
      );
      continue;
    }

    // loop/for/while (> 5 lines)
    m = trimmed.match(/^(for|while|loop)\b(.*)?\{/);
    if (m) {
      const end = findBraceBlockEnd(lines, i);
      if (end - i + 1 > 5) {
        elements.push(
          buildElement(
            "loop",
            `loop ${m[1]}${m[2] ? " " + m[2].trim() : ""}`,
            i,
            end,
            lines,
          ),
        );
      }
    }
  }
  return elements;
}

function parseJava(lines) {
  const elements = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    // class
    let m = trimmed.match(
      /^(public\s+|private\s+|protected\s+)?(static\s+)?(abstract\s+)?(final\s+)?class\s+(\w+)/,
    );
    if (m) {
      const end = findBraceBlockEnd(lines, i);
      elements.push(buildElement("class", `class ${m[5]}`, i, end, lines));
      continue;
    }

    // interface
    m = trimmed.match(/^(public\s+|private\s+|protected\s+)?interface\s+(\w+)/);
    if (m) {
      const end = findBraceBlockEnd(lines, i);
      elements.push(buildElement("class", `interface ${m[2]}`, i, end, lines));
      continue;
    }

    // enum
    m = trimmed.match(/^(public\s+|private\s+|protected\s+)?enum\s+(\w+)/);
    if (m) {
      const end = findBraceBlockEnd(lines, i);
      elements.push(buildElement("class", `enum ${m[2]}`, i, end, lines));
      continue;
    }

    // method (including constructors)
    m = trimmed.match(
      /^(public\s+|private\s+|protected\s+)?(static\s+)?(abstract\s+)?(final\s+)?(synchronized\s+)?(\w+\s+)?(\w+)\s*\((.*?)\)\s*(\{|throws)/,
    );
    if (
      m &&
      !["if", "for", "while", "switch", "catch", "return"].includes(m[7])
    ) {
      const end = findBraceBlockEnd(lines, i);
      const name = m[7];
      // Constructor: return type is absent and name matches class-like pattern
      const hasReturnType = m[6] && m[6].trim();
      const type = !hasReturnType
        ? "ctor"
        : name.startsWith("test")
          ? "test"
          : "fn";
      elements.push(
        buildElement(type, `${type} ${name}(${m[8]})`, i, end, lines),
      );
      continue;
    }

    // for/while loops (> 5 lines)
    m = trimmed.match(/^(for|while)\s*\((.+)\)\s*\{?/);
    if (m) {
      const end = findBraceBlockEnd(lines, i);
      if (end - i + 1 > 5) {
        elements.push(
          buildElement("loop", `loop ${m[1]} ${m[2]}`, i, end, lines),
        );
      }
    }
  }
  return elements;
}

function parseCCpp(lines) {
  const elements = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    // class
    let m = trimmed.match(/^class\s+(\w+)/);
    if (m) {
      const end = findBraceBlockEnd(lines, i);
      elements.push(buildElement("class", `class ${m[1]}`, i, end, lines));
      continue;
    }

    // struct
    m = trimmed.match(/^(typedef\s+)?struct\s+(\w+)/);
    if (m) {
      const end = findBraceBlockEnd(lines, i);
      elements.push(buildElement("class", `struct ${m[2]}`, i, end, lines));
      continue;
    }

    // function (C-style: return_type name(...))
    m = trimmed.match(/^(\w[\w\s*&]+?)\s+(\w+)\s*\(([^)]*)\)\s*(\{|$)/);
    if (
      m &&
      ![
        "if",
        "for",
        "while",
        "switch",
        "return",
        "typedef",
        "struct",
        "class",
        "enum",
      ].includes(m[2])
    ) {
      const end = findBraceBlockEnd(lines, i);
      elements.push(buildElement("fn", `fn ${m[2]}(${m[3]})`, i, end, lines));
      continue;
    }

    // for/while loops (> 5 lines)
    m = trimmed.match(/^(for|while)\s*\((.+)\)\s*\{?/);
    if (m) {
      const end = findBraceBlockEnd(lines, i);
      if (end - i + 1 > 5) {
        elements.push(
          buildElement("loop", `loop ${m[1]} ${m[2]}`, i, end, lines),
        );
      }
    }
  }
  return elements;
}

function parseCSharp(lines) {
  const elements = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    // class / struct / interface / enum / record
    let m = trimmed.match(
      /^(public\s+|private\s+|protected\s+|internal\s+)?(static\s+)?(abstract\s+|sealed\s+)?(partial\s+)?(class|struct|interface|enum|record)\s+(\w+)/,
    );
    if (m) {
      const end = findBraceBlockEnd(lines, i);
      elements.push(buildElement("class", `${m[5]} ${m[6]}`, i, end, lines));
      continue;
    }

    // method
    m = trimmed.match(
      /^(public\s+|private\s+|protected\s+|internal\s+)?(static\s+)?(async\s+)?(virtual\s+|override\s+|abstract\s+)?(\w[\w<>\[\],\s]*?)\s+(\w+)\s*\((.*?)\)\s*\{?/,
    );
    if (
      m &&
      ![
        "if",
        "for",
        "while",
        "switch",
        "catch",
        "return",
        "class",
        "struct",
        "interface",
        "enum",
      ].includes(m[6])
    ) {
      const end = findBraceBlockEnd(lines, i);
      const isAsync = !!m[3];
      const type = isAsync ? "async" : "fn";
      elements.push(
        buildElement(type, `${type} ${m[6]}(${m[7]})`, i, end, lines),
      );
      continue;
    }

    // for/while loops (> 5 lines)
    m = trimmed.match(/^(for|foreach|while)\s*\((.+)\)\s*\{?/);
    if (m) {
      const end = findBraceBlockEnd(lines, i);
      if (end - i + 1 > 5) {
        elements.push(
          buildElement("loop", `loop ${m[1]} ${m[2]}`, i, end, lines),
        );
      }
    }
  }
  return elements;
}

function parsePHP(lines) {
  const elements = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    // class / interface / trait
    let m = trimmed.match(
      /^(abstract\s+)?(final\s+)?(class|interface|trait)\s+(\w+)/,
    );
    if (m) {
      const end = findBraceBlockEnd(lines, i);
      elements.push(buildElement("class", `${m[3]} ${m[4]}`, i, end, lines));
      continue;
    }

    // function
    m = trimmed.match(
      /^(public\s+|private\s+|protected\s+)?(static\s+)?function\s+(\w+)\s*\((.*?)\)/,
    );
    if (m) {
      const end = findBraceBlockEnd(lines, i);
      const type =
        m[3] === "__construct"
          ? "ctor"
          : m[3].startsWith("test")
            ? "test"
            : "fn";
      elements.push(
        buildElement(type, `${type} ${m[3]}(${m[4]})`, i, end, lines),
      );
      continue;
    }

    // for/while loops (> 5 lines)
    m = trimmed.match(/^(for|foreach|while)\s*\((.+)\)\s*\{?/);
    if (m) {
      const end = findBraceBlockEnd(lines, i);
      if (end - i + 1 > 5) {
        elements.push(
          buildElement("loop", `loop ${m[1]} ${m[2]}`, i, end, lines),
        );
      }
    }
  }
  return elements;
}

function parseRuby(lines) {
  const elements = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    // class
    let m = trimmed.match(/^class\s+(\w+)/);
    if (m) {
      const end = findRubyBlockEnd(lines, i);
      elements.push(buildElement("class", `class ${m[1]}`, i, end, lines));
      continue;
    }

    // module
    m = trimmed.match(/^module\s+(\w+)/);
    if (m) {
      const end = findRubyBlockEnd(lines, i);
      elements.push(buildElement("class", `module ${m[1]}`, i, end, lines));
      continue;
    }

    // def
    m = trimmed.match(/^def\s+(self\.)?(\w+[?!=]?)\s*(\(.*?\))?/);
    if (m) {
      const end = findRubyBlockEnd(lines, i);
      const prefix = m[1] || "";
      const type =
        m[2] === "initialize"
          ? "ctor"
          : m[2].startsWith("test_")
            ? "test"
            : "fn";
      elements.push(
        buildElement(
          type,
          `${type} ${prefix}${m[2]}${m[3] || ""}`,
          i,
          end,
          lines,
        ),
      );
      continue;
    }
  }
  return elements;
}

function parseSwift(lines) {
  const elements = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    // class / struct / enum / protocol
    let m = trimmed.match(
      /^(public\s+|private\s+|internal\s+|open\s+|fileprivate\s+)?(final\s+)?(class|struct|enum|protocol)\s+(\w+)/,
    );
    if (m) {
      const end = findBraceBlockEnd(lines, i);
      elements.push(buildElement("class", `${m[3]} ${m[4]}`, i, end, lines));
      continue;
    }

    // func
    m = trimmed.match(
      /^(public\s+|private\s+|internal\s+|open\s+)?(static\s+|class\s+)?(override\s+)?func\s+(\w+)\s*\((.*?)\)/,
    );
    if (m) {
      const end = findBraceBlockEnd(lines, i);
      const name = m[4];
      const type =
        name === "init" ? "ctor" : name.startsWith("test") ? "test" : "fn";
      elements.push(
        buildElement(type, `${type} ${name}(${m[5]})`, i, end, lines),
      );
      continue;
    }

    // for/while loops (> 5 lines)
    m = trimmed.match(/^(for|while)\s+(.+)\s*\{/);
    if (m) {
      const end = findBraceBlockEnd(lines, i);
      if (end - i + 1 > 5) {
        elements.push(
          buildElement("loop", `loop ${m[1]} ${m[2]}`, i, end, lines),
        );
      }
    }
  }
  return elements;
}

function parseKotlin(lines) {
  const elements = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    // class / interface / object
    let m = trimmed.match(
      /^(open\s+|abstract\s+|data\s+|sealed\s+)?(class|interface|object)\s+(\w+)/,
    );
    if (m) {
      const end = findBraceBlockEnd(lines, i);
      elements.push(buildElement("class", `${m[2]} ${m[3]}`, i, end, lines));
      continue;
    }

    // fun
    m = trimmed.match(
      /^(public\s+|private\s+|protected\s+|internal\s+)?(override\s+)?(suspend\s+)?fun\s+(\w+)\s*\((.*?)\)/,
    );
    if (m) {
      const end = findBraceBlockEnd(lines, i);
      const isSuspend = !!m[3];
      const type = m[4].startsWith("test")
        ? "test"
        : isSuspend
          ? "async"
          : "fn";
      elements.push(
        buildElement(type, `${type} ${m[4]}(${m[5]})`, i, end, lines),
      );
      continue;
    }

    // for/while loops (> 5 lines)
    m = trimmed.match(/^(for|while)\s*\((.+)\)\s*\{?/);
    if (m) {
      const end = findBraceBlockEnd(lines, i);
      if (end - i + 1 > 5) {
        elements.push(
          buildElement("loop", `loop ${m[1]} ${m[2]}`, i, end, lines),
        );
      }
    }
  }
  return elements;
}

function parseScala(lines) {
  const elements = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    // class / object / trait
    let m = trimmed.match(/^(case\s+)?(class|object|trait)\s+(\w+)/);
    if (m) {
      const end = findBraceBlockEnd(lines, i);
      elements.push(
        buildElement("class", `${m[1] || ""}${m[2]} ${m[3]}`, i, end, lines),
      );
      continue;
    }

    // def
    m = trimmed.match(/^(override\s+)?def\s+(\w+)\s*(\(.*?\))?/);
    if (m) {
      const end = findBraceBlockEnd(lines, i);
      const type = m[2].startsWith("test") ? "test" : "fn";
      elements.push(
        buildElement(type, `${type} ${m[2]}${m[3] || ""}`, i, end, lines),
      );
      continue;
    }
  }
  return elements;
}

function parseLua(lines) {
  const elements = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    // function / local function
    let m = trimmed.match(/^(local\s+)?function\s+([\w.:]+)\s*\((.*?)\)/);
    if (m) {
      const end = findLuaBlockEnd(lines, i);
      elements.push(buildElement("fn", `fn ${m[2]}(${m[3]})`, i, end, lines));
      continue;
    }

    // for/while loops (> 5 lines)
    m = trimmed.match(/^(for|while)\s+(.+)\s+do/);
    if (m) {
      const end = findLuaBlockEnd(lines, i);
      if (end - i + 1 > 5) {
        elements.push(
          buildElement("loop", `loop ${m[1]} ${m[2]}`, i, end, lines),
        );
      }
    }
  }
  return elements;
}

function parsePerl(lines) {
  const elements = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    // package
    let m = trimmed.match(/^package\s+([\w:]+)/);
    if (m) {
      elements.push(buildElement("class", `package ${m[1]}`, i, i, lines));
      continue;
    }

    // sub
    m = trimmed.match(/^sub\s+(\w+)/);
    if (m) {
      const end = findBraceBlockEnd(lines, i);
      elements.push(buildElement("fn", `fn ${m[1]}`, i, end, lines));
      continue;
    }
  }
  return elements;
}

function parseBash(lines) {
  const elements = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    // function keyword or name()
    let m = trimmed.match(/^(function\s+)?(\w+)\s*\(\s*\)\s*\{?/);
    if (m && m[1]) {
      // function keyword form
      const end = findBraceBlockEnd(lines, i);
      elements.push(buildElement("fn", `fn ${m[2]}`, i, end, lines));
      continue;
    }
    if (m && !m[1] && trimmed.includes("()")) {
      // name() form
      const end = findBraceBlockEnd(lines, i);
      elements.push(buildElement("fn", `fn ${m[2]}`, i, end, lines));
      continue;
    }

    // for/while loops (> 5 lines)
    m = trimmed.match(/^(for|while)\s+(.+?);\s*do/);
    if (!m) m = trimmed.match(/^(for|while)\s+(.+)/);
    if (m) {
      // Look for done
      let end = i;
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim() === "done") {
          end = j;
          break;
        }
      }
      if (end - i + 1 > 5) {
        elements.push(
          buildElement("loop", `loop ${m[1]} ${m[2]}`, i, end, lines),
        );
      }
    }
  }
  return elements;
}

// ---------------------------------------------------------------------------
// Nesting + Tree Building
// ---------------------------------------------------------------------------

/**
 * Nest flat elements into a tree based on line ranges.
 * Elements that fall within the range of a parent become children.
 */
function nestElements(elements) {
  if (!elements.length) return [];

  // Sort by start line, then by larger range first (parents before children)
  const sorted = [...elements].sort((a, b) => {
    if (a.startLine !== b.startLine) return a.startLine - b.startLine;
    return b.endLine - b.startLine - (a.endLine - a.startLine);
  });

  const root = [];
  const stack = []; // stack of { element, children }

  for (const el of sorted) {
    const node = { ...el, children: [] };

    // Pop from stack if current element is outside of parent's range
    while (stack.length > 0) {
      const parent = stack[stack.length - 1];
      if (el.startLine >= parent.startLine && el.endLine <= parent.endLine) {
        break;
      }
      stack.pop();
    }

    if (stack.length > 0) {
      stack[stack.length - 1].children.push(node);
    } else {
      root.push(node);
    }

    stack.push(node);
  }

  return root;
}

// ---------------------------------------------------------------------------
// Directory Walker (unchanged from v1)
// ---------------------------------------------------------------------------

function walkDirectory(
  currentDir,
  rootDir,
  ignoreChain,
  allowedExts,
  absoluteOutputPath,
  useGitIgnore,
  stats,
) {
  let results = [];
  let currentIgnoreManager = null;

  if (useGitIgnore) {
    const gitignorePath = path.join(currentDir, ".gitignore");
    if (fs.existsSync(gitignorePath)) {
      try {
        const content = fs.readFileSync(gitignorePath, "utf8");
        const ig = ignore().add(content);
        currentIgnoreManager = { manager: ig, root: currentDir };
      } catch (e) {}
    }
  }

  const nextIgnoreChain = currentIgnoreManager
    ? [...ignoreChain, currentIgnoreManager]
    : ignoreChain;

  let entries;
  try {
    entries = fs.readdirSync(currentDir, { withFileTypes: true });
  } catch (e) {
    return [];
  }

  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);

    if (path.resolve(fullPath) === absoluteOutputPath) continue;

    let shouldIgnore = false;
    for (const item of nextIgnoreChain) {
      let relToIgnoreRoot = path.relative(item.root, fullPath);
      if (path.sep === "\\") {
        relToIgnoreRoot = relToIgnoreRoot.replace(/\\/g, "/");
      }
      if (entry.isDirectory() && !relToIgnoreRoot.endsWith("/")) {
        relToIgnoreRoot += "/";
      }
      if (item.manager.ignores(relToIgnoreRoot)) {
        shouldIgnore = true;
        break;
      }
    }

    if (shouldIgnore) {
      stats.ignored++;
      continue;
    }

    if (entry.isDirectory()) {
      results = results.concat(
        walkDirectory(
          fullPath,
          rootDir,
          nextIgnoreChain,
          allowedExts,
          absoluteOutputPath,
          useGitIgnore,
          stats,
        ),
      );
    } else if (entry.isFile()) {
      if (isLikelyBinary(fullPath)) {
        stats.ignored++;
        continue;
      }
      if (allowedExts && !allowedExts.has(path.extname(entry.name))) {
        stats.ignored++;
        continue;
      }
      try {
        const fileStats = fs.statSync(fullPath);
        const relativeToRoot = path.relative(rootDir, fullPath);
        stats.scanned++;
        results.push({
          path: fullPath,
          relativePath: relativeToRoot,
          size: fileStats.size,
          formattedSize: formatBytes(fileStats.size),
        });
      } catch (e) {}
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Code Index Tree Generator (v2.0.0)
// ---------------------------------------------------------------------------

/**
 * Build the <code_index> tree with expanded code elements.
 */
function generateCodeIndex(filesWithMeta, root, skipContentSet, noParse) {
  let tree = `${path.basename(root)}/\n`;

  // Build directory structure
  const structure = {};
  for (const file of filesWithMeta) {
    const parts = file.relativePath.split(path.sep);
    let currentLevel = structure;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isFile = i === parts.length - 1;
      if (isFile) {
        currentLevel[part] = { __file: file };
      } else {
        if (!currentLevel[part]) currentLevel[part] = {};
        currentLevel = currentLevel[part];
      }
    }
  }

  function renderTree(level, prefix) {
    const keys = Object.keys(level);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const isLast = i === keys.length - 1;
      const connector = isLast ? "\u2514\u2500\u2500 " : "\u251c\u2500\u2500 ";
      const childPrefix = prefix + (isLast ? "    " : "\u2502   ");
      const value = level[key];

      if (value.__file) {
        const f = value.__file;
        const olRange = `OL: 1-${f.lineCount}`;
        const mlRange = `ML: ${f.mlStart}-${f.mlEnd}`;
        const sizeStr = f.formattedSize;
        const isSkipped = skipContentSet && skipContentSet.has(f.relativePath);

        tree += `${prefix}${connector}${key} [${olRange} | ${mlRange} | ${sizeStr}]\n`;

        if (isSkipped) {
          tree += `${childPrefix}(Content omitted - file size: ${sizeStr})\n`;
        } else if (!noParse && f.codeElements && f.codeElements.length > 0) {
          renderCodeElements(f.codeElements, childPrefix, f.mlStart);
        }
      } else {
        // Directory
        tree += `${prefix}${connector}${key}/\n`;
        renderTree(value, childPrefix);
      }
    }
  }

  function renderCodeElements(elements, prefix, mlOffset) {
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      const isLast = i === elements.length - 1;
      const connector = isLast ? "\u2514\u2500\u2500 " : "\u251c\u2500\u2500 ";
      const childPrefix = prefix + (isLast ? "    " : "\u2502   ");

      const olRange = `OL: ${el.startLine}-${el.endLine}`;
      const mlStart = mlOffset + el.startLine - 1;
      const mlEnd = mlOffset + el.endLine - 1;
      const mlRange = `ML: ${mlStart}-${mlEnd}`;
      const sizeStr = formatBytes(el.size);

      tree += `${prefix}${connector}${el.label} [${olRange} | ${mlRange} | ${sizeStr}]\n`;

      if (el.children && el.children.length > 0) {
        renderCodeElements(el.children, childPrefix, mlOffset);
      }
    }
  }

  renderTree(structure, "");
  return tree;
}

// ---------------------------------------------------------------------------
// Recreate functionality (v2.0.0)
// ---------------------------------------------------------------------------

function recreateFromFile(inputFile, outputDir, dryRun, overwrite) {
  if (!fs.existsSync(inputFile)) {
    console.error(`\n\u274c Input file not found: ${inputFile}`);
    process.exit(1);
  }

  const content = fs.readFileSync(inputFile, "utf8");

  // Parse files from the merged_code section (or legacy format)
  const files = [];
  // Match: # FILE: path [...]  followed by ```` block
  const fileRegex = /# FILE:\s*(.+?)\s*\[.*?\]\n````\n([\s\S]*?)\n````/g;
  let match;

  while ((match = fileRegex.exec(content)) !== null) {
    const filePath = match[1].trim();
    const fileContent = match[2];

    // Skip content-omitted files
    if (fileContent.trim().startsWith("(Content omitted")) continue;

    files.push({ path: filePath, content: fileContent });
  }

  if (files.length === 0) {
    // Try legacy format: ### **FILE:** `path`
    const legacyRegex = /### \*\*FILE:\*\*\s*`(.+?)`\n````\n([\s\S]*?)\n````/g;
    while ((match = legacyRegex.exec(content)) !== null) {
      const filePath = match[1].trim();
      const fileContent = match[2];
      if (fileContent.trim().startsWith("(Content omitted")) continue;
      files.push({ path: filePath, content: fileContent });
    }
  }

  if (files.length === 0) {
    console.error("\n\u274c No files found in the input file.");
    process.exit(1);
  }

  const resolvedOutputDir = path.resolve(outputDir);
  console.log(`\n\ud83d\udcc2 Output directory: ${resolvedOutputDir}\n`);

  let totalSize = 0;

  for (const file of files) {
    const fullPath = path.join(resolvedOutputDir, file.path);
    const size = Buffer.byteLength(file.content, "utf8");
    totalSize += size;

    console.log(`   ${file.path} (${formatBytes(size)})`);

    if (!dryRun) {
      if (fs.existsSync(fullPath) && !overwrite) {
        console.error(`   \u26a0\ufe0f  Skipped (exists): ${file.path}`);
        continue;
      }
      const dir = path.dirname(fullPath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(fullPath, file.content, "utf8");
    }
  }

  console.log(`\n\ud83d\udcca Summary:`);
  console.log(
    `   \u2022 ${dryRun ? "Files to recreate" : "Files recreated"}: ${files.length}`,
  );
  console.log(`   \u2022 Total size: ${formatBytes(totalSize)}`);
  console.log(`\n\u2705 Done!`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const rawArgv = hideBin(process.argv);
  if (rawArgv.includes("--version") || rawArgv.includes("-v")) {
    console.log(`Combicode (JavaScript), version ${version}`);
    process.exit(0);
  }

  const argv = yargs(rawArgv)
    .scriptName("combicode")
    .usage("$0 [options]")
    .option("o", {
      alias: "output",
      describe: "Output file (combine) or directory (recreate)",
      type: "string",
      default: "combicode.txt",
    })
    .option("d", {
      alias: "dry-run",
      describe: "Preview without making changes",
      type: "boolean",
      default: false,
    })
    .option("i", {
      alias: "include-ext",
      describe: "Comma-separated extensions to include (e.g., .js,.ts)",
      type: "string",
    })
    .option("e", {
      alias: "exclude",
      describe: "Comma-separated glob patterns to exclude",
      type: "string",
    })
    .option("l", {
      alias: "llms-txt",
      describe: "Use the system prompt for llms.txt context",
      type: "boolean",
      default: false,
    })
    .option("gitignore", {
      describe: "Use patterns from the project's .gitignore file",
      type: "boolean",
      default: true,
    })
    .option("header", {
      describe: "Include the introductory prompt and code index in the output",
      type: "boolean",
      default: true,
    })
    .option("skip-content", {
      describe:
        "Comma-separated glob patterns for files to include in tree but omit content",
      type: "string",
    })
    .option("parse", {
      describe: "Enable code structure parsing",
      type: "boolean",
      default: true,
    })
    .option("r", {
      alias: "recreate",
      describe: "Recreate project from a combicode.txt file",
      type: "boolean",
      default: false,
    })
    .option("input", {
      describe: "Input combicode.txt file for recreate",
      type: "string",
      default: "combicode.txt",
    })
    .option("overwrite", {
      describe: "Overwrite existing files when recreating",
      type: "boolean",
      default: false,
    })
    .version(version)
    .alias("v", "version")
    .help()
    .alias("h", "help").argv;

  const projectRoot = process.cwd();
  console.log(`\u2728 Combicode v${version}`);
  console.log(`\ud83d\udcc2 Root: ${projectRoot}`);

  // --- Recreate mode ---
  if (argv.recreate) {
    const inputFile = path.resolve(projectRoot, argv.input);
    const outputDir =
      argv.output !== "combicode.txt" ? argv.output : projectRoot;
    recreateFromFile(inputFile, outputDir, argv.dryRun, argv.overwrite);
    return;
  }

  // --- Combine mode ---
  const rootIgnoreManager = ignore();
  rootIgnoreManager.add(SAFETY_IGNORES);

  if (argv.exclude) {
    rootIgnoreManager.add(argv.exclude.split(","));
  }

  // Parse .gitmodules for submodule paths
  const gitModulesPath = path.join(projectRoot, ".gitmodules");
  if (fs.existsSync(gitModulesPath)) {
    try {
      const content = fs.readFileSync(gitModulesPath, "utf8");
      const lines = content.split(/\r?\n/);
      for (const line of lines) {
        const m = line.match(/^\s*path\s*=\s*(.+?)\s*$/);
        if (m) rootIgnoreManager.add([m[1]]);
      }
    } catch (e) {}
  }

  const skipContentManager = ignore();
  if (argv.skipContent) {
    skipContentManager.add(argv.skipContent.split(","));
  }

  const absoluteOutputPath = path.resolve(projectRoot, argv.output);

  const allowedExtensions = argv.includeExt
    ? new Set(
        argv.includeExt
          .split(",")
          .map((ext) => (ext.startsWith(".") ? ext : `.${ext}`)),
      )
    : null;

  const ignoreChain = [{ manager: rootIgnoreManager, root: projectRoot }];
  const stats = { scanned: 0, ignored: 0 };

  const includedFiles = walkDirectory(
    projectRoot,
    projectRoot,
    ignoreChain,
    allowedExtensions,
    absoluteOutputPath,
    argv.gitignore,
    stats,
  );

  includedFiles.sort((a, b) => a.path.localeCompare(b.path));

  // Determine skip-content set
  const skipContentSet = new Set();
  if (argv.skipContent) {
    includedFiles.forEach((file) => {
      const relativePath = file.relativePath.replace(/\\/g, "/");
      if (skipContentManager.ignores(relativePath)) {
        skipContentSet.add(file.relativePath);
      }
    });
  }

  if (includedFiles.length === 0) {
    console.error(
      "\n\u274c No files to include. Check your path, .gitignore, or filters.",
    );
    process.exit(1);
  }

  // --- Read file contents & parse code structure ---
  for (const fileObj of includedFiles) {
    const isSkipped = skipContentSet.has(fileObj.relativePath);
    if (isSkipped) {
      fileObj.content = null;
      fileObj.lineCount = 0;
      fileObj.codeElements = [];
    } else {
      try {
        fileObj.content = fs.readFileSync(fileObj.path, "utf8");
        // Count actual lines: strings ending with \n get an extra empty element from split
        const parts = fileObj.content.split("\n");
        fileObj.lineCount = fileObj.content.endsWith("\n")
          ? parts.length - 1
          : parts.length;

        if (argv.parse) {
          const flat = parseCodeStructure(
            fileObj.relativePath,
            fileObj.content,
          );
          fileObj.codeElements = nestElements(flat);
        } else {
          fileObj.codeElements = [];
        }
      } catch (e) {
        fileObj.content = `... (error reading file: ${e.message}) ...`;
        fileObj.lineCount = 1;
        fileObj.codeElements = [];
      }
    }
  }

  // --- Calculate ML (Merged Line) offsets ---
  // First pass: figure out how many header lines come before merged_code
  const systemPrompt = argv.llmsTxt
    ? LLMS_TXT_SYSTEM_PROMPT
    : DEFAULT_SYSTEM_PROMPT;
  let headerLines = 0;
  if (argv.header) {
    headerLines += systemPrompt.split("\n").length; // system prompt
    headerLines += 1; // blank line after prompt
    // <code_index> section will be added but we need to calculate it after ML offsets are known
    // We'll do a two-pass approach
  }

  // Two-pass: first compute code_index size, then compute ML offsets
  // Pass 1: Assign provisional ML offsets (we'll need the code_index line count first)
  // The structure is: header + code_index_block + merged_code_block

  // Compute provisional line count for each file in merged_code
  // Each file: "# FILE: path [...]\n````\n" + content + "\n````\n"  = 4 lines + content lines
  let mergedCodeHeaderLine = 1; // Will be set properly
  let currentMl = 1;

  // We need to do this iteratively:
  // 1. Calculate code_index with placeholder MLs
  // 2. Count code_index lines
  // 3. Calculate real MLs
  // 4. Regenerate code_index with real MLs

  // Step 1: Assign temporary ML values
  let tempMl = 1; // placeholder
  for (const fileObj of includedFiles) {
    fileObj.mlStart = tempMl;
    const isSkipped = skipContentSet.has(fileObj.relativePath);
    if (isSkipped) {
      fileObj.mlEnd = tempMl + 1; // placeholder line
      tempMl += 4 + 1; // header(2) + placeholder(1) + footer(1) = 4
    } else {
      fileObj.mlEnd = tempMl + fileObj.lineCount - 1;
      tempMl += 4 + fileObj.lineCount; // header(2) + content + footer(2)
    }
  }

  // Step 2: Generate provisional code_index to count lines
  let codeIndex = generateCodeIndex(
    includedFiles,
    projectRoot,
    skipContentSet,
    !argv.parse,
  );
  // codeIndex ends with \n, so split produces an extra empty element
  const codeIndexLineCount = codeIndex.endsWith("\n")
    ? codeIndex.split("\n").length - 1
    : codeIndex.split("\n").length;

  // Step 3: Calculate real header line count
  let totalHeaderLines = 0;
  if (argv.header) {
    totalHeaderLines += systemPrompt.split("\n").length; // prompt lines + blank line from extra \n
    totalHeaderLines += 1; // "<code_index>"
    totalHeaderLines += codeIndexLineCount; // code index content
    totalHeaderLines += 1; // "</code_index>"
    totalHeaderLines += 1; // blank line
    totalHeaderLines += 1; // "<merged_code>"
  } else {
    totalHeaderLines += 1; // "<merged_code>"
  }

  // Step 4: Recalculate ML offsets with real header
  currentMl = totalHeaderLines + 1;
  for (const fileObj of includedFiles) {
    const isSkipped = skipContentSet.has(fileObj.relativePath);
    // File header: "# FILE: path [...]\n````\n" = 2 lines
    fileObj.mlStart = currentMl + 2; // Content starts after header
    if (isSkipped) {
      fileObj.mlEnd = fileObj.mlStart; // 1 line placeholder
      currentMl += 2 + 1 + 2; // header(2) + placeholder(1) + footer(2: "\n````\n")
    } else {
      fileObj.mlEnd = fileObj.mlStart + fileObj.lineCount - 1;
      currentMl += 2 + fileObj.lineCount + 2; // header(2) + content + footer(2)
    }
  }

  // Step 5: Regenerate code_index with correct MLs
  codeIndex = generateCodeIndex(
    includedFiles,
    projectRoot,
    skipContentSet,
    !argv.parse,
  );

  // Calculate total content size
  const totalSizeBytes = includedFiles.reduce((acc, file) => {
    if (skipContentSet.has(file.relativePath)) return acc;
    return acc + file.size;
  }, 0);

  // --- Dry run ---
  if (argv.dryRun) {
    console.log("\n\ud83d\udccb Files to include (dry run):\n");
    console.log(codeIndex);
    console.log(`\n\ud83d\udcca Summary:`);
    console.log(`   \u2022 Total files: ${includedFiles.length}`);
    console.log(`   \u2022 Total size: ${formatBytes(totalSizeBytes)}`);
    if (skipContentSet.size > 0) {
      console.log(`   \u2022 Content omitted: ${skipContentSet.size} files`);
    }
    console.log(`\n\u2705 Done!`);
    return;
  }

  // --- Write output ---
  const outputStream = fs.createWriteStream(argv.output);
  let totalLines = 0;

  if (argv.header) {
    outputStream.write(systemPrompt + "\n");
    totalLines += systemPrompt.split("\n").length + 1;

    outputStream.write("<code_index>\n");
    outputStream.write(codeIndex);
    outputStream.write("</code_index>\n\n");
    totalLines += codeIndexLineCount + 3;

    outputStream.write("<merged_code>\n");
    totalLines += 1;
  } else {
    outputStream.write("<merged_code>\n");
    totalLines += 1;
  }

  for (const fileObj of includedFiles) {
    const relativePath = fileObj.relativePath.replace(/\\/g, "/");
    const isSkipped = skipContentSet.has(fileObj.relativePath);

    const olRange = `OL: 1-${fileObj.lineCount}`;
    const mlRange = `ML: ${fileObj.mlStart}-${fileObj.mlEnd}`;
    const sizeStr = fileObj.formattedSize;

    outputStream.write(
      `# FILE: ${relativePath} [${olRange} | ${mlRange} | ${sizeStr}]\n`,
    );
    outputStream.write("````\n");
    totalLines += 2;

    if (isSkipped) {
      outputStream.write(`(Content omitted - file size: ${sizeStr})\n`);
      totalLines += 1;
    } else {
      outputStream.write(fileObj.content);
      if (!fileObj.content.endsWith("\n")) {
        outputStream.write("\n");
      }
      totalLines += fileObj.lineCount;
    }

    outputStream.write("````\n\n");
    totalLines += 2;
  }

  outputStream.write("</merged_code>\n");
  totalLines += 1;
  outputStream.end();

  console.log(`\n\ud83d\udcca Summary:`);
  console.log(
    `   \u2022 Included: ${includedFiles.length} files (${formatBytes(totalSizeBytes)})`,
  );
  if (skipContentSet.size > 0) {
    console.log(`   \u2022 Content omitted: ${skipContentSet.size} files`);
  }
  console.log(`   \u2022 Ignored:  ${stats.ignored} files/dirs`);
  console.log(`   \u2022 Output:   ${argv.output} (~${totalLines} lines)`);
  console.log(`\n\u2705 Done!`);
}

main().catch((err) => {
  console.error(`An unexpected error occurred: ${err.message}`);
  process.exit(1);
});
