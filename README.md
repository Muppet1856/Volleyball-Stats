# Volleyball Stats

[![GitHub Release](https://img.shields.io/github/v/release/Muppet1856/Volleyball-Stats)](https://github.com/Muppet1856/Volleyball-Stats/releases) [![GitHub License](https://img.shields.io/github/license/Muppet1856/Volleyball-Stats)](https://github.com/Muppet1856/Volleyball-Stats/blob/main/LICENSE) [![GitHub Issues or Pull Requests](https://img.shields.io/github/issues/Muppet1856/Volleyball-Stats)](https://github.com/Muppet1856/Volleyball-Stats/issues)

Volleyball Stats is a Cloudflare Worker that serves a single-page scouting app and provides a JSON API for capturing match, set, and player information. The Worker persists data inside a Durable Object that exposes SQLite storage, so the application can run without an external database while still supporting transactional updates.【F:src/index.ts†L17-L159】【F:src/utils/init.ts†L1-L83】

## Features
- **Server-rendered static assets.** Requests for non-API routes are served from the `public/` directory through the Worker, allowing the built frontend to run alongside the API on the same origin.【F:src/index.ts†L165-L207】
- **Durable Object data store.** The `MatchState` Durable Object initializes and maintains the SQLite tables for matches, players, and sets when it is first instantiated, ensuring schema migrations happen automatically at runtime.【F:src/index.ts†L17-L159】【F:src/utils/init.ts†L1-L83】
- **Comprehensive JSON API.** REST-style endpoints exist for creating, updating, and deleting matches, players, and sets, as well as querying the current configuration for the frontend.【F:src/index.ts†L48-L206】【F:src/api/match.ts†L40-L211】【F:src/api/player.ts†L4-L85】【F:src/api/set.ts†L128-L255】
- **Configurable home team.** The Worker reads the `HOME_TEAM` variable to brand the UI and API responses without code changes.【F:src/index.ts†L185-L191】【F:wrangler.toml†L9-L16】【F:cloudflare/vars.json†L1-L4】

## Project structure
| Path | Description |
| --- | --- |
| `public/` | Pre-built static assets for the scouting SPA served directly by the Worker.【F:src/index.ts†L175-L183】 |
| `src/index.ts` | Worker entry point that handles asset delivery, `/api/config`, and routes other API traffic to the Durable Object.【F:src/index.ts†L165-L207】 |
| `src/api/` | Handlers for match, player, and set CRUD operations executed inside the Durable Object.【F:src/index.ts†L48-L206】【F:src/api/match.ts†L40-L211】【F:src/api/player.ts†L4-L85】【F:src/api/set.ts†L128-L255】 |
| `src/utils/` | Helper modules for bootstrapping the SQLite schema and returning consistent HTTP responses.【F:src/utils/init.ts†L1-L83】【F:src/utils/responses.ts†L1-L35】 |
| `cloudflare/vars.json` | Example variable file for dashboard deployments that mirrors the defaults in `wrangler.toml`.【F:cloudflare/vars.json†L1-L4】【F:wrangler.toml†L9-L16】 |
| `wrangler.toml` | Wrangler configuration defining the Durable Object, asset binding, variables, and migrations.【F:wrangler.toml†L1-L20】 |

## Prerequisites
- Cloudflare account with access to Workers and Durable Objects.
- Node.js 18 or later.
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) 3.0+, installed globally (`npm install -g wrangler`) or run ad-hoc with `npx wrangler`.

## Local development
1. Clone the repository and install Wrangler if you have not already.
2. Log in to Cloudflare with `wrangler login`.
3. Start the Worker locally with Durable Object persistence:
   ```bash
   wrangler dev --persist-to=.wrangler/state
   ```
   Wrangler binds the static assets, Durable Object class, and variables as defined in `wrangler.toml`, so the API and frontend are available at the printed dev URL.【F:wrangler.toml†L1-L20】【F:src/index.ts†L165-L207】
4. Seed test data by calling the API (for example, `curl http://127.0.0.1:8787/api/match/create -d '{"opponent":"Sample"}' -H 'content-type: application/json'`).

## Deployment
1. Ensure your Cloudflare account has Durable Objects enabled.
2. Publish the Worker and apply the SQLite migration for the `MatchState` class:
   ```bash
   wrangler deploy --migrations
   ```
3. (Optional) Use `cloudflare/vars.json` as a reference for setting dashboard variables if you manage configuration in the Cloudflare UI.【F:cloudflare/vars.json†L1-L4】【F:wrangler.toml†L9-L16】

## API reference
All endpoints reside under `/api/` and return JSON unless noted.

### Configuration
- `GET /api/config` – Fetches environment-specific settings (currently the configured `HOME_TEAM`).【F:src/index.ts†L185-L191】

### Matches
- `POST /api/match/create` – Create a match row with initial metadata.【F:src/index.ts†L55-L73】【F:src/api/match.ts†L40-L71】
- `POST /api/match/set-location` – Update the match location.【F:src/index.ts†L55-L62】【F:src/api/match.ts†L74-L84】
- `POST /api/match/set-date-time` – Update the match date/time string.【F:src/index.ts†L55-L64】【F:src/api/match.ts†L86-L96】
- `POST /api/match/set-opp-name` – Update the opponent name.【F:src/index.ts†L55-L67】【F:src/api/match.ts†L98-L108】
- `POST /api/match/set-type` – Update the match type metadata payload.【F:src/index.ts†L55-L70】【F:src/api/match.ts†L110-L120】
- `POST /api/match/set-result` – Store the win/loss result.【F:src/index.ts†L55-L73】【F:src/api/match.ts†L122-L132】
- `POST /api/match/set-players` – Persist the list of participating players.【F:src/index.ts†L55-L76】【F:src/api/match.ts†L134-L144】
- `POST /api/match/set-home-color` – Update the home jersey color metadata.【F:src/index.ts†L55-L78】【F:src/api/match.ts†L158-L168】
- `POST /api/match/set-opp-color` – Update the opponent jersey color metadata.【F:src/index.ts†L55-L82】【F:src/api/match.ts†L170-L180】
- `POST /api/match/set-first-server` – Track which team served first.【F:src/index.ts†L55-L85】【F:src/api/match.ts†L182-L192】
- `POST /api/match/set-deleted` – Toggle the soft-delete flag.【F:src/index.ts†L55-L88】【F:src/api/match.ts†L146-L156】
- `GET /api/match` – List all matches.【F:src/index.ts†L55-L91】【F:src/api/match.ts†L194-L199】
- `DELETE /api/match/delete/:id` – Remove a match permanently.【F:src/index.ts†L55-L93】【F:src/api/match.ts†L201-L211】

### Players
- `POST /api/player/create` – Create a player entry.【F:src/index.ts†L96-L99】【F:src/api/player.ts†L4-L23】
- `POST /api/player/set-lname` – Update the player’s last name.【F:src/index.ts†L96-L103】【F:src/api/player.ts†L25-L35】
- `POST /api/player/set-fname` – Update the player’s first-initial field.【F:src/index.ts†L96-L105】【F:src/api/player.ts†L37-L47】
- `POST /api/player/set-number` – Change the jersey number.【F:src/index.ts†L96-L107】【F:src/api/player.ts†L49-L59】
- `GET /api/player/get/:id` – Fetch a single player.【F:src/index.ts†L96-L109】【F:src/api/player.ts†L61-L66】
- `GET /api/player` – List all players.【F:src/index.ts†L96-L111】【F:src/api/player.ts†L68-L73】
- `DELETE /api/player/delete/:id` – Delete a player.【F:src/index.ts†L96-L114】【F:src/api/player.ts†L75-L85】

### Sets
- `POST /api/set/create` – Create a set for a match with scores and timeouts.【F:src/index.ts†L117-L120】【F:src/api/set.ts†L128-L161】
- `POST /api/set/set-home-score` – Update the home score for a set.【F:src/index.ts†L117-L123】【F:src/api/set.ts†L164-L173】
- `POST /api/set/set-opp-score` – Update the opponent score for a set.【F:src/index.ts†L117-L125】【F:src/api/set.ts†L175-L183】
- `POST /api/set/set-home-timeout` – Toggle a home timeout usage flag.【F:src/index.ts†L117-L128】【F:src/api/set.ts†L186-L197】
- `POST /api/set/set-opp-timeout` – Toggle an opponent timeout usage flag.【F:src/index.ts†L117-L131】【F:src/api/set.ts†L199-L209】
- `POST /api/set/set-is-final` – Persist which sets are finalized for a match.【F:src/index.ts†L117-L135】【F:src/api/set.ts†L212-L223】
- `GET /api/set/get/:id` – Retrieve a single set.【F:src/index.ts†L117-L137】【F:src/api/set.ts†L225-L230】
- `GET /api/set?matchId=ID` – Retrieve sets for a match (or all sets when omitted).【F:src/index.ts†L117-L142】【F:src/api/set.ts†L232-L243】
- `DELETE /api/set/delete/:id` – Delete a set.【F:src/index.ts†L117-L144】【F:src/api/set.ts†L245-L255】

## Configuration
| Variable | Purpose | Default |
| --- | --- | --- |
| `HOME_TEAM` | Text displayed in `/api/config` and used by the frontend. | `Stoney Creek` |【F:src/index.ts†L185-L191】【F:wrangler.toml†L9-L16】【F:cloudflare/vars.json†L1-L4】
| `debug` | Enables verbose logging when set to `"true"`. | `true` |【F:src/index.ts†L25-L39】【F:wrangler.toml†L9-L16】

Set these values either in `wrangler.toml`, the Cloudflare dashboard, or via environment-specific configuration files during deployment.

## Manual QA
Follow these steps to verify that the score modal zero-fills the opposing side when only one score is edited for an empty set:

1. Start the Worker locally with `wrangler dev --persist-to=.wrangler/state` and open the scouting UI.
2. Click the score cell for an empty set (both home and opponent blank) to open the modal.
3. Increase the score for only one team using the modal controls.
4. Close the modal and observe the grid—the untouched side of the set now reads `0`, matching the modal logic.

## License
Distributed under the MIT License. See [`LICENSE`](LICENSE) for details.
