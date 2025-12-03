const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const assert = require("assert");

const CLI_PATH = path.resolve(__dirname, "../index.js");
const TEST_DIR = path.resolve(__dirname, "temp_env");
const OUTPUT_FILE = path.join(TEST_DIR, "combicode.txt");

// Helper to create directory structure
function createStructure(base, structure) {
  Object.entries(structure).forEach(([name, content]) => {
    const fullPath = path.join(base, name);
    if (typeof content === "object") {
      fs.mkdirSync(fullPath);
      createStructure(fullPath, content);
    } else {
      fs.writeFileSync(fullPath, content);
    }
  });
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
    // Clean start
    teardown();
    fs.mkdirSync(TEST_DIR);

    // --- Scenario 1: Basic Functionality ---
    console.log("   [1/4] Checking Basic Functionality & Version...");
    const versionOutput = execSync(`node ${CLI_PATH} --version`).toString();
    assert.match(versionOutput, /Combicode \(JavaScript\), version/);

    createStructure(TEST_DIR, {
      "alpha.js": "console.log('alpha');",
      subdir: {
        "beta.txt": "Hello World",
      },
    });

    // Capture dry-run output to verify structure
    const dryRunOutput = execSync(`node ${CLI_PATH} --dry-run`, {
      cwd: TEST_DIR,
    }).toString();
    assert.match(dryRunOutput, /Files to be included \(Dry Run\)/);
    assert.match(dryRunOutput, /\[\d+(\.\d+)?[KM]?B\]/); // Size check

    // Run generation
    execSync(`node ${CLI_PATH} --output combicode.txt`, {
      cwd: TEST_DIR,
      stdio: "inherit",
    });

    assert.ok(fs.existsSync(OUTPUT_FILE), "Output file should exist");
    let content = fs.readFileSync(OUTPUT_FILE, "utf8");
    assert.ok(content.includes("### **FILE:** `alpha.js`"));
    assert.ok(content.includes("### **FILE:** `subdir/beta.txt`"));

    // --- Scenario 2: Nested .gitignore Support ---
    console.log("   [2/4] Checking Nested .gitignore Support...");
    teardown();
    fs.mkdirSync(TEST_DIR);

    createStructure(TEST_DIR, {
      "root.js": "root",
      "ignore_me_root.log": "log",
      ".gitignore": "*.log",
      nested: {
        "child.js": "child",
        "ignore_me_child.tmp": "tmp",
        ".gitignore": "*.tmp",
        deep: {
          "deep.js": "deep",
          "ignore_local.txt": "txt",
          ".gitignore": "ignore_local.txt",
        },
      },
    });

    execSync(`node ${CLI_PATH} -o combicode.txt`, {
      cwd: TEST_DIR,
      stdio: "inherit",
    });
    content = fs.readFileSync(OUTPUT_FILE, "utf8");

    // Should include:
    assert.ok(content.includes("### **FILE:** `root.js`"), "root.js missing");
    assert.ok(
      content.includes("### **FILE:** `nested/child.js`"),
      "child.js missing"
    );
    assert.ok(
      content.includes("### **FILE:** `nested/deep/deep.js`"),
      "deep.js missing"
    );

    // Should exclude (Checking Headers, not content):
    assert.ok(
      !content.includes("### **FILE:** `ignore_me_root.log`"),
      "Root gitignore failed (*.log)"
    );
    assert.ok(
      !content.includes("### **FILE:** `nested/ignore_me_child.tmp`"),
      "Nested gitignore failed (*.tmp)"
    );
    assert.ok(
      !content.includes("### **FILE:** `nested/deep/ignore_local.txt`"),
      "Deep nested gitignore failed (specific file)"
    );

    // --- Scenario 3: CLI Exclude Override ---
    console.log("   [3/4] Checking CLI Exclude Flags...");
    execSync(`node ${CLI_PATH} -o combicode.txt -e "**/deep.js"`, {
      cwd: TEST_DIR,
      stdio: "inherit",
    });
    content = fs.readFileSync(OUTPUT_FILE, "utf8");
    assert.ok(
      !content.includes("### **FILE:** `nested/deep/deep.js`"),
      "CLI exclude flag failed"
    );

    // --- Scenario 4: Output File Self-Exclusion ---
    console.log("   [4/4] Checking Output File Self-Exclusion...");
    execSync(`node ${CLI_PATH} -o combicode.txt`, {
      cwd: TEST_DIR,
      stdio: "inherit",
    });
    content = fs.readFileSync(OUTPUT_FILE, "utf8");
    assert.ok(
      !content.includes("### **FILE:** `combicode.txt`"),
      "Output file included itself"
    );

    console.log("✅ All Node.js tests passed!");
  } catch (error) {
    console.error("❌ Test Failed:", error.message);
    process.exit(1);
  } finally {
    teardown();
  }
}

runTest();
