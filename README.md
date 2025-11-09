# Volleyball Stats Cloudflare Deployment Guide

[![GitHub Release](https://img.shields.io/github/v/release/Muppet1856/Volleyball-Stats)](https://github.com/Muppet1856/Volleyball-Stats/releases) [![GitHub License](https://img.shields.io/github/license/Muppet1856/Volleyball-Stats)](https://github.com/Muppet1856/Volleyball-Stats/blob/main/LICENSE) [![GitHub Issues or Pull Requests](https://img.shields.io/github/issues/Muppet1856/Volleyball-Stats)](https://github.com/Muppet1856/Volleyball-Stats/issues)

This repository contains a Cloudflare Worker that serves a static single-page application from the `public/` directory and exposes a JSON API backed by a Cloudflare Durable Object with SQLite storage for managing volleyball players and matches.

## Table of contents
1. [Prerequisites](#prerequisites)
2. [Deploy from the Cloudflare dashboard](#deploy-from-the-cloudflare-dashboard)
3. [Bind the Durable Object in the dashboard](#bind-the-durable-object-in-the-dashboard)
4. [Run migrations for the Durable Object](#run-migrations-for-the-durable-object)
5. [Optional: Use Wrangler locally](#optional-use-wrangler-locally)
6. [API surface](#api-surface)

## Prerequisites

- A Cloudflare account with access to Workers and Durable Objects.
- A GitHub account if you plan to deploy via Cloudflare's Git integration.
- (Optional) Node.js 18+ and npm if you want to work with Wrangler locally.

Most setup happens in the Cloudflare and GitHub web UIs, but Wrangler is required to run the SQLite migrations for the Durable Object.

## Deploy from the Cloudflare dashboard

1. Push this repository to GitHub (either a public repo or a private repo connected to your Cloudflare account).
2. In the Cloudflare dashboard, go to **Workers & Pages → Overview → Create application → Pages**.
3. Choose **Connect to Git** and select the repository containing this project.
4. When prompted for the framework preset, choose **None**. Configure the following build settings:
   - **Build command**: leave blank (the project is already built).
   - **Build output directory**: `public`
5. Save the settings and allow Cloudflare to create the Pages project. Cloudflare will publish the static assets in `public/` and expose them at the assigned URL.【F:src/index.js†L1-L40】

## Bind the Durable Object in the dashboard

1. In **Workers & Pages**, open your new Pages project and navigate to **Settings → Functions**.
2. Enable **Pages Functions**. Cloudflare will deploy the Worker in `src/index.js`, which serves the static assets and routes API requests.【F:src/index.js†L1-L40】
3. Scroll to **KV, Durable Object, and D1 bindings** and click **Add binding → Durable Object**.
4. Choose **Existing Durable Object** and enter `StatsDatabase` for the class name.
5. Set the binding name to `STATS_DB_DO`. Wrangler will provision the underlying SQLite storage when you run the migrations in the next section.【F:src/api/database.js†L1-L20】【F:wrangler.toml†L8-L14】

## Run migrations for the Durable Object

1. From your local checkout, install dependencies with `npm install` if you have not already.
2. Authenticate with Cloudflare by running `npx wrangler login`.
3. Apply the migrations so Cloudflare allocates SQLite storage for the Durable Object and initializes the schema: `npx wrangler migrations apply volleyball-stats`. This command uploads the SQL files in `migrations/` and runs them against the Durable Object's SQLite database.【F:migrations/0001_init.sql†L1-L33】【F:wrangler.toml†L8-L14】
4. You can confirm the schema exists by connecting with `npx wrangler d1 execute volleyball-stats --command "SELECT name FROM sqlite_master WHERE type='table';"`.

## Optional: Use Wrangler locally

If you prefer the CLI, you can still install and use Wrangler. Authenticate with `wrangler login`, ensure the Durable Object binding from `wrangler.toml` is present, and run `wrangler dev` or `wrangler deploy` as usual. The Worker expects the `STATS_DB_DO` binding (or another D1-compatible binding) to expose a `prepare()` method and point to a database that has run the migrations above.【F:src/api/database.js†L1-L20】【F:wrangler.toml†L8-L14】

## API surface

The Worker exposes REST-style endpoints for matches and players. All routes return JSON and require the Durable Object or D1-compatible database binding configured above.

- `GET /api/matches` — list matches ordered by date/opponent.【F:src/api/matches.js†L1-L45】
- `POST /api/matches` — create a match (expects JSON payload).【F:src/api/matches.js†L1-L79】
- `GET /api/matches/:id` — fetch a single match.【F:src/api/matches.js†L81-L115】
- `PUT /api/matches/:id` — update a match.【F:src/api/matches.js†L117-L166】
- `DELETE /api/matches/:id` — remove a match.【F:src/api/matches.js†L168-L191】
- `GET /api/players` — list players ordered by jersey number and name.【F:src/api/players.js†L1-L36】
- `POST /api/players` — create a player (number and last name required).【F:src/api/players.js†L38-L75】
- `PUT /api/players/:id` — update a player.【F:src/api/players.js†L77-L112】
- `DELETE /api/players/:id` — delete a player.【F:src/api/players.js†L114-L135】

Static assets are served for any non-API path by Cloudflare's asset handler, so the frontend in `public/` receives all other requests.【F:src/index.js†L1-L40】

With these steps, you can provision the required Cloudflare resources, run the application locally, and publish the Worker with its Durable Object backing store.
