# Volleyball Stats Cloudflare Deployment Guide

This repository contains a Cloudflare Worker that serves a static single-page application from the `public/` directory and exposes a JSON API backed by a Cloudflare D1 database for managing volleyball players and matches.【F:src/worker.js†L1-L35】【F:src/api/database.js†L1-L19】【F:migrations/0001_init.sql†L1-L27】

## Table of contents
1. [Prerequisites](#prerequisites)
2. [Install Wrangler](#install-wrangler)
3. [Configure Cloudflare credentials](#configure-cloudflare-credentials)
   1. [Use `wrangler login`](#use-wrangler-login)
   2. [Create an API token manually](#create-an-api-token-manually)
   3. [Locate your Account ID](#locate-your-account-id)
4. [Create the D1 database](#create-the-d1-database)
5. [Bind the database to the Worker](#bind-the-database-to-the-worker)
6. [Run database migrations](#run-database-migrations)
7. [Develop and test locally](#develop-and-test-locally)
8. [Deploy to Cloudflare](#deploy-to-cloudflare)
9. [API surface](#api-surface)

## Prerequisites

- A Cloudflare account with access to Workers and D1.
- Node.js 18+ and npm installed locally (Wrangler requires a modern Node.js runtime).
- Git, so you can clone this repository.

## Install Wrangler

Wrangler is Cloudflare's CLI for Workers and D1. Install it globally or add it as a development dependency:

```bash
# Global install
npm install -g wrangler

# Or as a project dependency (inside this repo)
npm install --save-dev wrangler
```

Verify installation with `wrangler --version`.

## Configure Cloudflare credentials

Wrangler needs permission to access your Cloudflare account. You can authenticate automatically with your browser or supply an API token manually.

### Use `wrangler login`

Run the following command and follow the prompts in your browser. Wrangler will request the permissions it needs and store the resulting credentials locally.

```bash
wrangler login
```

This method is the simplest path if you have interactive browser access.

### Create an API token manually

If you cannot use `wrangler login`, create a token in the Cloudflare dashboard:

1. Sign in to the Cloudflare dashboard and open **My Profile → API Tokens**.
2. Click **Create Token** and start from the **Edit Cloudflare Workers** template.
3. Ensure the token has at least the following permissions: `Account.Workers Scripts`, `Account.Durable Objects`, and `Account.D1` for the account that will host this Worker.
4. Create the token and copy it. Store it securely—you will not be able to view it again.
5. Configure Wrangler to use the token by setting the environment variables:
   ```bash
   export CLOUDFLARE_API_TOKEN=your_token_value
   export CLOUDFLARE_ACCOUNT_ID=your_account_id
   ```

Wrangler will read these environment variables when you run commands such as `wrangler deploy`.

### Locate your Account ID

You can retrieve your account ID in several ways:

- In the Cloudflare dashboard, go to **Workers & Pages → Overview**. Your Account ID is displayed in the right-hand column.
- From the CLI, run `wrangler whoami` after authenticating. The command prints the active account and its ID.

You will need the Account ID for both API token creation and for `wrangler` commands when credentials are supplied manually.

## Create the D1 database

Use Wrangler to provision a new D1 database. Replace `volleyball-stats-db` with a unique name if necessary.

```bash
wrangler d1 create volleyball-stats-db
```

The command prints the database UUID and name—copy both. Wrangler also offers to add the binding directly to your `wrangler.toml`. If you accept, it will append a `[[d1_databases]]` section automatically.

## Bind the database to the Worker

The Worker reads its D1 binding from the `VOLLEYBALL_STATS_DB` environment variable (and falls back to other common names).【F:src/api/database.js†L1-L19】 Update `wrangler.toml` so the Worker can reach the database:

```toml
name = "volleyball-stats"
main = "src/worker.js"
compatibility_date = "2024-04-03"
assets = { directory = "public" }

[[d1_databases]]
binding = "VOLLEYBALL_STATS_DB"
database_name = "volleyball-stats-db"
database_id = "<uuid-returned-by-wrangler>"
```

Commit the configuration so your teammates deploy with the correct binding.

## Run database migrations

The `migrations/` directory holds the schema used by the API.【F:migrations/0001_init.sql†L1-L27】 Apply it to your database before serving traffic:

```bash
wrangler d1 migrations apply volleyball-stats-db --local
# Inspect the tables if desired
wrangler d1 execute volleyball-stats-db --command "SELECT name FROM sqlite_master WHERE type='table';"
```

Omit `--local` to run the migrations against the remote database. Re-run the command whenever you add new migration files.

## Develop and test locally

Wrangler can emulate the Worker, static assets, and D1 database on your machine.

```bash
wrangler dev --local
```

The local server watches `src/worker.js`, the API modules under `src/api/`, and the static files in `public/`. Interact with the JSON API at `http://localhost:8787/api/...` while editing the frontend.

## Deploy to Cloudflare

Once the credentials, D1 binding, and migrations are in place, deploy the Worker:

```bash
wrangler deploy
```

Wrangler uploads the Worker script (`src/worker.js`), publishes the static assets from `public/`, and attaches the `VOLLEYBALL_STATS_DB` binding so the API can reach Cloudflare D1.【F:src/worker.js†L1-L35】【F:src/api/database.js†L1-L19】 The command output includes the production URL and the preview URL.

## API surface

The Worker exposes REST-style endpoints for matches and players. All routes return JSON and require the D1 database binding configured above.

- `GET /api/matches` — list matches ordered by date/opponent.【F:src/api/matches.js†L1-L45】
- `POST /api/matches` — create a match (expects JSON payload).【F:src/api/matches.js†L1-L79】
- `GET /api/matches/:id` — fetch a single match.【F:src/api/matches.js†L81-L115】
- `PUT /api/matches/:id` — update a match.【F:src/api/matches.js†L117-L166】
- `DELETE /api/matches/:id` — remove a match.【F:src/api/matches.js†L168-L191】
- `GET /api/players` — list players ordered by jersey number and name.【F:src/api/players.js†L1-L36】
- `POST /api/players` — create a player (number and last name required).【F:src/api/players.js†L38-L75】
- `PUT /api/players/:id` — update a player.【F:src/api/players.js†L77-L112】
- `DELETE /api/players/:id` — delete a player.【F:src/api/players.js†L114-L135】

Static assets are served for any non-API path by Cloudflare's asset handler, so the frontend in `public/` receives all other requests.【F:src/worker.js†L1-L19】

With these steps, you can provision the required Cloudflare resources, run the application locally, and publish the Worker with its D1 backing store.
