#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const yargs = require("yargs/yargs");
const { hideBin } = require("yargs/helpers");
const ignore = require("ignore");

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

// Minimal safety ignores that should always apply
const SAFETY_IGNORES = [".git", ".DS_Store"];

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
  if (bytes === 0) return "0 B";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + "" + sizes[i];
}

/**
 * Recursively walks directories, respecting .gitignore files at each level.
 */
function walkDirectory(
  currentDir,
  rootDir,
  ignoreChain,
  allowedExts,
  absoluteOutputPath,
  useGitIgnore,
  stats // { scanned: 0, ignored: 0 }
) {
  let results = [];
  let currentIgnoreManager = null;

  // 1. Check for local .gitignore and add to chain for this scope
  if (useGitIgnore) {
    const gitignorePath = path.join(currentDir, ".gitignore");
    if (fs.existsSync(gitignorePath)) {
      try {
        const content = fs.readFileSync(gitignorePath, "utf8");
        const ig = ignore().add(content);
        currentIgnoreManager = { manager: ig, root: currentDir };
      } catch (e) {
        // Warning could go here
      }
    }
  }

  // Create a new chain for this directory and its children
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

    // SKIP CHECK: Output file
    if (path.resolve(fullPath) === absoluteOutputPath) continue;

    // SKIP CHECK: Ignore Chain
    let shouldIgnore = false;
    for (const item of nextIgnoreChain) {
      // Calculate path relative to the specific ignore manager's root
      // IMPORTANT: Normalize to POSIX slashes for 'ignore' package compatibility
      let relToIgnoreRoot = path.relative(item.root, fullPath);

      if (path.sep === "\\") {
        relToIgnoreRoot = relToIgnoreRoot.replace(/\\/g, "/");
      }

      // If checking a directory, ensure trailing slash for proper 'ignore' directory matching
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
      // Recurse
      results = results.concat(
        walkDirectory(
          fullPath,
          rootDir,
          nextIgnoreChain,
          allowedExts,
          absoluteOutputPath,
          useGitIgnore,
          stats
        )
      );
    } else if (entry.isFile()) {
      // SKIP CHECK: Binary
      if (isLikelyBinary(fullPath)) {
        stats.ignored++;
        continue;
      }

      // SKIP CHECK: Extensions
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
      } catch (e) {
        // Skip inaccessible files
      }
    }
  }

  return results;
}

function generateFileTree(filesWithSize, root) {
  let tree = `${path.basename(root)}/\n`;
  const structure = {};

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
  console.log(`\n✨ Combicode v${version}`);
  console.log(`📂 Root: ${projectRoot}`);

  const rootIgnoreManager = ignore();

  // Only add minimal safety ignores + CLI excludes.
  // No external JSON config is loaded.
  rootIgnoreManager.add(SAFETY_IGNORES);

  if (argv.exclude) {
    rootIgnoreManager.add(argv.exclude.split(","));
  }

  const absoluteOutputPath = path.resolve(projectRoot, argv.output);

  const allowedExtensions = argv.includeExt
    ? new Set(
        argv.includeExt
          .split(",")
          .map((ext) => (ext.startsWith(".") ? ext : `.${ext}`))
      )
    : null;

  // Initialize the ignore chain with the root manager
  const ignoreChain = [{ manager: rootIgnoreManager, root: projectRoot }];

  // Statistics container
  const stats = { scanned: 0, ignored: 0 };

  // Perform Recursive Walk
  const includedFiles = walkDirectory(
    projectRoot,
    projectRoot,
    ignoreChain,
    allowedExtensions,
    absoluteOutputPath,
    !argv.noGitignore,
    stats
  );

  includedFiles.sort((a, b) => a.path.localeCompare(b.path));

  // Calculate total size of included files
  const totalSizeBytes = includedFiles.reduce(
    (acc, file) => acc + file.size,
    0
  );

  if (includedFiles.length === 0) {
    console.error(
      "\n❌ No files to include. Check your path, .gitignore, or filters."
    );
    process.exit(1);
  }

  if (argv.dryRun) {
    console.log("\n📋 Files to be included (Dry Run):\n");
    const tree = generateFileTree(includedFiles, projectRoot);
    console.log(tree);
    console.log("\n📊 Summary (Dry Run):");
    console.log(
      `   • Included: ${includedFiles.length} files (${formatBytes(
        totalSizeBytes
      )})`
    );
    console.log(`   • Ignored:  ${stats.ignored} files/dirs`);
    return;
  }

  const outputStream = fs.createWriteStream(argv.output);
  let totalLines = 0;

  if (!argv.noHeader) {
    const systemPrompt = argv.llmsTxt
      ? LLMS_TXT_SYSTEM_PROMPT
      : DEFAULT_SYSTEM_PROMPT;
    outputStream.write(systemPrompt + "\n");
    totalLines += systemPrompt.split("\n").length;

    outputStream.write("## Project File Tree\n\n");
    outputStream.write("```\n");
    const tree = generateFileTree(includedFiles, projectRoot);
    outputStream.write(tree);
    outputStream.write("```\n\n");
    outputStream.write("---\n\n");

    totalLines += tree.split("\n").length + 5;
  }

  for (const fileObj of includedFiles) {
    const relativePath = fileObj.relativePath.replace(/\\/g, "/");
    outputStream.write(`### **FILE:** \`${relativePath}\`\n`);
    outputStream.write("```\n");
    try {
      const content = fs.readFileSync(fileObj.path, "utf8");
      outputStream.write(content);
      totalLines += content.split("\n").length;
    } catch (e) {
      outputStream.write(`... (error reading file: ${e.message}) ...`);
    }
    outputStream.write("\n```\n\n");
    totalLines += 4; // Headers/footers lines
  }
  outputStream.end();

  console.log(`\n📊 Summary:`);
  console.log(
    `   • Included: ${includedFiles.length} files (${formatBytes(
      totalSizeBytes
    )})`
  );
  console.log(`   • Ignored:  ${stats.ignored} files/dirs`);
  console.log(`   • Output:   ${argv.output} (~${totalLines} lines)`);
  console.log(`\n✅ Done!`);
}

main().catch((err) => {
  console.error(`An unexpected error occurred: ${err.message}`);
  process.exit(1);
});
