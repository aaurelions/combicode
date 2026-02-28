import os
import re
from pathlib import Path
from click.testing import CliRunner
from combicode.main import cli, format_bytes


def test_format_bytes():
    assert format_bytes(100) == "100.0B"
    assert format_bytes(1024) == "1.0KB"
    assert format_bytes(0) == "0B"


def test_version():
    runner = CliRunner()
    result = runner.invoke(cli, ["--version"])
    assert result.exit_code == 0
    assert "Combicode (Python), version" in result.output


def test_basic_generation_with_xml_tags():
    """Output should contain <code_index> and <merged_code> XML tags."""
    runner = CliRunner()
    with runner.isolated_filesystem():
        Path("alpha.py").write_text("print('alpha')", encoding='utf-8')
        Path("sub").mkdir()
        Path("sub/beta.txt").write_text("beta content", encoding='utf-8')

        result = runner.invoke(cli, ["--output", "output.txt"])
        assert result.exit_code == 0

        content = Path("output.txt").read_text(encoding="utf-8")
        assert "<code_index>" in content
        assert "</code_index>" in content
        assert "<merged_code>" in content
        assert "</merged_code>" in content
        assert "# FILE: alpha.py" in content
        assert "# FILE: sub/beta.txt" in content
        assert "print('alpha')" in content
        assert "beta content" in content


def test_ol_ml_size_in_code_index():
    """Code index should contain OL, ML, and SIZE references."""
    runner = CliRunner()
    with runner.isolated_filesystem():
        Path("main.py").write_text("x = 1\ny = 2\nz = 3\n", encoding='utf-8')

        result = runner.invoke(cli, ["-o", "out.txt"])
        assert result.exit_code == 0

        content = Path("out.txt").read_text(encoding="utf-8")
        assert re.search(r'OL: 1-\d+', content), "Should contain OL references"
        assert re.search(r'ML: \d+-\d+', content), "Should contain ML references"
        assert re.search(r'\d+(\.\d+)?[BKMGT]', content), "Should contain size references"


def test_code_map_python_classes_and_functions():
    """Code map should parse Python classes, constructors, and functions."""
    runner = CliRunner()
    with runner.isolated_filesystem():
        Path("server.py").write_text(
            "class Server:\n"
            "    def __init__(self, host: str, port: int):\n"
            "        self.host = host\n"
            "        self.port = port\n"
            "\n"
            "    def start(self):\n"
            "        print('starting')\n"
            "        print('started')\n"
            "\n"
            "def main():\n"
            "    s = Server('localhost', 8080)\n"
            "    s.start()\n",
            encoding='utf-8'
        )

        result = runner.invoke(cli, ["-o", "out.txt"])
        assert result.exit_code == 0

        content = Path("out.txt").read_text(encoding="utf-8")
        assert "class Server" in content, "Should include class Server"
        assert "ctor __init__" in content, "Should include ctor __init__"
        assert "fn start" in content, "Should include fn start"
        assert "fn main" in content, "Should include fn main"


def test_code_map_javascript_classes():
    """Code map should parse JavaScript classes and functions."""
    runner = CliRunner()
    with runner.isolated_filesystem():
        Path("app.js").write_text(
            "class App {\n"
            "  constructor(name) {\n"
            "    this.name = name;\n"
            "  }\n"
            "\n"
            "  async start() {\n"
            "    console.log('start');\n"
            "    return true;\n"
            "  }\n"
            "}\n"
            "\n"
            "function main() {\n"
            "  const app = new App('test');\n"
            "  app.start();\n"
            "}\n",
            encoding='utf-8'
        )

        result = runner.invoke(cli, ["-o", "out.txt"])
        assert result.exit_code == 0

        content = Path("out.txt").read_text(encoding="utf-8")
        assert "class App" in content, "Should include class App"
        assert "fn main" in content, "Should include fn main"


def test_no_parse_flag():
    """--no-parse should disable code structure parsing."""
    runner = CliRunner()
    with runner.isolated_filesystem():
        Path("server.py").write_text(
            "class Server:\n"
            "    def start(self):\n"
            "        pass\n",
            encoding='utf-8'
        )

        result = runner.invoke(cli, ["-o", "out.txt", "--no-parse"])
        assert result.exit_code == 0

        content = Path("out.txt").read_text(encoding="utf-8")
        assert "<code_index>" in content, "Should still have code_index"
        assert "server.py" in content, "Should list the file"

        code_index = content.split("<code_index>")[1].split("</code_index>")[0]
        assert "class Server" not in code_index, "No-parse should not show class Server"
        assert "fn start" not in code_index, "No-parse should not show fn start"


