# Online Deployment

Use Render for the fastest production-like launch.

## 1. GitHub

The app source is pushed to:

```text
https://github.com/Samula-digital/kingsoft-stockflow
```

Real stock data is not committed. Online data lives on the server disk or in PostgreSQL.

## 2. Render Setup

1. Open Render and choose `New -> Blueprint`.
2. Connect the GitHub repository above.
3. Select the `main` branch.
4. Render will read `render.yaml`.
5. Deploy.

The app uses:

```text
Build Command: npm ci && npm run build
Start Command: npm run start
Health Check: /api/health
```

The included `render.yaml` also mounts a persistent disk at `/data`, so the JSON-backed database survives restarts and redeploys.

## 3. Required Environment

These are already in `render.yaml`, but confirm them in Render:

```text
NODE_ENV=production
HOST=0.0.0.0
PORT=4000
STOCKFLOW_SECURE_COOKIES=true
STOCKFLOW_DATA_DIR=/data
```

## 4. First Login Online

When the online app opens for the first time, create the first admin account from the sign-in page. After that:

- Admin approves or creates users.
- Store keeper records movements.
- Finance signs in to review reports.

## 5. Optional PostgreSQL Upgrade

For heavier long-term online use, add a PostgreSQL database and set:

```text
DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/DBNAME
DATABASE_SSL=require
```

The server automatically creates the required tables.

## 6. Current LAN Fallback

Until the Render deployment is live, keep using:

```text
http://192.168.43.207:4000
```

This works only while this Mac is awake and on the same network.
