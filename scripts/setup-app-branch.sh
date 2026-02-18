#!/bin/bash
# Creates the app branch with Tool deployment config for app.mediashrinker.com
# Run this once to set up the dual-deploy from one repo.

set -e

# Ensure merge driver is configured (keeps main's netlify.toml when merging app→main)
git config merge.ours.driver true 2>/dev/null || true

echo "Setting up app branch for Tool deployment..."

# Create app branch from current state (or update existing)
if git show-ref --verify --quiet refs/heads/app; then
  echo "App branch exists. Updating netlify.toml..."
  git checkout app
else
  echo "Creating app branch..."
  git checkout -b app
fi

# Use Tool config
cp netlify.tool.toml netlify.toml
git add netlify.toml
git commit -m "chore: use Tool config for app.mediashrinker.com" || true

echo ""
echo "Done! Push with: git push -u origin app"
echo ""
echo "Then in Netlify:"
echo "  - Marketing site: connect to main branch"
echo "  - Tool site: connect to app branch (mediashrinkerapp.aetherarchlabs.xyz)"
