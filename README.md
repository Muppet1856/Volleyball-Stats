# Volleyball Stats Cloudflare Deployment Guide

 [![GitHub Release](https://img.shields.io/github/v/release/Muppet1856/Volleyball-Stats)](https://github.com/Muppet1856/Volleyball-Stats/releases) [![GitHub License](https://img.shields.io/github/license/Muppet1856/Volleyball-Stats)](https://github.com/Muppet1856/Volleyball-Stats/blob/main/LICENSE) [![GitHub Issues or Pull Requests](https://img.shields.io/github/issues/Muppet1856/Volleyball-Stats)](https://github.com/Muppet1856/Volleyball-Stats/issues) <!-- PREVIEW_BADGE_START -->[![preview](https://img.shields.io/badge/preview-production-purple?label=preview)](https://volleyball-stats.stoneyvolleyball.workers.dev)<!-- PREVIEW_BADGE_END -->

This repository contains a Cloudflare Worker that serves a static single-page application from the `public/` directory and exposes a JSON API backed by a Cloudflare Durable Object for managing volleyball players and matches.【F:src/index.js†L1-L39】【F:src/durable/volleyball-stats.js†L1-L209】

## Table of contents
1. [Prerequisites](#prerequisites)
2. [Deploy from the Cloudflare dashboard](#deploy-from-the-cloudflare-dashboard)
3. [Provision and connect the Durable Object in the dashboard](#provision-and-connect-the-durable-object-in-the-dashboard)
4. [Optional: Use Wrangler locally](#optional-use-wrangler-locally)
5. [API surface](#api-surface)

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
5. Save the settings and allow Cloudflare to create the Pages project. Cloudflare will publish the static assets in `public/` and expose them at the assigned URL.【F:src/index.js†L1-L32】

## Provision and connect the Durable Object in the dashboard

1. In **Workers & Pages**, open your new Pages project and navigate to **Settings → Functions**.
2. Enable **Pages Functions**. Cloudflare will deploy the Worker in `src/index.js`, which serves the static assets, routes API requests, and exports the Durable Object class.【F:src/index.js†L1-L41】
3. Scroll to **KV, Durable Object, and D1 bindings** and click **Add binding → Durable Object**.
4. Choose **Create new** and set the **Class name** to `VolleyballStatsDurableObject` with the **Binding name** `VOLLEYBALL_STATS_DO`. Cloudflare automatically provisions the Durable Object namespace and binds it to your project.【F:src/index.js†L33-L41】【F:src/durable/volleyball-stats.js†L1-L209】
5. Deploy the Worker to persist the Durable Object namespace. The Durable Object automatically stores matches and players in its internal state—no SQL migrations are required.【F:src/durable/volleyball-stats.js†L1-L209】

## Optional: Use Wrangler locally

If you prefer the CLI, you can still install and use Wrangler. Authenticate with `wrangler login`, bind the Durable Object in `wrangler.toml`, and run `wrangler dev` or `wrangler deploy` as usual. The Worker expects the `VOLLEYBALL_STATS_DO` binding to map to the namespace created in the previous section.【F:src/api/storage.js†L1-L44】【F:src/durable/volleyball-stats.js†L1-L209】

## API surface

The Worker exposes REST-style endpoints for matches and players. All routes return JSON and persist through the Durable Object binding configured above.

- `GET /api/matches` — list matches ordered by date/opponent.【F:src/api/matches.js†L1-L43】【F:src/durable/volleyball-stats.js†L64-L123】
- `POST /api/matches` — create a match (expects JSON payload).【F:src/api/matches.js†L45-L84】【F:src/durable/volleyball-stats.js†L125-L157】
- `GET /api/matches/:id` — fetch a single match.【F:src/api/matches.js†L86-L104】【F:src/durable/volleyball-stats.js†L105-L147】
- `PUT /api/matches/:id` — update a match.【F:src/api/matches.js†L106-L153】【F:src/durable/volleyball-stats.js†L145-L173】
- `DELETE /api/matches/:id` — remove a match.【F:src/api/matches.js†L155-L188】【F:src/durable/volleyball-stats.js†L175-L209】
- `GET /api/players` — list players ordered by jersey number and name.【F:src/api/players.js†L1-L33】【F:src/durable/volleyball-stats.js†L64-L209】
- `POST /api/players` — create a player (number and last name required).【F:src/api/players.js†L35-L79】【F:src/durable/volleyball-stats.js†L181-L209】
- `PUT /api/players/:id` — update a player.【F:src/api/players.js†L81-L120】【F:src/durable/volleyball-stats.js†L193-L209】
- `DELETE /api/players/:id` — delete a player.【F:src/api/players.js†L122-L145】【F:src/durable/volleyball-stats.js†L201-L209】

Static assets are served for any non-API path by Cloudflare's asset handler, so the frontend in `public/` receives all other requests.【F:src/index.js†L1-L32】

With these steps, you can provision the required Cloudflare resources, run the application locally, and publish the Worker with its Durable Object backing store.