def test_dry_run_with_code_index():
    """Dry run should show code_index-style output with OL/ML."""
    runner = CliRunner()
    with runner.isolated_filesystem():
        Path("main.py").write_text("x = 1\n", encoding='utf-8')

        result = runner.invoke(cli, ["--dry-run"])
        assert result.exit_code == 0
        assert "Files to include" in result.output
        assert "Total files:" in result.output
        assert "Total size:" in result.output
        assert "main.py" in result.output
        assert "OL:" in result.output
        assert "ML:" in result.output


def test_deep_nested_gitignore():
    """Test .gitignore works at root, nested, and deep levels."""
    runner = CliRunner()
    with runner.isolated_filesystem():
        Path(".gitignore").write_text("*.log", encoding='utf-8')
        Path("root.js").write_text("root", encoding='utf-8')
        Path("ignore_root.log").write_text("log", encoding='utf-8')

        Path("nested").mkdir()
        Path("nested/.gitignore").write_text("*.tmp", encoding='utf-8')
        Path("nested/child.js").write_text("child", encoding='utf-8')
        Path("nested/ignore_child.tmp").write_text("tmp", encoding='utf-8')

        Path("nested/deep").mkdir()
        Path("nested/deep/.gitignore").write_text("ignore_local.txt", encoding='utf-8')
        Path("nested/deep/deep.js").write_text("deep", encoding='utf-8')
        Path("nested/deep/ignore_local.txt").write_text("txt", encoding='utf-8')

        result = runner.invoke(cli, ["--output", "combicode.txt"])
        assert result.exit_code == 0

        content = Path("combicode.txt").read_text(encoding="utf-8")
        assert "# FILE: root.js" in content
        assert "# FILE: nested/child.js" in content
        assert "# FILE: nested/deep/deep.js" in content
        assert "# FILE: ignore_root.log" not in content
        assert "# FILE: nested/ignore_child.tmp" not in content
        assert "# FILE: nested/deep/ignore_local.txt" not in content


def test_cli_exclude_override():
    runner = CliRunner()
    with runner.isolated_filesystem():
        Path("keep.py").write_text("keep", encoding='utf-8')
        Path("skip.py").write_text("skip", encoding='utf-8')

        result = runner.invoke(cli, ["-o", "out.txt", "-e", "skip.py"])
        assert result.exit_code == 0

        content = Path("out.txt").read_text(encoding="utf-8")
        assert "# FILE: keep.py" in content
        assert "# FILE: skip.py" not in content


def test_self_exclusion():
    runner = CliRunner()
    with runner.isolated_filesystem():
        Path("alpha.py").write_text("alpha", encoding='utf-8')

        result = runner.invoke(cli, ["-o", "combicode.txt"])
        assert result.exit_code == 0

        content = Path("combicode.txt").read_text(encoding="utf-8")
        assert "# FILE: alpha.py" in content
        assert "# FILE: combicode.txt" not in content


def test_skip_content():
    """Test --skip-content: files appear in tree but content is omitted."""
    runner = CliRunner()
    with runner.isolated_filesystem():
        Path("main.py").write_text("print('main')", encoding='utf-8')
        Path("large.test.ts").write_text("const data = " + "x" * 1000 + ";", encoding='utf-8')

        Path("subdir").mkdir()
        Path("subdir/spec.ts").write_text("describe('spec', () => {});", encoding='utf-8')
        Path("subdir/utils.py").write_text("def util(): pass", encoding='utf-8')

        result = runner.invoke(cli, ["-o", "combicode.txt", "--skip-content", "**/*test.ts,**/*spec.ts"])
        assert result.exit_code == 0

        content = Path("combicode.txt").read_text(encoding="utf-8")
        assert "Content omitted" in content
        assert "print('main')" in content
        assert "def util(): pass" in content


def test_skip_content_dry_run():
    """Dry-run should show content omitted count."""
    runner = CliRunner()
    with runner.isolated_filesystem():
        Path("test.ts").write_text("test", encoding='utf-8')
        Path("main.py").write_text("main", encoding='utf-8')

        result = runner.invoke(cli, ["--dry-run", "--skip-content", "**/*test.ts"])
        assert result.exit_code == 0
        assert "Content omitted:" in result.output


def test_updated_system_prompt():
    """System prompt should mention code map, OL, and ML."""
    runner = CliRunner()
    with runner.isolated_filesystem():
        Path("main.py").write_text("x = 1", encoding='utf-8')

        result = runner.invoke(cli, ["-o", "out.txt"])
        assert result.exit_code == 0

        content = Path("out.txt").read_text(encoding="utf-8")
        assert "code map" in content.lower() or "Code Map" in content or "code map" in content
        assert "OL = Original Line" in content
        assert "ML = Merged Line" in content


