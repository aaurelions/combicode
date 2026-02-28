const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const assert = require("assert");

const CLI_PATH = path.resolve(__dirname, "../index.js");
const TEST_DIR = path.resolve(__dirname, "temp_env");
const OUTPUT_FILE = path.join(TEST_DIR, "combicode.txt");

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

function teardown() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

function runTests() {
  console.log("🧪 Starting Node.js Integration Tests (v2.0.0)...\n");
  let passed = 0;
  let total = 0;

  function test(name, fn) {
    total++;
    try {
      teardown();
      fs.mkdirSync(TEST_DIR);
      fn();
      passed++;
      console.log(`   ✅ ${name}`);
    } catch (error) {
      console.error(`   ❌ ${name}`);
      console.error(`      ${error.message}`);
    }
  }

  // --- Test 1: Version ---
  test("Version output", () => {
    const out = execSync(`node ${CLI_PATH} --version`).toString();
    assert.match(out, /Combicode \(JavaScript\), version/);
  });

  // --- Test 2: Basic generation with code_index and merged_code ---
  test("Basic generation with <code_index> and <merged_code>", () => {
    createStructure(TEST_DIR, {
      "alpha.js": "console.log('alpha');",
      subdir: {
        "beta.txt": "Hello World",
      },
    });

    execSync(`node ${CLI_PATH} -o combicode.txt`, { cwd: TEST_DIR, stdio: "pipe" });
    assert.ok(fs.existsSync(OUTPUT_FILE));
    const content = fs.readFileSync(OUTPUT_FILE, "utf8");

    assert.ok(content.includes("<code_index>"), "Should contain <code_index>");
    assert.ok(content.includes("</code_index>"), "Should contain </code_index>");
    assert.ok(content.includes("<merged_code>"), "Should contain <merged_code>");
    assert.ok(content.includes("</merged_code>"), "Should contain </merged_code>");
    assert.ok(content.includes("# FILE: alpha.js"), "Should contain file header for alpha.js");
    assert.ok(content.includes("# FILE: subdir/beta.txt"), "Should contain file header for beta.txt");
    assert.ok(content.includes("console.log('alpha');"), "Should contain alpha.js content");
    assert.ok(content.includes("Hello World"), "Should contain beta.txt content");
  });

  // --- Test 3: OL/ML/SIZE in code_index ---
  test("OL/ML/SIZE references in code_index", () => {
    createStructure(TEST_DIR, {
      "main.py": "x = 1\ny = 2\nz = 3\n",
    });

    execSync(`node ${CLI_PATH} -o combicode.txt`, { cwd: TEST_DIR, stdio: "pipe" });
    const content = fs.readFileSync(OUTPUT_FILE, "utf8");

    // code_index should have OL, ML, SIZE references
    assert.match(content, /OL: 1-\d+/, "code_index should contain OL references");
    assert.match(content, /ML: \d+-\d+/, "code_index should contain ML references");
    assert.match(content, /\d+(\.\d+)?[BKMGT]/, "code_index should contain size references");
  });

  // --- Test 4: Code map with parsed Python elements ---
  test("Code map parses Python classes and functions", () => {
    createStructure(TEST_DIR, {
      "server.py": [
        "class Server:",
        "    def __init__(self, host: str, port: int):",
        "        self.host = host",
        "        self.port = port",
        "",
        "    def start(self):",
        "        print('starting')",
        "        print('started')",
        "",
        "def main():",
        "    s = Server('localhost', 8080)",
        "    s.start()",
        "",
      ].join("\n"),
    });

    execSync(`node ${CLI_PATH} -o combicode.txt`, { cwd: TEST_DIR, stdio: "pipe" });
    const content = fs.readFileSync(OUTPUT_FILE, "utf8");

    assert.ok(content.includes("class Server"), "Code map should include class Server");
    assert.ok(content.includes("ctor __init__"), "Code map should include ctor __init__");
    assert.ok(content.includes("fn start"), "Code map should include fn start");
    assert.ok(content.includes("fn main"), "Code map should include fn main");
  });

  // --- Test 5: Code map with parsed JS elements ---
  test("Code map parses JavaScript classes and functions", () => {
    createStructure(TEST_DIR, {
      "app.js": [
        "class App {",
        "  constructor(name) {",
        "    this.name = name;",
        "  }",
        "",
        "  async start() {",
        "    console.log('start');",
        "    return true;",
        "  }",
        "}",
        "",
        "function main() {",
        "  const app = new App('test');",
        "  app.start();",
        "}",
        "",
      ].join("\n"),
    });

    execSync(`node ${CLI_PATH} -o combicode.txt`, { cwd: TEST_DIR, stdio: "pipe" });
    const content = fs.readFileSync(OUTPUT_FILE, "utf8");

    assert.ok(content.includes("class App"), "Code map should include class App");
    assert.ok(content.includes("fn main"), "Code map should include fn main");
  });

  // --- Test 6: --no-parse flag ---
  test("--no-parse disables code structure parsing", () => {
    createStructure(TEST_DIR, {
      "server.py": [
        "class Server:",
        "    def start(self):",
        "        pass",
        "",
      ].join("\n"),
    });

    execSync(`node ${CLI_PATH} -o combicode.txt --no-parse`, { cwd: TEST_DIR, stdio: "pipe" });
    const content = fs.readFileSync(OUTPUT_FILE, "utf8");

    assert.ok(content.includes("<code_index>"), "Should still have code_index");
    assert.ok(content.includes("server.py"), "Should list the file");
    // With --no-parse, the code map should NOT contain class/fn elements inside files
    const codeIndex = content.split("<code_index>")[1].split("</code_index>")[0];
    assert.ok(!codeIndex.includes("class Server"), "No-parse should not show class Server in code_index");
    assert.ok(!codeIndex.includes("fn start"), "No-parse should not show fn start in code_index");
  });

  // --- Test 7: Dry run with code_index ---
  test("Dry run shows code_index-style output", () => {
    createStructure(TEST_DIR, {
      "main.py": "x = 1\n",
    });

    const out = execSync(`node ${CLI_PATH} --dry-run`, { cwd: TEST_DIR }).toString();

    assert.match(out, /Files to include/, "Dry run should show files header");
    assert.match(out, /Total files:/, "Should show total files");
    assert.match(out, /Total size:/, "Should show total size");
    assert.ok(out.includes("main.py"), "Should list main.py");
    assert.ok(out.includes("OL:"), "Should contain OL references");
    assert.ok(out.includes("ML:"), "Should contain ML references");
  });

  // --- Test 8: Nested .gitignore support ---
  test("Nested .gitignore support", () => {
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

    execSync(`node ${CLI_PATH} -o combicode.txt`, { cwd: TEST_DIR, stdio: "pipe" });
    const content = fs.readFileSync(OUTPUT_FILE, "utf8");

    assert.ok(content.includes("# FILE: root.js"), "root.js should be included");
    assert.ok(content.includes("# FILE: nested/child.js"), "child.js should be included");
    assert.ok(content.includes("# FILE: nested/deep/deep.js"), "deep.js should be included");
    assert.ok(!content.includes("# FILE: ignore_me_root.log"), "*.log should be excluded");
    assert.ok(!content.includes("# FILE: nested/ignore_me_child.tmp"), "*.tmp should be excluded");
    assert.ok(!content.includes("# FILE: nested/deep/ignore_local.txt"), "ignore_local.txt should be excluded");
  });

  // --- Test 9: CLI exclude override ---
  test("CLI --exclude flag", () => {
    createStructure(TEST_DIR, {
      "keep.js": "keep",
      "skip.js": "skip",
    });

    execSync(`node ${CLI_PATH} -o combicode.txt -e "skip.js"`, { cwd: TEST_DIR, stdio: "pipe" });
    const content = fs.readFileSync(OUTPUT_FILE, "utf8");

    assert.ok(content.includes("# FILE: keep.js"), "keep.js should be included");
    assert.ok(!content.includes("# FILE: skip.js"), "skip.js should be excluded");
  });

  // --- Test 10: Output file self-exclusion ---
  test("Output file self-exclusion", () => {
    createStructure(TEST_DIR, {
      "alpha.js": "alpha",
    });

    execSync(`node ${CLI_PATH} -o combicode.txt`, { cwd: TEST_DIR, stdio: "pipe" });
    const content = fs.readFileSync(OUTPUT_FILE, "utf8");
    assert.ok(!content.includes("# FILE: combicode.txt"), "Output file should not include itself");
  });

  // --- Test 11: Skip content feature ---
  test("Skip content feature", () => {
    createStructure(TEST_DIR, {
      "main.js": "console.log('main');",
      "large.test.ts": 'const data = "' + "x".repeat(1000) + '";',
      subdir: {
        "spec.ts": "describe('spec', () => {});",
        "utils.js": "export function util() {}",
      },
    });

    execSync(`node ${CLI_PATH} -o combicode.txt --skip-content "**/*test.ts,**/*spec.ts"`, {
      cwd: TEST_DIR,
      stdio: "pipe",
    });
    const content = fs.readFileSync(OUTPUT_FILE, "utf8");

    assert.ok(content.includes("Content omitted"), "Should have content omitted marker");
    assert.ok(content.includes("console.log('main');"), "main.js should have full content");
    assert.ok(content.includes("export function util() {}"), "utils.js should have full content");
  });

  // --- Test 12: Updated system prompt ---
  test("Updated v2.0.0 system prompt", () => {
    createStructure(TEST_DIR, {
      "main.js": "x = 1",
    });

    execSync(`node ${CLI_PATH} -o combicode.txt`, { cwd: TEST_DIR, stdio: "pipe" });
    const content = fs.readFileSync(OUTPUT_FILE, "utf8");

    assert.ok(content.includes("code map"), "System prompt should mention code map");
    assert.ok(content.includes("OL = Original Line"), "System prompt should explain OL");
    assert.ok(content.includes("ML = Merged Line"), "System prompt should explain ML");
  });

  // --- Test 13: llms-txt system prompt ---
  test("llms-txt system prompt", () => {
    createStructure(TEST_DIR, {
      "docs.md": "# Hello",
    });

    execSync(`node ${CLI_PATH} -o combicode.txt -l`, { cwd: TEST_DIR, stdio: "pipe" });
    const content = fs.readFileSync(OUTPUT_FILE, "utf8");

    assert.ok(content.includes("definitive source of truth"), "Should use llms-txt prompt");
    assert.ok(!content.includes("OL = Original Line"), "Should NOT use default prompt");
  });

  // --- Test 14: File header format with OL/ML/SIZE ---
  test("File headers have OL/ML/SIZE in merged_code", () => {
    createStructure(TEST_DIR, {
      "hello.py": "print('hello')\n",
    });

    execSync(`node ${CLI_PATH} -o combicode.txt`, { cwd: TEST_DIR, stdio: "pipe" });
    const content = fs.readFileSync(OUTPUT_FILE, "utf8");

    // Use regex on full content since <merged_code> appears in system prompt text too
    assert.match(content, /# FILE: hello\.py \[OL: 1-\d+ \| ML: \d+-\d+ \| \d+(\.\d+)?[BKMGT]?B?\]/, "File header should have OL/ML/SIZE");
  });

  // --- Test 15: Recreate from combicode.txt ---
  test("Recreate from combicode.txt", () => {
    // First, generate a combicode.txt
    createStructure(TEST_DIR, {
      "src": {
        "index.js": "console.log('hello');",
        "utils.js": "function add(a, b) { return a + b; }",
      },
      "config.json": '{"key": "value"}',
    });

    execSync(`node ${CLI_PATH} -o combicode.txt`, { cwd: TEST_DIR, stdio: "pipe" });
    assert.ok(fs.existsSync(OUTPUT_FILE));

    // Now recreate in a new directory
    const recreateDir = path.join(TEST_DIR, "recreated");
    fs.mkdirSync(recreateDir);

    execSync(`node ${CLI_PATH} --recreate --input combicode.txt -o ${recreateDir}`, {
      cwd: TEST_DIR,
      stdio: "pipe",
    });

    // Check files were recreated
    assert.ok(
      fs.existsSync(path.join(recreateDir, "src/index.js")),
      "src/index.js should be recreated"
    );
    assert.ok(
      fs.existsSync(path.join(recreateDir, "src/utils.js")),
      "src/utils.js should be recreated"
    );
    assert.ok(
      fs.existsSync(path.join(recreateDir, "config.json")),
      "config.json should be recreated"
    );

    // Check content
    const indexContent = fs.readFileSync(path.join(recreateDir, "src/index.js"), "utf8");
    assert.ok(indexContent.includes("console.log('hello');"), "Recreated index.js should have correct content");
  });

  // --- Test 16: Recreate dry run ---
  test("Recreate dry run", () => {
    createStructure(TEST_DIR, {
      "main.js": "console.log('hello');",
    });

    execSync(`node ${CLI_PATH} -o combicode.txt`, { cwd: TEST_DIR, stdio: "pipe" });

    const out = execSync(`node ${CLI_PATH} --recreate --input combicode.txt --dry-run`, {
      cwd: TEST_DIR,
    }).toString();

    assert.match(out, /Files to recreate/, "Should show 'Files to recreate'");
    assert.ok(out.includes("main.js"), "Should list main.js");
  });

  // --- Test 17: Recreate with --overwrite ---
  test("Recreate with --overwrite", () => {
    createStructure(TEST_DIR, {
      "main.js": "console.log('hello');",
    });

    execSync(`node ${CLI_PATH} -o combicode.txt`, { cwd: TEST_DIR, stdio: "pipe" });

    // Create existing file with different content
    const recreateDir = path.join(TEST_DIR, "out");
    fs.mkdirSync(recreateDir);
    fs.mkdirSync(path.join(recreateDir, ""), { recursive: true });
    fs.writeFileSync(path.join(recreateDir, "main.js"), "OLD CONTENT");

    // Without overwrite - should skip
    execSync(`node ${CLI_PATH} --recreate --input combicode.txt -o ${recreateDir}`, {
      cwd: TEST_DIR,
      stdio: "pipe",
    });
    let existingContent = fs.readFileSync(path.join(recreateDir, "main.js"), "utf8");
    assert.ok(existingContent.includes("OLD CONTENT"), "Without --overwrite, file should keep old content");

    // With overwrite
    execSync(`node ${CLI_PATH} --recreate --input combicode.txt -o ${recreateDir} --overwrite`, {
      cwd: TEST_DIR,
      stdio: "pipe",
    });
    existingContent = fs.readFileSync(path.join(recreateDir, "main.js"), "utf8");
    assert.ok(existingContent.includes("console.log('hello');"), "With --overwrite, file should be updated");
  });

  // --- Test 18: --no-header flag ---
  test("--no-header omits system prompt and code_index", () => {
    createStructure(TEST_DIR, {
      "main.js": "x = 1",
    });

    execSync(`node ${CLI_PATH} -o combicode.txt --no-header`, { cwd: TEST_DIR, stdio: "pipe" });
    const content = fs.readFileSync(OUTPUT_FILE, "utf8");

    assert.ok(!content.includes("<code_index>"), "Should NOT contain <code_index>");
    assert.ok(!content.includes("expert software architect"), "Should NOT contain system prompt");
    assert.ok(content.includes("<merged_code>"), "Should still have <merged_code>");
    assert.ok(content.includes("# FILE: main.js"), "Should still contain file content");
  });

  // --- Test 19: Include ext filter ---
  test("Include extension filter", () => {
    createStructure(TEST_DIR, {
      "main.py": "print('hello')",
      "style.css": "body { }",
      "readme.md": "# Hello",
    });

    execSync(`node ${CLI_PATH} -o combicode.txt -i .py`, { cwd: TEST_DIR, stdio: "pipe" });
    const content = fs.readFileSync(OUTPUT_FILE, "utf8");

    assert.ok(content.includes("# FILE: main.py"), "main.py should be included");
    assert.ok(!content.includes("# FILE: style.css"), "style.css should be excluded");
    assert.ok(!content.includes("# FILE: readme.md"), "readme.md should be excluded");
  });

  // --- Test 20: TypeScript interface parsing ---
  test("Code map parses TypeScript interfaces", () => {
    createStructure(TEST_DIR, {
      "types.ts": [
        "export interface Config {",
        "  host: string;",
        "  port: number;",
        "  debug: boolean;",
        "}",
        "",
        "export class Server {",
        "  constructor(config: Config) {",
        "    this.config = config;",
        "  }",
        "}",
        "",
      ].join("\n"),
    });

    execSync(`node ${CLI_PATH} -o combicode.txt`, { cwd: TEST_DIR, stdio: "pipe" });
    const content = fs.readFileSync(OUTPUT_FILE, "utf8");

    assert.ok(content.includes("interface Config"), "Code map should include interface Config");
    assert.ok(content.includes("class Server"), "Code map should include class Server");
  });

  // --- Test 21: ML line numbers accuracy ---
  test("ML line numbers point to actual content lines", () => {
    createStructure(TEST_DIR, {
      "first.py": "print('first')\nprint('second')\nprint('third')\n",
      "second.js": "const a = 1;\nconst b = 2;\n",
      subdir: {
        "third.txt": "hello\nworld\n",
      },
    });

    execSync(`node ${CLI_PATH} -o combicode.txt`, { cwd: TEST_DIR, stdio: "pipe" });
    const content = fs.readFileSync(OUTPUT_FILE, "utf8");
    const outputLines = content.split("\n");

    // Parse all file headers and verify ML ranges
    const fileHeaderRegex = /# FILE:\s*(\S+)\s*\[OL: (\d+)-(\d+) \| ML: (\d+)-(\d+) \|/g;
    let match;
    let verified = 0;

    while ((match = fileHeaderRegex.exec(content)) !== null) {
      const fileName = match[1];
      const mlStart = parseInt(match[4], 10);
      const mlEnd = parseInt(match[5], 10);

      // ML lines are 1-indexed, array is 0-indexed
      const firstContentLine = outputLines[mlStart - 1];
      const lastContentLine = outputLines[mlEnd - 1];

      // Verify the line BEFORE mlStart is the opening backticks
      const lineBeforeMl = outputLines[mlStart - 2];
      assert.strictEqual(
        lineBeforeMl, "````",
        `Line before ML start for ${fileName} should be opening backticks, got: "${lineBeforeMl}" (line ${mlStart - 1})`
      );

      // Verify the line AFTER mlEnd is the closing backticks
      const lineAfterMl = outputLines[mlEnd];
      assert.strictEqual(
        lineAfterMl, "````",
        `Line after ML end for ${fileName} should be closing backticks, got: "${lineAfterMl}" (line ${mlEnd + 1})`
      );

      // Verify content is NOT backticks (i.e., we're inside the content block)
      assert.notStrictEqual(
        firstContentLine, "````",
        `ML start for ${fileName} should point to content, not backticks`
      );

      verified++;
    }

    assert.ok(verified >= 3, `Should have verified at least 3 files, got ${verified}`);
  });

  // --- Test 22: ML accuracy with multiple files of varying sizes ---
  test("ML accuracy across many files with different line counts", () => {
    const files = {};
    // Create files with varying numbers of lines (1 line to 20 lines)
    for (let i = 1; i <= 5; i++) {
      const lines = [];
      for (let j = 1; j <= i * 4; j++) {
        lines.push(`line_${j}_of_file_${i}`);
      }
      files[`file${i}.py`] = lines.join("\n") + "\n";
    }
    createStructure(TEST_DIR, files);

    execSync(`node ${CLI_PATH} -o combicode.txt --no-parse`, { cwd: TEST_DIR, stdio: "pipe" });
    const content = fs.readFileSync(OUTPUT_FILE, "utf8");
    const outputLines = content.split("\n");

    const fileHeaderRegex = /# FILE:\s*(\S+)\s*\[OL: (\d+)-(\d+) \| ML: (\d+)-(\d+) \|/g;
    let match;

    while ((match = fileHeaderRegex.exec(content)) !== null) {
      const fileName = match[1];
      const olStart = parseInt(match[2], 10);
      const olEnd = parseInt(match[3], 10);
      const mlStart = parseInt(match[4], 10);
      const mlEnd = parseInt(match[5], 10);

      // Verify OL range matches content line count
      const expectedLineCount = olEnd - olStart + 1;
      const mlLineCount = mlEnd - mlStart + 1;
      assert.strictEqual(
        mlLineCount, expectedLineCount,
        `${fileName}: ML range (${mlLineCount} lines) should match OL range (${expectedLineCount} lines)`
      );

      // Verify first content line matches
      const firstLine = outputLines[mlStart - 1];
      assert.ok(
        firstLine && firstLine.startsWith("line_1_of_"),
        `${fileName}: ML ${mlStart} should point to first line of content, got: "${firstLine}"`
      );

      // Verify last content line matches
      const lastLine = outputLines[mlEnd - 1];
      assert.ok(
        lastLine && lastLine.startsWith(`line_${expectedLineCount}_of_`),
        `${fileName}: ML ${mlEnd} should point to last line of content, got: "${lastLine}"`
      );
    }
  });

  // --- Done ---
  console.log(`\n📊 Results: ${passed}/${total} tests passed`);
  if (passed < total) {
    process.exit(1);
  }
  console.log("✅ All Node.js tests passed!");

  teardown();
}

runTests();
