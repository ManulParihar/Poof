# Deploy the Poof indexer to Railway

The **only** backend service is the Rust `poof-indexer` (RPC poller + read API).
Railway builds it from the repo-root `Dockerfile`; `railway.json` (repo root) pins
the builder, health check, and restart policy. `.dockerignore` already strips the
app, circuits, and other workspace members so only the Rust crates are sent.

## One-time setup

1. **Create the service** — point Railway at this GitHub repo (root directory `/`).
   It auto-detects `railway.json` + `Dockerfile`, no Nixpacks involved.

   ```bash
   # or via CLI, from the repo root:
   railway init
   railway up
   ```

2. **Add a persistent Volume** for the SQLite DB (the DB lives outside the image so
   it survives redeploys). In the service → **Variables/Volumes** → New Volume,
   mount path:

   ```
   /data
   ```

   This matches `POOF_DB_PATH=/data/poof-indexer.db` below.

3. **Set environment variables** (service → Variables):

   | Variable            | Value                                                                   | Notes |
   | ------------------- | ----------------------------------------------------------------------- | ----- |
   | `POOF_CONTRACT_ID`  | `CDVNLQYWDDH4BJQJBIOWW2CJELVR62FGGVPQN3ZMUNS7PUCIWH3SBLPN`               | Required for live ingest (see `deploy/addresses.json`). Without it, the API serves read-only. |
   | `POOF_DB_PATH`      | `/data/poof-indexer.db`                                                  | Must sit on the mounted volume. |
   | `POOF_RPC_URL`      | `https://soroban-testnet.stellar.org`                                   | Soroban testnet RPC. |
   | `POOF_POLL_SECS`    | `5`                                                                     | Poll interval. |
   | `POOF_FINALITY_LAG` | `5`                                                                     | Confirmations before ingest. |
   | `RUST_LOG`          | `info`                                                                  | Log level. |

   **Do not set `POOF_BIND`.** Railway injects `PORT` and the indexer now binds to
   `0.0.0.0:$PORT` automatically (see `indexer/src/main.rs`). Setting `POOF_BIND`
   would override that and break Railway's routing.

4. **Generate a public domain** (service → Settings → Networking → Generate Domain).
   Railway routes HTTPS traffic to the detected port.

## Health check

`railway.json` health-checks `GET /health`, which returns
`{status, commitments, nullifiers, checkpoint}` with `200` once the store is up.

## Point the frontend at it

Set the app's indexer base URL to the generated Railway domain, e.g.
`https://<service>.up.railway.app` (used by the client scanner for
`/notes`, `/nullifiers`, `/tree/root`).

## Redeploys

Pushing to the tracked branch triggers a rebuild. The `/data` volume (SQLite DB)
persists across deploys, so ingest resumes from the last checkpoint.
