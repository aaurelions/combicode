import os
from pathlib import Path
from click.testing import CliRunner
from combicode.main import cli, format_bytes

def test_format_bytes():
    assert format_bytes(100) == "100.0B"
    assert format_bytes(1024) == "1.0KB"
    assert format_bytes(0) == "0 B"

def test_version():
    runner = CliRunner()
    result = runner.invoke(cli, ["--version"])
    assert result.exit_code == 0
    assert "Combicode (Python), version" in result.output

def test_dry_run():
    runner = CliRunner()
    # Create the environment INSIDE the isolated filesystem
    with runner.isolated_filesystem():
        # Setup files
        Path("subdir").mkdir()
        Path("subdir/hello.py").write_text("print('hello')", encoding='utf-8')
        
        # Run CLI
        result = runner.invoke(cli, ["--dry-run"])
        
        assert result.exit_code == 0, f"Output:\n{result.output}"
        assert "Files to be included (Dry Run)" in result.output
        assert "hello.py" in result.output
        assert "[" in result.output and "]" in result.output

def test_generation():
    runner = CliRunner()
    with runner.isolated_filesystem():
        # Setup files
        Path("alpha.py").write_text("print('alpha')", encoding='utf-8')
        Path("sub").mkdir()
        Path("sub/beta.txt").write_text("beta content", encoding='utf-8')

        # Run CLI
        result = runner.invoke(cli, ["--output", "output.txt"])
        
        assert result.exit_code == 0, f"Output:\n{result.output}"
        assert os.path.exists("output.txt")
        
        with open("output.txt", "r", encoding="utf-8") as f:
            content = f.read()
            assert "You are an expert software architect" in content
            assert "sub" in content
            assert "### **FILE:** `alpha.py`" in content
            assert "print('alpha')" in content