#!/usr/bin/env node
"use strict";

// Runs the native combicode binary from the platform package that npm installed
// through optionalDependencies.

const { spawnSync } = require("node:child_process");

const platformPackage = `@aaurelions/combicode-${process.platform}-${process.arch}`;
const executable = process.platform === "win32" ? "combicode.exe" : "combicode";

let binary;
try {
  binary = require.resolve(`${platformPackage}/bin/${executable}`);
} catch {
  console.error(
    `combicode: no prebuilt binary for ${process.platform}-${process.arch}.\n` +
      `The optional dependency "${platformPackage}" is not installed. Reinstall without ` +
      "--no-optional/--omit=optional, or install with Cargo: cargo install combicode",
  );
  process.exit(1);
}

const result = spawnSync(binary, process.argv.slice(2), { stdio: "inherit" });
if (result.error) {
  console.error(`combicode: cannot run ${binary}: ${result.error.message}`);
  process.exit(1);
}
if (result.signal) {
  process.kill(process.pid, result.signal);
}
process.exit(result.status ?? 1);
