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

    // --- Scenario 5: Skip Content Feature ---
    console.log("   [5/5] Checking Skip Content Feature...");
    teardown();
    fs.mkdirSync(TEST_DIR);

    createStructure(TEST_DIR, {
      "main.js": "console.log('main');",
      "test.js": "describe('test', () => { it('works', () => {}); });",
      "large.test.ts": "const data = " + '"x'.repeat(1000) + '";',
      subdir: {
        "spec.ts": "describe('spec', () => {});",
        "utils.js": "export function util() {}",
      },
    });

    execSync(`node ${CLI_PATH} -o combicode.txt --skip-content "**/*test.ts,**/*spec.ts"`, {
      cwd: TEST_DIR,
      stdio: "inherit",
    });
    content = fs.readFileSync(OUTPUT_FILE, "utf8");

    // Files should appear in tree with (content omitted) marker
    assert.ok(
      content.includes("large.test.ts (content omitted)"),
      "Tree should show (content omitted) marker for large.test.ts"
    );
    // Check for spec.ts - it might be in subdir/spec.ts path
    assert.ok(
      content.includes("spec.ts (content omitted)") || content.includes("subdir/spec.ts (content omitted)"),
      "Tree should show (content omitted) marker for spec.ts"
    );

    // Files should have FILE headers
    assert.ok(content.includes("### **FILE:** `large.test.ts`"), "File header should exist");
    assert.ok(content.includes("### **FILE:** `subdir/spec.ts`"), "File header should exist");

    // Content should be omitted (placeholder instead)
    const largeTestMatch = content.match(/### \*\*FILE:\*\* `large\.test\.ts`[\s\S]*?```([\s\S]*?)```/);
    assert.ok(largeTestMatch, "Should find large.test.ts content section");
    assert.ok(
      largeTestMatch[1].includes("Content omitted"),
      "Content should be replaced with placeholder"
    );
    assert.ok(
      largeTestMatch[1].includes("file size:"),
      "Placeholder should include file size"
    );

    // Regular files should have full content
    assert.ok(content.includes("console.log('main');"), "main.js should have full content");
    assert.ok(content.includes("export function util() {}"), "utils.js should have full content");

    // Dry run should show content omitted count
    const skipContentDryRunOutput = execSync(`node ${CLI_PATH} --dry-run --skip-content "**/*.test.ts"`, {
      cwd: TEST_DIR,
    }).toString();
    assert.match(skipContentDryRunOutput, /Content omitted:/, "Dry run should show content omitted count");

    console.log("✅ All Node.js tests passed!");
  } catch (error) {
    console.error("❌ Test Failed:", error.message);
    process.exit(1);
  } finally {
    teardown();
  }
}

runTest();
