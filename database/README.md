# Database Foundation

This project supports two storage modes:

- [server/store.js](/Users/mac/Downloads/sirro/kingsoft-stockflow-vscode/server/store.js)
- [data/kingsoft-stockflow.json](/Users/mac/Downloads/sirro/kingsoft-stockflow-vscode/data/kingsoft-stockflow.json)

How it works now:

- if `DATABASE_URL` is not set, the app uses the JSON-backed shared store
- if `DATABASE_URL` is set, the app automatically switches to PostgreSQL
- on first PostgreSQL startup against an empty database, the app seeds from the current JSON store when meaningful live data exists

## Target database

Recommended production database:

- PostgreSQL

Why PostgreSQL fits this app:

- good support for concurrent users
- strong transactional writes for movements and audit trail
- easy indexing for finance reports and history lookups
- easy managed hosting on Render, Railway, Neon, Supabase, Fly, and most VPS stacks

## Files

- [postgresql-schema.sql](/Users/mac/Downloads/sirro/kingsoft-stockflow-vscode/database/postgresql-schema.sql)
  The normalized schema for settings, departments, items, users, sessions, movements, and movement audit trail.

## Migration export

Generate SQL insert statements from the current JSON store:

```bash
npm run db:export:postgres
```

Optional arguments:

```bash
node scripts/export-postgres-seed.mjs --input ./data/kingsoft-stockflow.json --output ./database/postgresql-seed.sql
```

This export script:

- reads the current JSON-backed store
- normalizes values for PostgreSQL inserts
- preserves users, sessions, items, departments, movements, and audit trail

## Suggested cutover path

1. Create a PostgreSQL database.
2. Run [postgresql-schema.sql](/Users/mac/Downloads/sirro/kingsoft-stockflow-vscode/database/postgresql-schema.sql).
3. Generate a seed export with `npm run db:export:postgres`.
4. Import the generated SQL into PostgreSQL.
5. Set `DATABASE_URL` on the app server.
6. Optional: set `DATABASE_SSL=require` if your host requires SSL.
7. Retest:
   - sign-in
   - movement entry
   - requisition pages
   - item edits
   - imports
   - finance reports
   - audit trail

## Important note

This repo now includes a working PostgreSQL-backed store path.

What is done now:

- production-ready PostgreSQL schema design
- repeatable JSON-to-SQL export scaffolding
- PostgreSQL store adapter with automatic runtime switching when `DATABASE_URL` is present
- transaction-safe user/session writes

What still needs implementation:

- live end-to-end validation against a real hosted PostgreSQL database
- higher-efficiency incremental writes for very large datasets
- production backup and restore runbook
