#!/bin/bash

# This script synchronizes shared assets (README, LICENSE)
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

echo "Sync complete."