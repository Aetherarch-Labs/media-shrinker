# Creates the app branch with Tool deployment config for app.mediashrinker.com
# Run this once to set up the dual-deploy from one repo.

$ErrorActionPreference = "Stop"

# Ensure merge driver is configured (keeps main's netlify.toml when merging app→main)
git config merge.ours.driver true 2>$null

Write-Host "Setting up app branch for Tool deployment..."

# Create app branch from current state (or update existing)
$branchExists = git show-ref --verify --quiet refs/heads/app 2>$null; $?
if ($branchExists) {
    Write-Host "App branch exists. Updating netlify.toml..."
    git checkout app
} else {
    Write-Host "Creating app branch..."
    git checkout -b app
}

# Use Tool config
Copy-Item netlify.tool.toml netlify.toml
git add netlify.toml
git commit -m "chore: use Tool config for app.mediashrinker.com" 2>$null

Write-Host ""
Write-Host "Done! Push with: git push -u origin app"
Write-Host ""
Write-Host "Then in Netlify:"
Write-Host "  - Marketing site: connect to main branch"
Write-Host "  - Tool site: connect to app branch (mediashrinkerapp.aetherarchlabs.xyz)"
