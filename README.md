# INF252 Course Project

[![Deploy to GitHub Pages](https://github.com/NickMarcha/INF252-Course-Project/actions/workflows/deploy.yml/badge.svg)](https://github.com/NickMarcha/INF252-Course-Project/actions/workflows/deploy.yml)

**[Live: Data Test](https://NickMarcha.github.io/INF252-Course-Project/data-test/)** – D3 chart of Oslo Bysykkel trip data

## Recommended tools

- **Jupyter (VS Code)** – Run notebooks in VS Code: [Jupyter extension](https://open-vsx.org/extension/ms-toolsai/jupyter)
- **Node version manager** – Switch Node versions (project uses Node 25):
  - Windows: [nvm-windows](https://github.com/coreybutler/nvm-windows)
  - Mac/Linux: [nvm](https://github.com/nvm-sh/nvm)
- **Python / conda** – Manage Python environments for the data pipeline:
  - [Anaconda](https://www.anaconda.com/download) (Windows, Mac, Linux)
  - Arch Linux: [python-conda](https://aur.archlinux.org/packages/python-conda)

## Get started

Use Node.js 25 (see [.nvmrc](.nvmrc)). From the project root:

```bash
npm install
```

This installs frontend dependencies automatically. Then run the commands below.

### Project structure

| Path | Description |
|------|-------------|
| `frontend/` | Astro web app (visualization UI) |
| `data-pipeline/` | Notebooks and scripts for data analysis |
| `scripts/` | Root-level automation (e.g. data download) |
| `raw-data/` | Downloaded Oslo Bysykkel trip data (created by `npm run download`) |

### Data pipeline (conda)

Create the conda environment for notebooks:

```bash
npm run conda:create
conda activate inf252-data-pipeline
```

Update the environment after changes to `data-pipeline/environment.yml`:

```bash
npm run conda:update
```

### Commands

| Command | Description |
|---------|--------------|
| `npm run conda:create` | Create conda env from `data-pipeline/environment.yml` |
| `npm run conda:update` | Update conda env after changes to environment.yml |
| `npm run prepare:data` | Sync prepared-data to frontend (run after pipeline) |
| `npm run download` | Download Oslo Bysykkel trip data |
| `npm run dev` | Start frontend dev server |
| `npm run build` | Build frontend for production |
| `npm run preview` | Preview production build |

Sync prepared data into the frontend (run after the pipeline produces `prepared-data/`):

```bash
npm run prepare:data
```

Download Oslo Bysykkel trip data into `raw-data/`:

```bash
npm run download
```

Download only one month (e.g. 2024-01):

```bash
npm run download -- 2024-01
```

Start the frontend dev server:

```bash
npm run dev
```

Build the frontend for production:

```bash
npm run build
```

Preview the production build locally:

```bash
npm run preview
```

### Deployment

Deploy to GitHub Pages by pushing a version tag. See [DEPLOYMENT.md](DEPLOYMENT.md) for setup and release instructions.

### Pages

- `/` – Home (Astro example)
- `/data-test` – D3 chart of average trip time by month (reads from `prepared-data/`)
- `/course-info` – Course project information (renders `Course-Project-Information.md` with Tailwind Typography)
