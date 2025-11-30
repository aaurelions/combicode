const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const assert = require("assert");

const CLI_PATH = path.resolve(__dirname, "../index.js");
const TEST_DIR = path.resolve(__dirname, "temp_env");
const OUTPUT_FILE = path.join(TEST_DIR, "combicode.txt");

// Setup: Create a temp directory with dummy files
function setup() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_DIR);

  // Create a dummy JS file
  fs.writeFileSync(path.join(TEST_DIR, "alpha.js"), "console.log('alpha');");

  // Create a dummy text file in a subdir
  const subDir = path.join(TEST_DIR, "subdir");
  fs.mkdirSync(subDir);
  fs.writeFileSync(path.join(subDir, "beta.txt"), "Hello World");
}

// Teardown: Cleanup temp directory
function teardown() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

function runTest() {
  console.log("🧪 Starting Node.js Integration Tests...");

  try {
    setup();

    // 1. Test Version Flag
    console.log("   Checking --version...");
    const versionOutput = execSync(`node ${CLI_PATH} --version`).toString();
    assert.match(versionOutput, /Combicode \(JavaScript\), version/);

    // 2. Test Dry Run
    console.log("   Checking --dry-run...");
    const dryRunOutput = execSync(`node ${CLI_PATH} --dry-run`, {
      cwd: TEST_DIR,
    }).toString();
    assert.match(dryRunOutput, /Files to be included \(Dry Run\)/);
    // Check for file size format in tree (e.g., [21B])
    assert.match(dryRunOutput, /\[\d+(\.\d+)?[KM]?B\]/);

    // 3. Test Actual Generation
    console.log("   Checking file generation...");
    execSync(`node ${CLI_PATH} --output combicode.txt`, { cwd: TEST_DIR });

    assert.ok(fs.existsSync(OUTPUT_FILE), "Output file should exist");

    const content = fs.readFileSync(OUTPUT_FILE, "utf8");

    // Check for System Prompt
    assert.ok(
      content.includes("You are an expert software architect"),
      "System prompt missing"
    );

    // Check for Tree structure
    assert.ok(content.includes("subdir"), "Tree should show subdirectory");

    // Check for new Header format
    assert.ok(
      content.includes("### **FILE:** `alpha.js`"),
      "New header format missing for alpha.js"
    );
    assert.ok(
      content.includes("### **FILE:** `subdir/beta.txt`"),
      "New header format missing for beta.txt"
    );

    console.log("✅ All Node.js tests passed!");
  } catch (error) {
    console.error("❌ Test Failed:", error.message);
    if (error.stdout) console.log(error.stdout.toString());
    process.exit(1);
  } finally {
    teardown();
  }
}

runTest();
