# Free Online Deployment

Use Render Free for the app and Supabase Free for the database.

## 1. GitHub

The app source is pushed to:

```text
https://github.com/Samula-digital/kingsoft-stockflow
```

Real stock data is not committed. Online data must live in Supabase PostgreSQL.

## 2. Create Supabase Database

1. Open `https://supabase.com`.
2. Create a free project.
3. Go to `Project Settings -> Database`.
4. Copy the PostgreSQL connection string.
5. Use the pooled/session connection if Supabase offers one.
6. Replace `[YOUR-PASSWORD]` with your actual database password.

It should look similar to:

```text
postgresql://postgres.xxxxx:PASSWORD@aws-0-region.pooler.supabase.com:6543/postgres
```

## 3. Render Setup

Fast path:

[Deploy to Render](https://render.com/deploy?repo=https://github.com/Samula-digital/kingsoft-stockflow)

Manual path:

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

The included `render.yaml` uses Render Free and expects `DATABASE_URL`, so stock data is stored in Supabase instead of Render's temporary filesystem.

## 4. Required Environment

These are already in `render.yaml`, but confirm them in Render:

```text
NODE_ENV=production
HOST=0.0.0.0
PORT=4000
STOCKFLOW_SECURE_COOKIES=true
DATABASE_SSL=require
```

Then add this secret environment variable in Render:

```text
DATABASE_URL=your_supabase_connection_string
```

## 5. First Login Online

When the online app opens for the first time, create the first admin account from the sign-in page. After that:

- Admin approves or creates users.
- Store keeper records movements.
- Finance signs in to review reports.

The server automatically creates the required tables.

## 6. Current LAN Fallback

Until the Render deployment is live, keep using:

```text
http://192.168.43.207:4000
```

This works only while this Mac is awake and on the same network.
