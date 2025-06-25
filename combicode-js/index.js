#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const yargs = require("yargs/yargs");
const { hideBin } = require("yargs/helpers");
const glob = require("fast-glob");

const { version } = require("./package.json");

const DEFAULT_IGNORE_PATTERNS = [
  "**/node_modules/**",
  "**/.git/**",
  "**/.vscode/**",
  "**/.idea/**",
  "**/*.log",
  "**/.env",
  "**/*.lock",
  "**/.venv/**",
  "**/venv/**",
  "**/env/**",
  "**/__pycache__/**",
  "**/*.pyc",
  "**/*.egg-info/**",
  "**/build/**",
  "**/dist/**",
  "**/.pytest_cache/**",
  "**/.npm/**",
  "**/pnpm-lock.yaml",
  "**/package-lock.json",
  "**/.next/**",
  "**/.DS_Store",
  "**/Thumbs.db",
  // Common binary file extensions
  "**/*.png",
  "**/*.jpg",
  "**/*.jpeg",
  "**/*.gif",
  "**/*.ico",
  "**/*.svg",
  "**/*.webp",
  "**/*.mp3",
  "**/*.wav",
  "**/*.flac",
  "**/*.mp4",
  "**/*.mov",
  "**/*.avi",
  "**/*.zip",
  "**/*.tar.gz",
  "**/*.rar",
  "**/*.pdf",
  "**/*.doc",
  "**/*.docx",
  "**/*.xls",
  "**/*.xlsx",
  "**/*.dll",
  "**/*.exe",
  "**/*.so",
  "**/*.a",
  "**/*.lib",
  "**/*.o",
  "**/*.bin",
  "**/*.iso",
];

function isLikelyBinary(file) {
  const buffer = Buffer.alloc(512);
  let fd;
  try {
    fd = fs.openSync(file, "r");
    const bytesRead = fs.readSync(fd, buffer, 0, 512, 0);
    // Check for null bytes, a strong indicator of a binary file
    return buffer.slice(0, bytesRead).includes(0);
  } catch (e) {
    // If we can't read it, treat it as something to skip
    return true;
  } finally {
    if (fd) fs.closeSync(fd);
  }
}

async function main() {
  const argv = yargs(hideBin(process.argv))
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
    .version(version) // Read version from package.json
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
      if (fs.statSync(file).isDirectory()) return false;
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

  if (argv.dryRun) {
    console.log("\n📋 Files to be included (Dry Run):");
    includedFiles.forEach((file) =>
      console.log(`  - ${path.relative(projectRoot, file)}`)
    );
    console.log(`\nTotal: ${includedFiles.length} files.`);
    return;
  }

  const outputStream = fs.createWriteStream(argv.output);
  for (const file of includedFiles) {
    const relativePath = path.relative(projectRoot, file).replace(/\\/g, "/");
    outputStream.write(`// FILE: ${relativePath}` + "\n");
    outputStream.write("```\n");
    const content = fs.readFileSync(file, "utf8");
    outputStream.write(content);
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
