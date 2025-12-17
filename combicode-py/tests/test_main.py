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
    with runner.isolated_filesystem():
        Path("subdir").mkdir()
        Path("subdir/hello.py").write_text("print('hello')", encoding='utf-8')
        
        result = runner.invoke(cli, ["--dry-run"])
        
        assert result.exit_code == 0
        assert "Files to be included (Dry Run)" in result.output

def test_basic_generation():
    runner = CliRunner()
    with runner.isolated_filesystem():
        Path("alpha.py").write_text("print('alpha')", encoding='utf-8')
        Path("sub").mkdir()
        Path("sub/beta.txt").write_text("beta content", encoding='utf-8')

        result = runner.invoke(cli, ["--output", "output.txt"])
        
        assert result.exit_code == 0
        assert os.path.exists("output.txt")
        
        with open("output.txt", "r", encoding="utf-8") as f:
            content = f.read()
            assert "### **FILE:** `alpha.py`" in content
            assert "### **FILE:** `sub/beta.txt`" in content

def test_deep_nested_gitignore():
    """Test ensuring .gitignore works at root, nested, and deep levels."""
    runner = CliRunner()
    with runner.isolated_filesystem():
        # Setup files...
        Path(".gitignore").write_text("*.log", encoding='utf-8')
        Path("root.js").write_text("console.log('root')", encoding='utf-8')
        Path("ignore_root.log").write_text("log", encoding='utf-8')
        
        Path("nested").mkdir()
        Path("nested/.gitignore").write_text("*.tmp", encoding='utf-8')
        Path("nested/child.js").write_text("child", encoding='utf-8')
        Path("nested/ignore_child.tmp").write_text("tmp", encoding='utf-8')
        
        Path("nested/deep").mkdir()
        Path("nested/deep/.gitignore").write_text("ignore_local.txt", encoding='utf-8')
        Path("nested/deep/deep.js").write_text("deep", encoding='utf-8')
        Path("nested/deep/ignore_local.txt").write_text("txt", encoding='utf-8')

        # Run CLI
        result = runner.invoke(cli, ["--output", "combicode.txt"])
        
        # FORCE PRINT LOGS TO CONSOLE
        print("\n" + "="*40)
        print("    PYTHON CLI LOGS (Captured)")
        print("="*40)
        print(result.output)
        print("="*40 + "\n")
        
        assert result.exit_code == 0
        
        with open("combicode.txt", "r", encoding="utf-8") as f:
            content = f.read()
            # Assertions
            assert "### **FILE:** `root.js`" in content
            assert "### **FILE:** `nested/child.js`" in content
            assert "### **FILE:** `nested/deep/deep.js`" in content
            
            assert "### **FILE:** `ignore_root.log`" not in content
            assert "### **FILE:** `nested/ignore_child.tmp`" not in content
            assert "### **FILE:** `nested/deep/ignore_local.txt`" not in content

def test_cli_exclude_override():
    runner = CliRunner()
    with runner.isolated_filesystem():
        Path("nested").mkdir()
        Path("nested/keep.py").touch()
        Path("nested/skip.py").touch()
        
        result = runner.invoke(cli, ["-o", "out.txt", "-e", "**/skip.py"])
        assert result.exit_code == 0
        with open("out.txt", "r", encoding="utf-8") as f:
            content = f.read()
            assert "### **FILE:** `nested/keep.py`" in content
            assert "### **FILE:** `nested/skip.py`" not in content

def test_self_exclusion():
    runner = CliRunner()
    with runner.isolated_filesystem():
        Path("alpha.py").touch()
        result = runner.invoke(cli, ["-o", "combicode.txt"])
        assert result.exit_code == 0
        with open("combicode.txt", "r", encoding="utf-8") as f:
            content = f.read()
            assert "### **FILE:** `alpha.py`" in content
            assert "### **FILE:** `combicode.txt`" not in content

def test_skip_content():
    """Test --skip-content feature: files appear in tree but content is omitted."""
    runner = CliRunner()
    with runner.isolated_filesystem():
        Path("main.py").write_text("print('main')", encoding='utf-8')
        Path("test.py").write_text("def test(): pass", encoding='utf-8')
        Path("large.test.ts").write_text("const data = " + "x" * 1000 + ";", encoding='utf-8')
        
        Path("subdir").mkdir()
        Path("subdir/spec.ts").write_text("describe('spec', () => {});", encoding='utf-8')
        Path("subdir/utils.py").write_text("def util(): pass", encoding='utf-8')
        
        result = runner.invoke(cli, ["-o", "combicode.txt", "--skip-content", "**/*test.ts,**/*spec.ts"])
        
        assert result.exit_code == 0
        
        with open("combicode.txt", "r", encoding="utf-8") as f:
            content = f.read()
            
            # Files should appear in tree with (content omitted) marker
            assert "large.test.ts (content omitted)" in content
            assert "spec.ts (content omitted)" in content
            
            # Files should have FILE headers
            assert "### **FILE:** `large.test.ts`" in content
            assert "### **FILE:** `subdir/spec.ts`" in content
            
            # Content should be omitted (placeholder instead)
            import re
            large_test_match = re.search(r'### \*\*FILE:\*\* `large\.test\.ts`[\s\S]*?```([\s\S]*?)```', content)
            assert large_test_match, "Should find large.test.ts content section"
            assert "Content omitted" in large_test_match.group(1)
            assert "file size:" in large_test_match.group(1)
            
            # Regular files should have full content
            assert "print('main')" in content
            assert "def util(): pass" in content

def test_skip_content_dry_run():
    """Test that dry-run shows content omitted count."""
    runner = CliRunner()
    with runner.isolated_filesystem():
        Path("test.ts").write_text("test", encoding='utf-8')
        Path("main.py").write_text("main", encoding='utf-8')
        
        result = runner.invoke(cli, ["--dry-run", "--skip-content", "**/*test.ts"])
        
        assert result.exit_code == 0
        assert "Content omitted:" in result.output