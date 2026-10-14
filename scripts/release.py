#!/usr/bin/env python3
"""Package release binaries for GitHub Releases, npm, PyPI and Homebrew.

Every package is built from the same release archives, so all channels ship identical
binaries. Typical flow (see .github/workflows/release.yml):

    release.py archive --target T --binary target/T/release/combicode --out dist
    release.py npm     --dist dist --out dist/npm
    release.py wheels  --dist dist --out dist/wheels
    release.py formula --dist dist > combicode.rb
"""

from __future__ import annotations

import argparse
import base64
import csv
import hashlib
import io
import json
import re
import shutil
import stat
import sys
import tarfile
import tomllib
import zipfile
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REPOSITORY = "https://github.com/aaurelions/combicode"
NPM_SCOPE = "@aaurelions"
SUMMARY = "Pack a codebase into one LLM-friendly text file with a code map and exact line references"


@dataclass(frozen=True)
class Target:
    triple: str
    npm_os: str
    npm_cpu: str
    wheel_tags: tuple[str, ...]
    brew: tuple[str, str] | None  # (on_macos/on_linux, on_arm/on_intel)

    @property
    def windows(self) -> bool:
        return self.npm_os == "win32"

    @property
    def executable(self) -> str:
        return "combicode.exe" if self.windows else "combicode"

    @property
    def archive(self) -> str:
        return f"combicode-{self.triple}.{'zip' if self.windows else 'tar.gz'}"

    @property
    def npm_dir(self) -> str:
        return f"combicode-{self.npm_os}-{self.npm_cpu}"

    @property
    def npm_package(self) -> str:
        # Scoped: npm's spam filter rejects new unscoped names that resemble each other.
        return f"{NPM_SCOPE}/{self.npm_dir}"


def _linux_tags(arch: str) -> tuple[str, ...]:
    # The Linux binaries are statically linked with musl, so they run on glibc and musl.
    return (f"manylinux_2_17_{arch}", f"manylinux2014_{arch}", f"musllinux_1_1_{arch}")


TARGETS = (
    Target("x86_64-unknown-linux-musl", "linux", "x64", _linux_tags("x86_64"), ("linux", "intel")),
    Target("aarch64-unknown-linux-musl", "linux", "arm64", _linux_tags("aarch64"), ("linux", "arm")),
    Target("x86_64-apple-darwin", "darwin", "x64", ("macosx_10_12_x86_64",), ("macos", "intel")),
    Target("aarch64-apple-darwin", "darwin", "arm64", ("macosx_11_0_arm64",), ("macos", "arm")),
    Target("x86_64-pc-windows-msvc", "win32", "x64", ("win_amd64",), None),
    Target("aarch64-pc-windows-msvc", "win32", "arm64", ("win_arm64",), None),
)


def find_target(triple: str) -> Target:
    for target in TARGETS:
        if target.triple == triple:
            return target
    sys.exit(f"unsupported target {triple}; expected one of {', '.join(t.triple for t in TARGETS)}")


def version() -> str:
    with open(ROOT / "Cargo.toml", "rb") as manifest:
        return tomllib.load(manifest)["package"]["version"]


def available(dist: Path) -> list[tuple[Target, Path]]:
    found = [(t, dist / t.archive) for t in TARGETS if (dist / t.archive).is_file()]
    if not found:
        sys.exit(f"no release archives found in {dist}")
    return found


def read_binary(target: Target, archive: Path) -> bytes:
    if target.windows:
        with zipfile.ZipFile(archive) as zf:
            return zf.read(target.executable)
    with tarfile.open(archive, "r:gz") as tf:
        member = tf.extractfile(target.executable)
        if member is None:
            sys.exit(f"{archive} does not contain {target.executable}")
        return member.read()


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def cmd_version(_: argparse.Namespace) -> None:
    print(version())


def cmd_archive(args: argparse.Namespace) -> None:
    target = find_target(args.target)
    args.out.mkdir(parents=True, exist_ok=True)
    destination = args.out / target.archive
    files = [
        (target.executable, args.binary.read_bytes(), 0o755),
        ("LICENSE", (ROOT / "LICENSE").read_bytes(), 0o644),
        ("README.md", (ROOT / "README.md").read_bytes(), 0o644),
    ]
    if target.windows:
        with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED) as zf:
            for name, data, mode in files:
                info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
                info.external_attr = (stat.S_IFREG | mode) << 16
                info.compress_type = zipfile.ZIP_DEFLATED
                zf.writestr(info, data)
    else:
        with tarfile.open(destination, "w:gz") as tf:
            for name, data, mode in files:
                info = tarfile.TarInfo(name)
                info.size = len(data)
                info.mode = mode
                tf.addfile(info, io.BytesIO(data))
    print(destination)


def cmd_npm(args: argparse.Namespace) -> None:
    release = version()
    template = ROOT / "npm" / "combicode"
    manifest = json.loads((template / "package.json").read_text(encoding="utf-8"))
    if args.out.exists():
        shutil.rmtree(args.out)

    for target, archive in available(args.dist):
        package = args.out / target.npm_dir
        (package / "bin").mkdir(parents=True)
        binary = package / "bin" / target.executable
        binary.write_bytes(read_binary(target, archive))
        binary.chmod(0o755)
        shutil.copy(ROOT / "LICENSE", package / "LICENSE")
        (package / "README.md").write_text(
            f"# {target.npm_package}\n\nThe `{target.triple}` binary of "
            f"[combicode]({REPOSITORY}). Install `combicode` instead of this package.\n",
            encoding="utf-8",
        )
        platform_manifest = {
            "name": target.npm_package,
            "version": release,
            "description": f"The {target.triple} binary of combicode",
            "repository": manifest["repository"],
            "license": manifest["license"],
            "author": manifest["author"],
            "os": [target.npm_os],
            "cpu": [target.npm_cpu],
            "files": [f"bin/{target.executable}"],
            "preferUnplugged": True,
        }
        write_json(package / "package.json", platform_manifest)
        print(package)

    main = args.out / "combicode"
    shutil.copytree(template, main)
    shutil.copy(ROOT / "LICENSE", main / "LICENSE")
    shutil.copy(ROOT / "README.md", main / "README.md")
    manifest = {"name": manifest["name"], "version": release, **manifest}
    manifest["optionalDependencies"] = {t.npm_package: release for t in TARGETS}
    write_json(main / "package.json", manifest)
    print(main)


