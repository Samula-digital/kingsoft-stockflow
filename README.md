# Kingsoft Stock Flow

Stock movement control and finance reporting system for stores teams, finance teams, and internal stock operations.

It supports:

- receipts, issues, and adjustments
- requisition page tracking by department
- finance reporting with PDF, CSV, and Excel export
- one-click monthly finance report pack export
- workbook import from the daily stores movement template
- audit trail for edits and deletions
- desktop, LAN, and single-host online deployment

## Run locally

Install dependencies:

```bash
npm install
```

Start the frontend and backend together:

```bash
npm run dev
```

Open:

- `http://127.0.0.1:5173/`

## Production run

Build the frontend:

```bash
npm run build
```

Start the shared app server:

```bash
npm run start
```

By default the server listens on port `4000`.

To use PostgreSQL instead of the shared JSON file store, set:

```bash
DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/DBNAME
```

Optional:

```bash
DATABASE_SSL=require
```

If `DATABASE_URL` is not set, the app uses the existing JSON-backed store.

When `DATABASE_URL` is set for the first time on an empty database, the server automatically seeds PostgreSQL from the current JSON store if live data already exists.

## Deployment options

For the shortest online launch path, use [ONLINE_DEPLOYMENT.md](ONLINE_DEPLOYMENT.md).

### Render

This repo includes [render.yaml](render.yaml).

Use:

- build command: `npm ci && npm run build`
- start command: `npm run start`
- health check: `/api/health`

Required environment:

- `NODE_ENV=production`
- `HOST=0.0.0.0`
- `STOCKFLOW_SECURE_COOKIES=true`
- `STOCKFLOW_DATA_DIR=/data`

Optional for a real database:

- `DATABASE_URL=postgres://...`
- `DATABASE_SSL=require`

### Docker

This repo now includes [Dockerfile](/Users/mac/Downloads/sirro/kingsoft-stockflow-vscode/Dockerfile).

Build:

```bash
docker build -t kingsoft-stockflow .
```

Run:

```bash
docker run -p 4000:4000 kingsoft-stockflow
```

### Generic VPS / Node host

```bash
npm ci
npm run build
npm run start
```

Reverse proxy the app through Nginx or Caddy and use HTTPS.

## Release bundle

Create a clean online bundle:

```bash
npm run package
```

The bundle is written to `release/stockflow-online`.

It starts with a clean JSON-backed store:

- `data/kingsoft-stockflow.json`

Live stock data is intentionally not committed to GitHub. Keep real hotel records in the local `data/` folder, a Render disk, or PostgreSQL via `DATABASE_URL`.

## Desktop and LAN

LAN mode:

```bash
npm run lan:start
```

Open the address printed in the terminal on other computers connected to the same network, for example `http://192.168.1.20:4000`.

Windows desktop packaging:

```bash
npm run desktop:dist:win
```

## Workbook import

The daily workbook import is built around the dated-sheet template used by stores.

Key import behavior:

- parses one dated sheet per day
- imports opening balances and movement history by default
- preserves the current item master unless `--include-item-setup` is used
- maps issue lines to departments using workbook section/category
- normalizes known template unit traps, including beer crate prices imported against bottle-based stock
- can retire older app-only item records only when item setup is intentionally included

CLI import helper:

```bash
npm run import:workbook -- "/path/to/workbook.xlsx" --from 2026-01-01 --to 2026-03-31 --replace-workbook-history --apply
```

Use this only when you intentionally want workbook category, UOM, cost, and stock levels to update the item master:

```bash
npm run import:workbook -- "/path/to/workbook.xlsx" --include-item-setup --retire-missing-workbook-items --apply
```

## Monthly finance reports

Finance can export the selected month from the app using `Finance Pack -> Monthly -> Monthly Pack`.
Use `Monthly PDF` on the same page for the branded PDF preview with company logo, colors, prepared-by, and sign-off space.

You can also generate the same workbook report directly from the command line:

```bash
npm run report:monthly -- --month 2026-04
```

The generated file is saved in `reports/` and includes summary, stock position, outstanding stock, needs-review rows, received stock, issued-by-department, issued-item detail, and spoilage/disposal sheets.

## Important deployment note

This is ready for:

- one desktop machine
- one LAN host
- one single Node server process with JSON storage
- one single Node server process with PostgreSQL storage

It is still not a multi-instance horizontally scaled SaaS backend. If you deploy multiple app instances, use PostgreSQL and add a proper production session/cache strategy before scaling out.
