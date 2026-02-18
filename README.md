# INF252 Course Project

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

### Commands

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
