#!/bin/bash

# Script to prepare a new release
# Usage: ./scripts/prepare-release.sh <version>
# Example: ./scripts/prepare-release.sh 1.7.0

set -e

if [ -z "$1" ]; then
    echo "Usage: $0 <version>"
    echo "Example: $0 1.7.0"
    exit 1
fi

VERSION=$1

echo "🚀 Preparing release v${VERSION}..."

# Update JavaScript package version
echo "📦 Updating combicode-js/package.json..."
sed -i '' "s/\"version\": \".*\"/\"version\": \"${VERSION}\"/" combicode-js/package.json

# Update Python package version
echo "🐍 Updating combicode-py/combicode/__init__.py..."
sed -i '' "s/__version__ = \".*\"/__version__ = \"${VERSION}\"/" combicode-py/combicode/__init__.py

echo ""
echo "✅ Versions updated to ${VERSION}"
echo ""
echo "Next steps:"
echo "1. Update CHANGELOG.md files in both combicode-js/ and combicode-py/"
echo "2. Review the changes: git diff"
echo "3. Commit: git add -A && git commit -m \"chore: bump version to ${VERSION}\""
echo "4. Create tag: git tag -a v${VERSION} -m \"Release v${VERSION}\""
echo "5. Push: git push origin main && git push origin v${VERSION}"
echo "6. Create GitHub release from tag v${VERSION}"

