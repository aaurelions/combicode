#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const yargs = require("yargs/yargs");
const { hideBin } = require("yargs/helpers");
const glob = require("fast-glob");

const { version } = require("./package.json");

const SYSTEM_PROMPT = `You are an expert software architect. The user is providing you with the complete source code for a project, contained in a single file. Your task is to meticulously analyze the provided codebase to gain a comprehensive understanding of its structure, functionality, dependencies, and overall architecture.

A file tree is provided below to give you a high-level overview. The subsequent sections contain the full content of each file, clearly marked with "// FILE: <path>".

Your instructions are:
1.  **Analyze Thoroughly:** Read through every file to understand its purpose and how it interacts with other files.
2.  **Identify Key Components:** Pay close attention to configuration files (like package.json, pyproject.toml), entry points (like index.js, main.py), and core logic.
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

function generateFileTree(files, root) {
  let tree = `${path.basename(root)}/\n`;
  const structure = {};

  files.forEach((file) => {
    const parts = file.split(path.sep);
    let currentLevel = structure;
    parts.forEach((part) => {
      if (!currentLevel[part]) {
        currentLevel[part] = {};
      }
      currentLevel = currentLevel[part];
    });
  });

  const buildTree = (level, prefix) => {
    const entries = Object.keys(level);
    entries.forEach((entry, index) => {
      const isLast = index === entries.length - 1;
      tree += `${prefix}${isLast ? "└── " : "├── "}${entry}\n`;
      if (Object.keys(level[entry]).length > 0) {
        buildTree(level[entry], `${prefix}${isLast ? "    " : "│   "}`);
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
    stats: false,
  });

  const allowedExtensions = argv.includeExt
    ? new Set(
        argv.includeExt
          .split(",")
          .map((ext) => (ext.startsWith(".") ? ext : `.${ext}`))
      )
    : null;

  const includedFiles = allFiles
    .filter((file) => {
      const stats = fs.statSync(file, { throwIfNoEntry: false });
      if (!stats || stats.isDirectory()) return false;
      if (isLikelyBinary(file)) return false;
      if (allowedExtensions && !allowedExtensions.has(path.extname(file)))
        return false;
      return true;
    })
    .sort();

  if (includedFiles.length === 0) {
    console.error("❌ No files to include. Check your path or filters.");
    process.exit(1);
  }

  const relativeFiles = includedFiles.map((file) =>
    path.relative(projectRoot, file)
  );

  if (argv.dryRun) {
    console.log("\n📋 Files to be included (Dry Run):\n");
    const tree = generateFileTree(relativeFiles, projectRoot);
    console.log(tree);
    console.log(`\nTotal: ${includedFiles.length} files.`);
    return;
  }

  const outputStream = fs.createWriteStream(argv.output);

  if (!argv.noHeader) {
    outputStream.write(SYSTEM_PROMPT + "\n");
    outputStream.write("## Project File Tree\n\n");
    outputStream.write("```\n");
    const tree = generateFileTree(relativeFiles, projectRoot);
    outputStream.write(tree);
    outputStream.write("```\n\n");
    outputStream.write("---\n\n");
  }

  for (const file of includedFiles) {
    const relativePath = path.relative(projectRoot, file).replace(/\\/g, "/");
    outputStream.write(`// FILE: ${relativePath}` + "\n");
    outputStream.write("```\n");
    try {
      const content = fs.readFileSync(file, "utf8");
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
