Render automated deploy setup
===========================

1. Connect this GitHub repository to your Render account (or create a new service) using the `render.yaml` already in the repo.

2. Obtain these two values from Render:
   - `RENDER_API_KEY` — your Render API key (create one at https://dashboard.render.com/account/api-keys)
   - `RENDER_SERVICE_ID` — the service id for your created web service (from the service URL or Render dashboard)

3. Add both values to the repository secrets on GitHub: `Settings → Secrets and variables → Actions`.

4. Push to `main`. The `build-and-deploy` workflow will run and trigger a Render deploy via the API.

Notes
-----
- If you prefer, you can simply connect the repo directly in the Render UI; Render will auto-deploy on each push without needing the API key.
- For production use set `DATABASE_URL` (and `DATABASE_SSL` if required) in the Render service environment.
- Ensure `STOCKFLOW_DATA_DIR=/data` and `STOCKFLOW_SECURE_COOKIES=true` are set in Render service environment variables.
