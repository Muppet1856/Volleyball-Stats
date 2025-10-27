# Volleyball Stats Cloudflare Deployment Guide

[![GitHub Release](https://img.shields.io/github/v/release/Muppet1856/Volleyball-Stats)](https://github.com/Muppet1856/Volleyball-Stats/releases) [![GitHub License](https://img.shields.io/github/license/Muppet1856/Volleyball-Stats)](https://github.com/Muppet1856/Volleyball-Stats/blob/main/LICENSE) [![GitHub Issues or Pull Requests](https://img.shields.io/github/issues/Muppet1856/Volleyball-Stats)](https://github.com/Muppet1856/Volleyball-Stats/issues) <!-- PREVIEW_BADGE_START -->[![Preview](https://img.shields.io/badge/preview-codex-add-blank-file-deleteme-for-testing-purple?link=https://codex-add-blank-file-deleteme-for-testing-volleyball-stats.stoneyvolleyball.workers.dev)](https://codex-add-blank-file-deleteme-for-testing-volleyball-stats.stoneyvolleyball.workers.dev)<!-- PREVIEW_BADGE_END -->

This repository contains a Cloudflare Worker that serves a static single-page application from the `public/` directory and exposes a JSON API backed by a Cloudflare D1 database for managing volleyball players and matches.

## Table of contents
1. [Prerequisites](#prerequisites)
2. [Deploy from the Cloudflare dashboard](#deploy-from-the-cloudflare-dashboard)
3. [Provision and connect the D1 database in the dashboard](#provision-and-connect-the-d1-database-in-the-dashboard)
4. [Run migrations from the dashboard](#run-migrations-from-the-dashboard)
5. [Optional: Use Wrangler locally](#optional-use-wrangler-locally)
6. [API surface](#api-surface)

## Prerequisites

- A Cloudflare account with access to Workers and D1.
- A GitHub account if you plan to deploy via Cloudflare's Git integration.
- (Optional) Node.js 18+ and npm if you want to work with Wrangler locally.

Everything described below can be completed entirely from the Cloudflare and GitHub web UIs—Wrangler is strictly optional.

## Deploy from the Cloudflare dashboard

1. Push this repository to GitHub (either a public repo or a private repo connected to your Cloudflare account).
2. In the Cloudflare dashboard, go to **Workers & Pages → Overview → Create application → Pages**.
3. Choose **Connect to Git** and select the repository containing this project.
4. When prompted for the framework preset, choose **None**. Configure the following build settings:
   - **Build command**: leave blank (the project is already built).
   - **Build output directory**: `public`
5. Save the settings and allow Cloudflare to create the Pages project. Cloudflare will publish the static assets in `public/` and expose them at the assigned URL.【F:src/worker.js†L1-L19】

## Provision and connect the D1 database in the dashboard

1. In **Workers & Pages**, open your new Pages project and navigate to **Settings → Functions**.
2. Enable **Pages Functions**. Cloudflare will deploy the Worker in `src/worker.js`, which serves the static assets and routes API requests.【F:src/worker.js†L1-L35】
3. Scroll to **KV, Durable Object, and D1 bindings** and click **Add binding → D1 database**.
4. Select **Create a D1 database** and name it (for example, `volleyball-stats-db`). Cloudflare automatically creates and binds the database to your Pages project.
5. Set the binding name to `VOLLEYBALL_STATS_DB` so the Worker can reach it.【F:src/api/database.js†L1-L19】

## Run migrations from the dashboard

1. In the Pages project **Settings → Functions**, open the D1 database you created in the previous step.
2. Switch to the **Tables** tab and click **Import**.
3. Upload `migrations/0001_init.sql` to seed the schema. The SQL file creates the tables used by the API endpoints.【F:migrations/0001_init.sql†L1-L27】
4. After the import finishes, confirm the tables exist by browsing the schema view.

## Optional: Use Wrangler locally

If you prefer the CLI, you can still install and use Wrangler. Authenticate with `wrangler login`, bind the D1 database in `wrangler.toml`, and run `wrangler dev` or `wrangler deploy` as usual. The Worker expects the `VOLLEYBALL_STATS_DB` binding to point to a database that has run the migrations above.【F:src/api/database.js†L1-L19】

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