def test_llms_txt_prompt():
    """llms-txt flag should use the alternative system prompt."""
    runner = CliRunner()
    with runner.isolated_filesystem():
        Path("docs.md").write_text("# Hello", encoding='utf-8')

        result = runner.invoke(cli, ["-o", "out.txt", "-l"])
        assert result.exit_code == 0

        content = Path("out.txt").read_text(encoding="utf-8")
        assert "definitive source of truth" in content
        assert "OL = Original Line" not in content


def test_file_header_format():
    """File headers in merged_code should have OL/ML/SIZE."""
    runner = CliRunner()
    with runner.isolated_filesystem():
        Path("hello.py").write_text("print('hello')\n", encoding='utf-8')

        result = runner.invoke(cli, ["-o", "out.txt"])
        assert result.exit_code == 0

        content = Path("out.txt").read_text(encoding="utf-8")
        # Use regex on full content since <merged_code> appears in system prompt text too
        assert re.search(r'# FILE: hello\.py \[OL: 1-\d+ \| ML: \d+-\d+ \| \d+(\.\d+)?[BKMGT]?B?\]', content)


def test_recreate_from_combicode():
    """Recreate should extract files from combicode.txt."""
    runner = CliRunner()
    with runner.isolated_filesystem():
        # Generate
        Path("src").mkdir()
        Path("src/index.js").write_text("console.log('hello');", encoding='utf-8')
        Path("src/utils.js").write_text("function add(a, b) { return a + b; }", encoding='utf-8')
        Path("config.json").write_text('{"key": "value"}', encoding='utf-8')

        result = runner.invoke(cli, ["-o", "combicode.txt"])
        assert result.exit_code == 0

        # Recreate
        Path("recreated").mkdir()
        result = runner.invoke(cli, ["--recreate", "--input", "combicode.txt", "-o", "recreated"])
        assert result.exit_code == 0

        assert (Path("recreated/src/index.js")).exists(), "src/index.js should be recreated"
        assert (Path("recreated/src/utils.js")).exists(), "src/utils.js should be recreated"
        assert (Path("recreated/config.json")).exists(), "config.json should be recreated"

        index_content = Path("recreated/src/index.js").read_text(encoding="utf-8")
        assert "console.log('hello');" in index_content


def test_recreate_dry_run():
    """Recreate dry run should list files without creating them."""
    runner = CliRunner()
    with runner.isolated_filesystem():
        Path("main.js").write_text("console.log('hello');", encoding='utf-8')

        result = runner.invoke(cli, ["-o", "combicode.txt"])
        assert result.exit_code == 0

        result = runner.invoke(cli, ["--recreate", "--input", "combicode.txt", "--dry-run"])
        assert result.exit_code == 0
        assert "Files to recreate" in result.output
        assert "main.js" in result.output


def test_recreate_overwrite():
    """Recreate with --overwrite should replace existing files."""
    runner = CliRunner()
    with runner.isolated_filesystem():
        Path("main.js").write_text("console.log('hello');", encoding='utf-8')

        result = runner.invoke(cli, ["-o", "combicode.txt"])
        assert result.exit_code == 0

        # Create existing file
        Path("out").mkdir()
        Path("out/main.js").write_text("OLD CONTENT", encoding='utf-8')

        # Without overwrite
        result = runner.invoke(cli, ["--recreate", "--input", "combicode.txt", "-o", "out"])
        assert result.exit_code == 0
        assert "OLD CONTENT" in Path("out/main.js").read_text(encoding="utf-8")

        # With overwrite
        result = runner.invoke(cli, ["--recreate", "--input", "combicode.txt", "-o", "out", "--overwrite"])
        assert result.exit_code == 0
        assert "console.log('hello');" in Path("out/main.js").read_text(encoding="utf-8")


def test_no_header_flag():
    """--no-header should omit system prompt and code_index."""
    runner = CliRunner()
    with runner.isolated_filesystem():
        Path("main.js").write_text("x = 1", encoding='utf-8')

        result = runner.invoke(cli, ["-o", "out.txt", "--no-header"])
        assert result.exit_code == 0

        content = Path("out.txt").read_text(encoding="utf-8")
        assert "<code_index>" not in content
        assert "expert software architect" not in content
        assert "<merged_code>" in content
        assert "# FILE: main.js" in content


