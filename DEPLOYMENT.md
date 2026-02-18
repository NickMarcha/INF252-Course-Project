# GitHub Pages Deployment

This guide covers the initial setup and release process for deploying the INF252 Course Project to GitHub Pages.

## Initial Setup (One-Time)

### 1. Enable GitHub Pages

1. Go to your repository on GitHub
2. Open **Settings** → **Pages**
3. Under **Build and deployment**, set **Source** to **GitHub Actions**

### 2. Live URL

After deployment, the site is available at:

**https://NickMarcha.github.io/INF252-Course-Project/**

## Release Process

The deploy workflow runs when you push a version tag (e.g. `v1.0.0`). Use `npm version` to bump the version and create the tag.

### Step 1: Bump Version

Choose the version bump type:

```bash
# Patch version (1.0.0 → 1.0.1) - Bug fixes
npm version patch

# Minor version (1.0.0 → 1.1.0) - New features
npm version minor

# Major version (1.0.0 → 2.0.0) - Breaking changes
npm version major
```

This automatically:
- Updates the version in `package.json`
- Creates a git commit with the version change
- Creates a git tag (e.g. `v1.0.1`)

### Step 2: Push Commit and Tag

```bash
# Push the version commit
git push origin main

# Push the tag (this triggers the deploy workflow)
git push origin v1.0.1
```

Replace `v1.0.1` with the tag that was created (shown in the output of `npm version`).

### Step 3: Monitor the Deployment

1. Go to your repository → **Actions** tab
2. A new workflow run will appear, triggered by the tag push
3. Click on it to monitor the build and deploy progress
4. When complete, the site will be updated at the live URL

## Manual Deployment

To deploy without creating a tag:

1. Go to **Actions** → **Deploy to GitHub Pages**
2. Click **Run workflow** → **Run workflow**

## Troubleshooting

### Workflow Not Triggering

- **Check tag format**: Must match `v*` pattern (e.g. `v1.0.0`, `v0.0.1`)
- **Verify tag push**: `git push origin v1.0.1` (use your actual tag name)
- **Check Actions tab**: A new run should appear when the tag is pushed

### Build Failures

- **Run locally first**: `npm run build` to verify the build works
- **Check logs**: Open the failed workflow run and inspect each step
- **prepared-data**: Ensure `prepared-data/` is committed so the data-test page has data
