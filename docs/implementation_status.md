# Durable Object transition plan status

This document captures the current repository state against the intended Durable Object (DO) + transition-event design that was outlined previously.

## Worker and routing layer
- `src/index.js` still exports only a `fetch` handler that calls `handleApiRequest` and routes directly to REST endpoints without instantiating or binding to a Durable Object. There is no DO class implemented or exported from the Worker bundle.
- All API mutations, including `PUT /api/matches/:id`, continue to call directly into the D1 binding via the helpers in `src/api/matches.js`.

## API behaviour
- `src/api/matches.js` increments a `revision` column when updating a match but does not enforce optimistic concurrency (it never checks that the incoming revision matches the persisted revision before applying the write).
- The REST layer persists and returns complete match documents; there is no DO-mediated transition endpoint or delta processing.

## Front-end auto-save
- `public/js/volleyball_stats.js` still debounces the scoring form and posts the entire match document via `apiClient.updateMatch`. The payload does not include a revision token or transition descriptor, and the UI does not react to authoritative state returned from the server.

## Database migrations
- `migrations/0001_init.sql` now provisions `revision` and `updated_at` columns for fresh databases.
- `migrations/migrations.sql` attempts to backfill those columns for existing databases but will fail (and abort the transaction) if it is executed after the schema has already been updated because `ALTER TABLE ... ADD COLUMN` cannot be re-run safely.

## Outstanding gaps
1. Introduce a Durable Object class that owns the in-memory match snapshot, validates transition requests, persists state to D1, and returns/broadcasts authoritative state.
2. Update the Worker routing so every write path talks to the DO instead of the database directly.
3. Rework the admin auto-save loop to send revision-bearing transitions (or at minimum include the revision token) and reconcile DO responses, including conflict handling.
4. Make the migration idempotent or gate its execution so that repeated deploys do not fail once the new columns already exist.