def test_include_ext_filter():
    """Include extension filter should only include matching files."""
    runner = CliRunner()
    with runner.isolated_filesystem():
        Path("main.py").write_text("print('hello')", encoding='utf-8')
        Path("style.css").write_text("body { }", encoding='utf-8')
        Path("readme.md").write_text("# Hello", encoding='utf-8')

        result = runner.invoke(cli, ["-o", "out.txt", "-i", ".py"])
        assert result.exit_code == 0

        content = Path("out.txt").read_text(encoding="utf-8")
        assert "# FILE: main.py" in content
        assert "# FILE: style.css" not in content
        assert "# FILE: readme.md" not in content


def test_typescript_interface_parsing():
    """Code map should parse TypeScript interfaces."""
    runner = CliRunner()
    with runner.isolated_filesystem():
        Path("types.ts").write_text(
            "export interface Config {\n"
            "  host: string;\n"
            "  port: number;\n"
            "  debug: boolean;\n"
            "}\n"
            "\n"
            "export class Server {\n"
            "  constructor(config: Config) {\n"
            "    this.config = config;\n"
            "  }\n"
            "}\n",
            encoding='utf-8'
        )

        result = runner.invoke(cli, ["-o", "out.txt"])
        assert result.exit_code == 0

        content = Path("out.txt").read_text(encoding="utf-8")
        assert "interface Config" in content
        assert "class Server" in content


def test_ml_line_numbers_accuracy():
    """ML line numbers in file headers should point to actual content lines in the output."""
    runner = CliRunner()
    with runner.isolated_filesystem():
        Path("first.py").write_text("print('first')\nprint('second')\nprint('third')\n", encoding='utf-8')
        Path("second.js").write_text("const a = 1;\nconst b = 2;\n", encoding='utf-8')
        Path("subdir").mkdir()
        Path("subdir/third.txt").write_text("hello\nworld\n", encoding='utf-8')

        result = runner.invoke(cli, ["-o", "combicode.txt"])
        assert result.exit_code == 0

        content = Path("combicode.txt").read_text(encoding="utf-8")
        output_lines = content.split("\n")

        # Parse all file headers and verify ML ranges
        verified = 0
        for m in re.finditer(r'# FILE:\s*(\S+)\s*\[OL: (\d+)-(\d+) \| ML: (\d+)-(\d+) \|', content):
            file_name = m.group(1)
            ml_start = int(m.group(4))
            ml_end = int(m.group(5))

            # Line before ML start should be opening backticks
            line_before = output_lines[ml_start - 2]
            assert line_before == "````", \
                f"Line before ML start for {file_name} should be opening backticks, got: '{line_before}' (line {ml_start - 1})"

            # Line after ML end should be closing backticks
            line_after = output_lines[ml_end]
            assert line_after == "````", \
                f"Line after ML end for {file_name} should be closing backticks, got: '{line_after}' (line {ml_end + 1})"

            # Content at ML start should NOT be backticks
            first_content = output_lines[ml_start - 1]
            assert first_content != "````", \
                f"ML start for {file_name} should point to content, not backticks"

            verified += 1

        assert verified >= 3, f"Should have verified at least 3 files, got {verified}"


def test_ml_accuracy_across_many_files():
    """ML accuracy across multiple files with different line counts."""
    runner = CliRunner()
    with runner.isolated_filesystem():
        # Create files with varying numbers of lines
        for i in range(1, 6):
            lines = [f"line_{j}_of_file_{i}" for j in range(1, i * 4 + 1)]
            Path(f"file{i}.py").write_text("\n".join(lines) + "\n", encoding='utf-8')

        result = runner.invoke(cli, ["-o", "combicode.txt", "--no-parse"])
        assert result.exit_code == 0

        content = Path("combicode.txt").read_text(encoding="utf-8")
        output_lines = content.split("\n")

        for m in re.finditer(r'# FILE:\s*(\S+)\s*\[OL: (\d+)-(\d+) \| ML: (\d+)-(\d+) \|', content):
            file_name = m.group(1)
            ol_start = int(m.group(2))
            ol_end = int(m.group(3))
            ml_start = int(m.group(4))
            ml_end = int(m.group(5))

            expected_line_count = ol_end - ol_start + 1
            ml_line_count = ml_end - ml_start + 1
            assert ml_line_count == expected_line_count, \
                f"{file_name}: ML range ({ml_line_count} lines) should match OL range ({expected_line_count} lines)"

            # Verify first content line
            first_line = output_lines[ml_start - 1]
            assert first_line.startswith("line_1_of_"), \
                f"{file_name}: ML {ml_start} should point to first line of content, got: '{first_line}'"

            # Verify last content line
            last_line = output_lines[ml_end - 1]
            assert last_line.startswith(f"line_{expected_line_count}_of_"), \
                f"{file_name}: ML {ml_end} should point to last line of content, got: '{last_line}'"
