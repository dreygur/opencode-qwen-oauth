# Release Process

This document describes how to release a new version of `opencode-qwen-oauth`.

## Prerequisites

1. **NPM Token**: Set up `NPM_TOKEN` as a GitHub secret
   - Go to [npmjs.com](https://www.npmjs.com) → Account Settings → Access Tokens
   - Create a new **Automation** token
   - Add it to GitHub: Repository Settings → Secrets → Actions → New repository secret
   - Name: `NPM_TOKEN`
   - Value: Your npm token

2. **Permissions**: You need write access to the repository

## Automated Release (Recommended)

### Option 1: Using GitHub Releases

1. Update version in code:
   ```bash
   npm version patch  # or minor, or major
   # This updates package.json, src/index.ts, and bin/install.js
   ```

2. Build and commit:
   ```bash
   npm run build
   git add -A
   git commit -m "v$(node -p "require('./package.json').version")"
   ```

3. Create and push tag:
   ```bash
   git tag "v$(node -p "require('./package.json').version")"
   git push origin main --tags
   ```

4. GitHub Actions will automatically:
   - Run tests
   - Build the package
   - Publish to npm
   - Create a GitHub release

### Option 2: Using Workflow Dispatch

1. Go to Actions → "Publish to npm" → Run workflow
2. Select branch: `main`
3. Choose version bump: `patch`, `minor`, or `major`
4. Click "Run workflow"

The workflow will:
- Bump version
- Update source files
- Build and test
- Commit and push
- Publish to npm
- Create GitHub release

## Manual Release

If you need to publish manually:

```bash
# 1. Bump version
npm version patch  # or minor, or major

# 2. Update version in source files
NEW_VERSION=$(node -p "require('./package.json').version")
sed -i "s/const PLUGIN_VERSION = \".*\"/const PLUGIN_VERSION = \"$NEW_VERSION\"/" src/index.ts
sed -i "s/opencode-qwen-oauth\"] = \".*\"/opencode-qwen-oauth\"] = \"^$NEW_VERSION\"/" bin/install.js

# 3. Build
npm run build

# 4. Commit and tag
git add -A
git commit -m "v$NEW_VERSION"
git tag "v$NEW_VERSION"
git push origin main --tags

# 5. Publish to npm
npm publish --access public
```

## Version Guidelines

- **patch** (2.3.1 → 2.3.2): Bug fixes, documentation updates
- **minor** (2.3.1 → 2.4.0): New features, backwards compatible
- **major** (2.3.1 → 3.0.0): Breaking changes

## Verification

After release:

1. Check npm: https://www.npmjs.com/package/opencode-qwen-oauth
2. Test installation: `npx opencode-qwen-oauth install`
3. Verify GitHub release: https://github.com/dreygur/opencode-qwen-oauth/releases

## Rollback

If a release has issues:

1. Deprecate the version on npm:
   ```bash
   npm deprecate opencode-qwen-oauth@2.3.1 "This version has issues, use 2.3.0"
   ```

2. Publish a new fixed version (never unpublish)
