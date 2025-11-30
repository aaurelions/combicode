#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const yargs = require("yargs/yargs");
const { hideBin } = require("yargs/helpers");
const glob = require("fast-glob");

const { version } = require("./package.json");

const DEFAULT_SYSTEM_PROMPT = `You are an expert software architect. The user is providing you with the complete source code for a project, contained in a single file. Your task is to meticulously analyze the provided codebase to gain a comprehensive understanding of its structure, functionality, dependencies, and overall architecture.

A file tree is provided below to give you a high-level overview. The subsequent sections contain the full content of each file, clearly marked with a file header.

Your instructions are:
1.  **Analyze Thoroughly:** Read through every file to understand its purpose and how it interacts with other files.
2.  **Identify Key Components:** Pay close attention to configuration files (like package.json, pyproject.toml), entry points (like index.js, main.py), and core logic.
`;

const LLMS_TXT_SYSTEM_PROMPT = `You are an expert software architect. The user is providing you with the full documentation for a project, sourced from the project's 'llms.txt' file. This file contains the complete context needed to understand the project's features, APIs, and usage for a specific version. Your task is to act as a definitive source of truth based *only* on this provided documentation.

When answering questions or writing code, adhere strictly to the functions, variables, and methods described in this context. Do not use or suggest any deprecated or older functionalities that are not present here.

A file tree of the documentation source is provided below for a high-level overview. The subsequent sections contain the full content of each file, clearly marked with a file header.
`;

function loadDefaultIgnorePatterns() {
  const configPath = path.resolve(__dirname, "config", "ignore.json");
  try {
    const rawConfig = fs.readFileSync(configPath, "utf8");
    return JSON.parse(rawConfig);
  } catch (err) {
    console.error(
      `❌ Critical: Could not read or parse bundled ignore config at ${configPath}`
    );
    process.exit(1);
  }
}

const DEFAULT_IGNORE_PATTERNS = loadDefaultIgnorePatterns();

function isLikelyBinary(file) {
  const buffer = Buffer.alloc(512);
  let fd;
  try {
    fd = fs.openSync(file, "r");
    const bytesRead = fs.readSync(fd, buffer, 0, 512, 0);
    return buffer.slice(0, bytesRead).includes(0);
  } catch (e) {
    return true;
  } finally {
    if (fd) fs.closeSync(fd);
  }
}

function formatBytes(bytes, decimals = 1) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + "" + sizes[i];
}

function generateFileTree(filesWithSize, root) {
  let tree = `${path.basename(root)}/\n`;
  const structure = {};

  // Build the structure
  filesWithSize.forEach(({ relativePath, formattedSize }) => {
    const parts = relativePath.split(path.sep);
    let currentLevel = structure;
    parts.forEach((part, index) => {
      const isFile = index === parts.length - 1;
      if (isFile) {
        currentLevel[part] = formattedSize;
      } else {
        if (!currentLevel[part]) {
          currentLevel[part] = {};
        }
        currentLevel = currentLevel[part];
      }
    });
  });

  const buildTree = (level, prefix) => {
    const entries = Object.keys(level);
    entries.forEach((entry, index) => {
      const isLast = index === entries.length - 1;
      const value = level[entry];
      const isFile = typeof value === "string";

      const connector = isLast ? "└── " : "├── ";

      if (isFile) {
        tree += `${prefix}${connector}[${value}] ${entry}\n`;
      } else {
        tree += `${prefix}${connector}${entry}\n`;
        buildTree(value, `${prefix}${isLast ? "    " : "│   "}`);
      }
    });
  };

  buildTree(structure, "");
  return tree;
}

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
      describe: "Output file name",
      type: "string",
      default: "combicode.txt",
    })
    .option("d", {
      alias: "dry-run",
      describe: "Preview files without creating the output file",
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
    .option("no-gitignore", {
      describe: "Ignore the project's .gitignore file",
      type: "boolean",
      default: false,
    })
    .option("no-header", {
      describe: "Omit the introductory prompt and file tree from the output",
      type: "boolean",
      default: false,
    })
    .version(version)
    .alias("v", "version")
    .help()
    .alias("h", "help").argv;

  const projectRoot = process.cwd();
  console.log(`✨ Running Combicode in: ${projectRoot}`);

  const ignorePatterns = [...DEFAULT_IGNORE_PATTERNS];

  if (!argv.noGitignore) {
    const gitignorePath = path.join(projectRoot, ".gitignore");
    if (fs.existsSync(gitignorePath)) {
      console.log("🔎 Found and using .gitignore");
      const gitignoreContent = fs.readFileSync(gitignorePath, "utf8");
      ignorePatterns.push(
        ...gitignoreContent
          .split(/\r?\n/)
          .filter((line) => line && !line.startsWith("#"))
      );
    }
  }

  if (argv.exclude) {
    ignorePatterns.push(...argv.exclude.split(","));
  }

  let allFiles = await glob("**/*", {
    cwd: projectRoot,
    dot: true,
    ignore: ignorePatterns,
    absolute: true,
    stats: true,
  });

  const allowedExtensions = argv.includeExt
    ? new Set(
        argv.includeExt
          .split(",")
          .map((ext) => (ext.startsWith(".") ? ext : `.${ext}`))
      )
    : null;

  const includedFiles = allFiles
    .filter((fileObj) => {
      const file = fileObj.path;
      if (!fileObj.stats || fileObj.stats.isDirectory()) return false;
      if (isLikelyBinary(file)) return false;
      if (allowedExtensions && !allowedExtensions.has(path.extname(file)))
        return false;
      return true;
    })
    .map((fileObj) => ({
      path: fileObj.path,
      relativePath: path.relative(projectRoot, fileObj.path),
      size: fileObj.stats.size,
      formattedSize: formatBytes(fileObj.stats.size),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));

  if (includedFiles.length === 0) {
    console.error("❌ No files to include. Check your path or filters.");
    process.exit(1);
  }

  if (argv.dryRun) {
    console.log("\n📋 Files to be included (Dry Run):\n");
    const tree = generateFileTree(includedFiles, projectRoot);
    console.log(tree);
    console.log(`\nTotal: ${includedFiles.length} files.`);
    return;
  }

  const outputStream = fs.createWriteStream(argv.output);

  if (!argv.noHeader) {
    const systemPrompt = argv.llmsTxt
      ? LLMS_TXT_SYSTEM_PROMPT
      : DEFAULT_SYSTEM_PROMPT;
    outputStream.write(systemPrompt + "\n");
    outputStream.write("## Project File Tree\n\n");
    outputStream.write("```\n");
    const tree = generateFileTree(includedFiles, projectRoot);
    outputStream.write(tree);
    outputStream.write("```\n\n");
    outputStream.write("---\n\n");
  }

  for (const fileObj of includedFiles) {
    const relativePath = fileObj.relativePath.replace(/\\/g, "/");
    outputStream.write(`### **FILE:** \`${relativePath}\`\n`);
    outputStream.write("```\n");
    try {
      const content = fs.readFileSync(fileObj.path, "utf8");
      outputStream.write(content);
    } catch (e) {
      outputStream.write(`... (error reading file: ${e.message}) ...`);
    }
    outputStream.write("\n```\n\n");
  }
  outputStream.end();

  console.log(
    `\n✅ Success! Combined ${includedFiles.length} files into '${argv.output}'.`
  );
}

main().catch((err) => {
  console.error(`An unexpected error occurred: ${err.message}`);
  process.exit(1);
});
