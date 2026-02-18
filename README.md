# INF252 Course Project

## Get started

Use Node.js 25 (see [.nvmrc](.nvmrc)). From the project root, install dependencies and run scripts as below.

### Project structure

| Path | Description |
|------|-------------|
| `frontend/` | Astro web app (visualization UI) |
| `data-pipeline/` | Notebooks and scripts for data analysis |
| `scripts/` | Root-level automation (e.g. data download) |
| `raw-data/` | Downloaded Oslo Bysykkel trip data (created by `npm run download`) |

### Commands

Download Oslo Bysykkel trip data into `raw-data/`:

```bash
npm run download
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