def write_json(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def cmd_wheels(args: argparse.Namespace) -> None:
    release = version()
    args.out.mkdir(parents=True, exist_ok=True)
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    license_text = (ROOT / "LICENSE").read_bytes()
    metadata = "\n".join(
        [
            "Metadata-Version: 2.4",
            "Name: combicode",
            f"Version: {release}",
            f"Summary: {SUMMARY}",
            "Author: A. Aurelions",
            "License-Expression: MIT",
            "License-File: LICENSE",
            f"Project-URL: Homepage, {REPOSITORY}",
            f"Project-URL: Issues, {REPOSITORY}/issues",
            "Keywords: llm,context,prompt,cli,codebase",
            "Classifier: Environment :: Console",
            "Classifier: Topic :: Software Development",
            "Description-Content-Type: text/markdown",
            "",
            readme,
        ]
    )
    dist_info = f"combicode-{release}.dist-info"
    for target, archive in available(args.dist):
        tags = [f"py3-none-{tag}" for tag in target.wheel_tags]
        wheel = "\n".join(
            [
                "Wheel-Version: 1.0",
                "Generator: combicode release.py",
                "Root-Is-Purelib: false",
                *(f"Tag: {tag}" for tag in tags),
                "",
            ]
        )
        files = [
            (f"combicode-{release}.data/scripts/{target.executable}", read_binary(target, archive), 0o755),
            (f"{dist_info}/METADATA", metadata.encode(), 0o644),
            (f"{dist_info}/WHEEL", wheel.encode(), 0o644),
            (f"{dist_info}/licenses/LICENSE", license_text, 0o644),
        ]
        record = io.StringIO()
        writer = csv.writer(record, lineterminator="\n")
        for name, data, _ in files:
            digest = base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b"=").decode()
            writer.writerow([name, f"sha256={digest}", len(data)])
        writer.writerow([f"{dist_info}/RECORD", "", ""])
        files.append((f"{dist_info}/RECORD", record.getvalue().encode(), 0o644))

        name = f"combicode-{release}-py3-none-{'.'.join(target.wheel_tags)}.whl"
        with zipfile.ZipFile(args.out / name, "w", zipfile.ZIP_DEFLATED) as zf:
            for path, data, mode in files:
                info = zipfile.ZipInfo(path, date_time=(1980, 1, 1, 0, 0, 0))
                info.external_attr = (stat.S_IFREG | mode) << 16
                info.compress_type = zipfile.ZIP_DEFLATED
                zf.writestr(info, data)
        print(args.out / name)


def cmd_formula(args: argparse.Namespace) -> None:
    release = version()
    blocks: dict[str, list[str]] = {"macos": [], "linux": []}
    for target, archive in available(args.dist):
        if target.brew is None:
            continue
        system, cpu = target.brew
        url = f"{REPOSITORY}/releases/download/v{release}/{target.archive}"
        blocks[system].append(f'    on_{cpu} do\n      url "{url}"\n      sha256 "{sha256(archive)}"\n    end')
    sections = "\n\n".join(
        f"  on_{system} do\n" + "\n".join(entries) + "\n  end" for system, entries in blocks.items() if entries
    )
    print(
        f'''class Combicode < Formula
  desc "{SUMMARY}"
  homepage "{REPOSITORY}"
  version "{release}"
  license "MIT"

{sections}

  def install
    bin.install "combicode"
  end

  test do
    assert_match version.to_s, shell_output("#{{bin}}/combicode --version")
  end
end'''
    )


def cmd_checksums(args: argparse.Namespace) -> None:
    lines = [f"{sha256(archive)}  {archive.name}" for _, archive in available(args.dist)]
    (args.dist / "SHA256SUMS").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(args.dist / "SHA256SUMS")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(required=True)

    commands.add_parser("version", help="print the version from Cargo.toml").set_defaults(run=cmd_version)

    archive = commands.add_parser("archive", help="create the release archive for one target")
    archive.add_argument("--target", required=True)
    archive.add_argument("--binary", type=Path, required=True)
    archive.add_argument("--out", type=Path, required=True)
    archive.set_defaults(run=cmd_archive)

    for name, run, help_text in [
        ("npm", cmd_npm, "create the npm packages"),
        ("wheels", cmd_wheels, "create the Python wheels"),
    ]:
        command = commands.add_parser(name, help=help_text)
        command.add_argument("--dist", type=Path, required=True, help="directory with release archives")
        command.add_argument("--out", type=Path, required=True)
        command.set_defaults(run=run)

    for name, run, help_text in [
        ("formula", cmd_formula, "print the Homebrew formula"),
        ("checksums", cmd_checksums, "write SHA256SUMS for the release archives"),
    ]:
        command = commands.add_parser(name, help=help_text)
        command.add_argument("--dist", type=Path, required=True, help="directory with release archives")
        command.set_defaults(run=run)

    args = parser.parse_args()
    if not re.fullmatch(r"\d+\.\d+\.\d+", version()):
        sys.exit(f"Cargo.toml version {version()!r} is not MAJOR.MINOR.PATCH")
    args.run(args)


if __name__ == "__main__":
    main()
