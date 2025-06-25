#!/bin/bash

# This script synchronizes shared assets (README, LICENSE, configs)
# from the project root into the individual package directories.
# It should be run by CI/CD before any build or publish steps.

set -e # Exit immediately if a command exits with a non-zero status.

echo "Syncing shared assets..."

# === Sync Documentation ===
cp ./README.md ./combicode-js/README.md
cp ./README.md ./combicode-py/README.md
echo "✅ README.md synced."

cp ./LICENSE ./combicode-js/LICENSE
cp ./LICENSE ./combicode-py/LICENSE
echo "✅ LICENSE synced."

# === Sync Configuration ===
# Create the config directory if it doesn't exist and copy the ignore file
mkdir -p ./combicode-js/config
cp ./configs/ignore.json ./combicode-js/config/ignore.json

mkdir -p ./combicode-py/combicode/config
cp ./configs/ignore.json ./combicode-py/combicode/config/ignore.json
echo "✅ ignore.json config synced."

echo "Sync complete."