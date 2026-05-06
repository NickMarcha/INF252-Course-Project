# INF252 Course Project

[![Deploy to GitHub Pages](https://github.com/NickMarcha/INF252-Course-Project/actions/workflows/deploy.yml/badge.svg)](https://github.com/NickMarcha/INF252-Course-Project/actions/workflows/deploy.yml)

[Live: data test](https://NickMarcha.github.io/INF252-Course-Project/data-test/) - D3 chart of Oslo Bysykkel trip data



## documentation map

- Full docs index: [`docs/README.md`](docs/README.md)
- Weather pipeline details: [`docs/Weather.md`](docs/Weather.md)
- Routes pipeline details: [`docs/Routes.md`](docs/Routes.md)
- Deployment runbook: [`DEPLOYMENT.md`](DEPLOYMENT.md)

## project map

| Path | What it contains |
|------|------------------|
| `frontend/` | Astro app and visualization pages |
| `data-pipeline/` | Notebooks and Python modules for data preparation |
| `scripts/` | Data export/sync automation used by npm scripts |
| `prepared-data/` | Frontend-ready JSON artifacts |
| `raw-data/` | Downloaded Oslo Bysykkel trip data |
| `weather-cache/` | Frost API monthly cache files |
| `routes-cache/` | Cached Google Routes responses |

## recommended tools

- **Jupyter (VS Code)** – Run notebooks in VS Code: [Jupyter extension](https://open-vsx.org/extension/ms-toolsai/jupyter)
- **Node version manager** – Switch Node versions (project uses Node 25):
  - Windows: [nvm-windows](https://github.com/coreybutler/nvm-windows)
  - Mac/Linux: [nvm](https://github.com/nvm-sh/nvm)
- **Python / conda** – Manage Python environments for the data pipeline:
  - [Anaconda](https://www.anaconda.com/download) (Windows, Mac, Linux)
  - Arch Linux: [python-conda](https://aur.archlinux.org/packages/python-conda)

## quick run

Use Node.js 25 (see [.nvmrc](.nvmrc)). From the project root:

```bash
npm install
```

Create the data-pipeline conda environment:

```bash
npm run conda:create
conda activate inf252-data-pipeline
```

Prepare data artifacts and run the frontend:

```bash
npm run prepare:data
npm run dev
```

## commands

| Command | Description |
|---------|--------------|
| `npm run conda:create` | Create conda env from `data-pipeline/environment.yml` |
| `npm run conda:update` | Update conda env after changes to environment.yml |
| `npm run prepare:data` | Export weather (if `weather-cache/` exists), routes from cache, then sync `prepared-data/` to the frontend |
| `npm run download` | Download Oslo Bysykkel trip data |
| `npm run dev` | Start frontend dev server |
| `npm run build` | Build frontend for production |
| `npm run preview` | Preview production build |

## troubleshooting paths

- If weather data is missing: see [`docs/Weather.md`](docs/Weather.md#troubleshooting)
- If route data is missing: see [`docs/Routes.md`](docs/Routes.md#troubleshooting)
- If build/deploy fails: see [`DEPLOYMENT.md`](DEPLOYMENT.md#troubleshooting)

## deployment

Deploy to GitHub Pages by pushing a version tag. See [DEPLOYMENT.md](DEPLOYMENT.md) for setup and release instructions.

## pages

- `/` – Home (Astro example)
- `/data-test` – D3 chart of average trip time by month (reads from `prepared-data/`)
- `/course-info` – Course project information (renders `Course-Project-Information.md` with Tailwind Typography)

## see also

- [`docs/README.md`](docs/README.md)
- [`docs/Weather.md`](docs/Weather.md)
- [`docs/Routes.md`](docs/Routes.md)
- [`DEPLOYMENT.md`](DEPLOYMENT.md)
