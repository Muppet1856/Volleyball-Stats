# Volleyball Stats Cloudflare Deployment Guide

[![GitHub Release](https://img.shields.io/github/v/release/Muppet1856/Volleyball-Stats)](https://github.com/Muppet1856/Volleyball-Stats/releases) [![GitHub License](https://img.shields.io/github/license/Muppet1856/Volleyball-Stats)](https://github.com/Muppet1856/Volleyball-Stats/blob/main/LICENSE) [![GitHub Issues or Pull Requests](https://img.shields.io/github/issues/Muppet1856/Volleyball-Stats)](https://github.com/Muppet1856/Volleyball-Stats/issues)

This repository contains a Cloudflare Worker that serves a static single-page application from the `public/` directory and exposes a JSON API coordinated through a Cloudflare Durable Object for managing volleyball players and matches. The Durable Object centralises all reads and writes through a small helper (`getMatchStore` in `src/api/match-store.js`) so the Worker only ever talks to a single binding.

## Table of contents
1. [Prerequisites](#prerequisites)
2. [Deploy from the Cloudflare dashboard](#deploy-from-the-cloudflare-dashboard)
3. [Bind and migrate the MatchStore Durable Object](#bind-and-migrate-the-matchstore-durable-object)
4. [Optional: Use Wrangler locally](#optional-use-wrangler-locally)
5. [Manage the MatchStore Durable Object](#manage-the-matchstore-durable-object)
6. [API surface](#api-surface)

## Prerequisites

- A Cloudflare account with access to Workers and Durable Objects.
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
5. Save the settings and allow Cloudflare to create the Pages project. Cloudflare will publish the static assets in `public/` and expose them at the assigned URL.【F:src/index.js†L1-L63】

## Bind and migrate the MatchStore Durable Object

1. In **Workers & Pages**, open your new Pages project and navigate to **Settings → Functions**.
2. Enable **Pages Functions**. Cloudflare will deploy the Worker entrypoint in `src/index.js`, which serves static assets and routes API requests through the Durable Object helper.【F:src/index.js†L1-L63】【F:src/api/match-store.js†L1-L15】
3. Scroll to **KV, Durable Object, and D1 bindings** and click **Add binding → Durable Object namespace**.
4. Choose **Create a new namespace**, set the class name to `MatchStore`, and save the binding.
5. Set the binding name to `MATCH_STORE` so the Worker can reach it during requests. The Worker always obtains instances through the `getMatchStore` helper, so no additional bindings (like `VOLLEYBALL_STATS_DB`) are required.【F:src/api/match-store.js†L1-L15】
6. Run the Durable Object migration once so Cloudflare registers the `MatchStore` class. If you primarily use the dashboard, complete this step locally:
   1. Install [Wrangler](https://developers.cloudflare.com/workers/wrangler/install-and-update/) and run `wrangler login`.
   2. Execute `wrangler deploy --minify`. This applies the migration defined in `wrangler.toml` (`tag = "v1"`) that creates the `MatchStore` class without requiring any SQL files.【F:wrangler.toml†L1-L16】
   3. Subsequent deployments from Pages automatically reuse the existing namespace.

## Optional: Use Wrangler locally

If you prefer the CLI, you can still install and use Wrangler. Authenticate with `wrangler login`, ensure the Durable Object migration has been applied (see the previous section), and run `wrangler dev` or `wrangler deploy` as usual. The Worker expects the `MATCH_STORE` binding defined in `wrangler.toml` to resolve to the Durable Object that manages match data via the `getMatchStore` helper.【F:wrangler.toml†L1-L16】【F:src/api/match-store.js†L1-L15】

## Manage the MatchStore Durable Object

The Durable Object keeps all match and player records in its own transactional storage. Because the implementation no longer uses D1 SQL migrations, the legacy `.sql` migration files have been removed—they are obsolete once the Durable Object implementation is live.

- **Inspect state:** Use Wrangler's Durable Object inspector. Run `wrangler do namespaces list` to locate the namespace, then `wrangler do storage get --namespace-id <id> --key global-match-store` to read the stored data for the default object name (`global-match-store`).
- **Reset state:** Run `wrangler do storage delete --namespace-id <id> --key global-match-store` to clear the Durable Object's storage, or delete the namespace from the Cloudflare dashboard to start fresh. The next request will recreate the object using `getMatchStore`.
- **Create additional objects:** If you want multiple logical stores, call `getMatchStore(env, '<custom-name>')` with a different name. Wrangler commands can target those instances by substituting the corresponding key when inspecting or resetting storage.【F:src/api/match-store.js†L1-L15】

## API surface

The Worker exposes REST-style endpoints for matches and players. All routes return JSON and require the `MATCH_STORE` binding configured above so that requests can reach the MatchStore Durable Object.

- `GET /api/matches` — list matches ordered by date/opponent.【F:src/api/matches.js†L1-L36】
- `POST /api/matches` — create a match (expects JSON payload).【F:src/api/matches.js†L39-L55】
- `GET /api/matches/:id` — fetch a single match.【F:src/api/matches.js†L57-L72】
- `PUT /api/matches/:id` — update a match.【F:src/api/matches.js†L74-L92】
- `DELETE /api/matches/:id` — remove a match.【F:src/api/matches.js†L94-L102】
- `GET /api/players` — list players ordered by jersey number and name.【F:src/api/players.js†L1-L33】
- `POST /api/players` — create a player (number and last name required).【F:src/api/players.js†L36-L63】
- `PUT /api/players/:id` — update a player.【F:src/api/players.js†L65-L93】
- `DELETE /api/players/:id` — delete a player.【F:src/api/players.js†L95-L102】

Static assets are served for any non-API path by Cloudflare's asset handler, so the frontend in `public/` receives all other requests.【F:src/index.js†L1-L63】

With these steps, you can provision the required Cloudflare resources, run the application locally, and publish the Worker with its MatchStore Durable Object backing store.
