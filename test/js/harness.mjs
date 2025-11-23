#!/usr/bin/env node

import WebSocket from "ws";

const WORKER_BASE_URL = (process.env.WORKER_BASE_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
const WORKER_WS_URL = process.env.WORKER_WS_URL || deriveWsUrl(WORKER_BASE_URL);

function deriveWsUrl(baseUrl) {
  const url = new URL(baseUrl);
  const wsProtocol = url.protocol === "https:" ? "wss:" : "ws:";
  return `${wsProtocol}//${url.host}/ws`;
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(path, options = {}) {
  const url = `${WORKER_BASE_URL}${path}`;
  const response = await fetch(url, options);
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    throw new Error(`Request to ${path} failed (${response.status}): ${JSON.stringify(body)}`);
  }
  return { status: response.status, body };
}

function buildPostOptions(payload) {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  };
}

function logHeader(title) {
  const separator = "=".repeat(title.length + 4);
  console.log(`\n${separator}\n| ${title} |\n${separator}`);
}

function getSetIdForFirstSet(sets) {
  for (const entry of sets) {
    const setNumber = entry.number ?? entry.set_number ?? entry.setNumber;
    if (Number(setNumber) === 1) {
      return entry.id ?? entry.set_id ?? entry.setId;
    }
  }
  return undefined;
}

async function runRestFlow() {
  logHeader("Running REST workflow");
  const uniqueSuffix = Date.now().toString();

  // Match lifecycle
  const matchCreate = await fetchJson(
    "/api/match/create",
    buildPostOptions({
      date: new Date().toISOString(),
      opponent: `REST Opponent ${uniqueSuffix}`,
      players: JSON.stringify([]),
      finalized_sets: JSON.stringify({}),
      deleted: false,
    })
  );
  const matchId = matchCreate.body.id;
  console.log(`Created match ${matchId}`);

  await fetchJson("/api/match/set-location", buildPostOptions({ matchId, location: "REST Location" }));
  await fetchJson("/api/match/set-date-time", buildPostOptions({ matchId, date: new Date().toISOString() }));
  await fetchJson("/api/match/set-opp-name", buildPostOptions({ matchId, opponent: "REST Opponent Updated" }));
  await fetchJson("/api/match/set-type", buildPostOptions({ matchId, types: JSON.stringify({ friendly: true }) }));
  await fetchJson("/api/match/set-result", buildPostOptions({ matchId, resultHome: 3, resultOpp: 1 }));
  await fetchJson("/api/match/set-players", buildPostOptions({ matchId, players: JSON.stringify([{ id: 1 }]) }));
  await fetchJson("/api/match/set-home-color", buildPostOptions({ matchId, jerseyColorHome: "blue" }));
  await fetchJson("/api/match/set-opp-color", buildPostOptions({ matchId, jerseyColorOpp: "white" }));
  await fetchJson("/api/match/set-first-server", buildPostOptions({ matchId, firstServer: "home" }));
  await fetchJson("/api/match/set-deleted", buildPostOptions({ matchId, deleted: true }));
  await fetchJson(`/api/match/get/${matchId}`);
  await fetchJson("/api/match");
  await fetchJson(`/api/match/delete/${matchId}`, { method: "DELETE" });
  console.log(`Deleted match ${matchId}`);

  // Player lifecycle
  const playerCreate = await fetchJson(
    "/api/player/create",
    buildPostOptions({ number: `9${uniqueSuffix}`, last_name: "Rest", initial: "R" })
  );
  const playerId = playerCreate.body.id;
  console.log(`Created player ${playerId}`);

  await fetchJson("/api/player/set-lname", buildPostOptions({ playerId, lastName: "Restington" }));
  await fetchJson("/api/player/set-fname", buildPostOptions({ playerId, initial: "N" }));
  await fetchJson("/api/player/set-number", buildPostOptions({ playerId, number: `20${uniqueSuffix}` }));
  await fetchJson(`/api/player/get/${playerId}`);
  await fetchJson("/api/player");
  await fetchJson(`/api/player/delete/${playerId}`, { method: "DELETE" });
  console.log(`Deleted player ${playerId}`);

  // Set lifecycle (create a dedicated match first)
  const setMatchCreate = await fetchJson(
    "/api/match/create",
    buildPostOptions({
      date: new Date().toISOString(),
      opponent: `REST Set Opponent ${uniqueSuffix}`,
      players: JSON.stringify([]),
      finalized_sets: JSON.stringify({}),
      deleted: false,
    })
  );
  const setMatchId = setMatchCreate.body.id;
  console.log(`Created match ${setMatchId} for set tests`);

  const setsResponse = await fetchJson(`/api/set?matchId=${setMatchId}`);
  let setId = getSetIdForFirstSet(setsResponse.body);
  if (!setId) {
    const setCreate = await fetchJson(
      "/api/set/create",
      buildPostOptions({ match_id: setMatchId, set_number: 1 })
    );
    setId = setCreate.body.id;
    console.log(`Created set ${setId}`);
  }

  await fetchJson("/api/set/set-home-score", buildPostOptions({ setId, homeScore: 25 }));
  await fetchJson("/api/set/set-opp-score", buildPostOptions({ setId, oppScore: 20 }));
  await fetchJson("/api/set/set-home-timeout", buildPostOptions({ setId, timeoutNumber: 1, value: true }));
  await fetchJson("/api/set/set-opp-timeout", buildPostOptions({ setId, timeoutNumber: 2, value: true }));
  await fetchJson("/api/set/set-is-final", buildPostOptions({ matchId: setMatchId, finalizedSets: JSON.stringify({ 1: true }) }));
  await fetchJson(`/api/set/get/${setId}`);
  await fetchJson(`/api/set?matchId=${setMatchId}`);
  await fetchJson(`/api/set/delete/${setId}`, { method: "DELETE" });
  await fetchJson(`/api/match/delete/${setMatchId}`, { method: "DELETE" });
  console.log(`Deleted set ${setId} and match ${setMatchId}`);

  console.log("REST workflow completed successfully");
}

function createWsClient(name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WORKER_WS_URL);
    const queue = [];
    const waiters = [];

    const handleMessage = (data) => {
      const text = data.toString();
      if (text.startsWith("Debug:")) {
        console.log(`[${name}] ${text}`);
        return;
      }
      try {
        const parsed = JSON.parse(text);
        const waiter = waiters.shift();
        if (waiter) {
          waiter.resolve(parsed);
        } else {
          queue.push(parsed);
        }
      } catch (error) {
        console.warn(`[${name}] Non-JSON message: ${text}`);
      }
    };

    const handleOpen = () => {
      ws.off("error", handleError);
      resolve({
        ws,
        send(resource, action, payload) {
          const message = JSON.stringify({ [resource]: { [action]: payload } });
          ws.send(message);
        },
        async nextResponse(timeoutMs = 5000) {
          if (queue.length > 0) {
            return queue.shift();
          }
          return new Promise((resolveResponse, rejectResponse) => {
            const timeout = setTimeout(() => {
              cleanup();
              rejectResponse(new Error(`Timed out waiting for ${name} response`));
            }, timeoutMs);

            const closeListener = () => {
              cleanup();
              rejectResponse(new Error(`${name} WebSocket closed`));
            };
            const errorListener = (err) => {
              cleanup();
              rejectResponse(err);
            };
            const cleanup = () => {
              clearTimeout(timeout);
              ws.off("close", closeListener);
              ws.off("error", errorListener);
            };

            waiters.push({
              resolve: (value) => {
                cleanup();
                resolveResponse(value);
              },
            });
            ws.once("close", closeListener);
            ws.once("error", errorListener);
          });
        },
        close() {
          ws.close();
        },
      });
    };

    const handleError = (err) => reject(err);

    ws.on("message", handleMessage);
    ws.once("open", handleOpen);
    ws.once("error", handleError);
  });
}

async function sendAndExpectSuccess(client, resource, action, payload) {
  client.send(resource, action, payload);
  const response = await client.nextResponse();
  if (response.status >= 300) {
    throw new Error(`WS ${resource}:${action} failed with status ${response.status}: ${JSON.stringify(response.body)}`);
  }
  return response;
}

async function runWebSocketFlow() {
  logHeader("Running WebSocket workflow");
  const uniqueSuffix = Date.now().toString();
  const listener = await createWsClient("listener");
  listener.ws.on("message", (data) => {
    const text = data.toString();
    if (!text.startsWith("Debug:")) {
      console.log(`[listener broadcast] ${text}`);
    }
  });

  const actor = await createWsClient("actor");

  // Match lifecycle
  const matchCreate = await sendAndExpectSuccess(actor, "match", "create", {
    date: new Date().toISOString(),
    opponent: `WS Opponent ${uniqueSuffix}`,
  });
  const matchId = matchCreate.body.id;
  await sleep(500);

  await sendAndExpectSuccess(actor, "match", "set-location", { matchId, location: "WS Location" });
  await sleep(100);
  await sendAndExpectSuccess(actor, "match", "set-date-time", { matchId, date: new Date().toISOString() });
  await sleep(100);
  await sendAndExpectSuccess(actor, "match", "set-opp-name", { matchId, opponent: "WS Opponent Updated" });
  await sleep(100);
  await sendAndExpectSuccess(actor, "match", "set-type", { matchId, types: JSON.stringify({ tournament: true }) });
  await sleep(100);
  await sendAndExpectSuccess(actor, "match", "set-result", { matchId, resultHome: 3, resultOpp: 2 });
  await sleep(100);
  await sendAndExpectSuccess(actor, "match", "set-players", { matchId, players: JSON.stringify([{ id: 1 }]) });
  await sleep(100);
  await sendAndExpectSuccess(actor, "match", "set-home-color", { matchId, jerseyColorHome: "blue" });
  await sleep(100);
  await sendAndExpectSuccess(actor, "match", "set-opp-color", { matchId, jerseyColorOpp: "black" });
  await sleep(100);
  await sendAndExpectSuccess(actor, "match", "set-first-server", { matchId, firstServer: "home" });
  await sleep(100);
  await sendAndExpectSuccess(actor, "match", "set-deleted", { matchId, deleted: true });
  await sleep(100);
  await sendAndExpectSuccess(actor, "match", "get", { matchId });
  await sendAndExpectSuccess(actor, "match", "get", {});
  await sendAndExpectSuccess(actor, "match", "delete", { id: matchId });
  await sleep(200);

  // Player lifecycle
  const playerCreate = await sendAndExpectSuccess(actor, "player", "create", {
    number: `8${uniqueSuffix}`,
    last_name: "Ws",
    initial: "W",
  });
  const playerId = playerCreate.body.id;
  await sleep(200);

  await sendAndExpectSuccess(actor, "player", "set-lname", { playerId, lastName: "WsUpdated" });
  await sleep(100);
  await sendAndExpectSuccess(actor, "player", "set-fname", { playerId, initial: "Q" });
  await sleep(100);
  await sendAndExpectSuccess(actor, "player", "set-number", { playerId, number: `21${uniqueSuffix}` });
  await sleep(100);
  await sendAndExpectSuccess(actor, "player", "get", { id: playerId });
  await sendAndExpectSuccess(actor, "player", "get", {});
  await sendAndExpectSuccess(actor, "player", "delete", { id: playerId });
  await sleep(200);

  // Set lifecycle (create a dedicated match first)
  const setMatchCreate = await sendAndExpectSuccess(actor, "match", "create", {
    date: new Date().toISOString(),
    opponent: `WS Set Opponent ${uniqueSuffix}`,
  });
  const setMatchId = setMatchCreate.body.id;
  await sleep(200);

  const setsResp = await sendAndExpectSuccess(actor, "set", "get", { matchId: setMatchId });
  let setId = getSetIdForFirstSet(setsResp.body);
  if (!setId) {
    const setCreate = await sendAndExpectSuccess(actor, "set", "create", { matchId: setMatchId, setNumber: 1 });
    setId = setCreate.body.id;
    await sleep(200);
  }

  await sendAndExpectSuccess(actor, "set", "set-home-score", { setId, homeScore: 25, matchId: setMatchId });
  await sleep(100);
  await sendAndExpectSuccess(actor, "set", "set-opp-score", { setId, oppScore: 20, matchId: setMatchId });
  await sleep(100);
  await sendAndExpectSuccess(actor, "set", "set-home-timeout", { setId, timeoutNumber: 1, value: true, matchId: setMatchId });
  await sleep(100);
  await sendAndExpectSuccess(actor, "set", "set-opp-timeout", { setId, timeoutNumber: 2, value: true, matchId: setMatchId });
  await sleep(100);
  await sendAndExpectSuccess(actor, "set", "set-is-final", { matchId: setMatchId, finalizedSets: JSON.stringify({ 1: true }) });
  await sleep(100);
  await sendAndExpectSuccess(actor, "set", "get", { id: setId });
  await sendAndExpectSuccess(actor, "set", "get", { matchId: setMatchId });
  await sendAndExpectSuccess(actor, "set", "delete", { id: setId, matchId: setMatchId });
  await sleep(200);
  await sendAndExpectSuccess(actor, "match", "delete", { id: setMatchId });

  await sleep(500);
  listener.close();
  actor.close();
  console.log("WebSocket workflow completed successfully");
}

function parseFlags() {
  const args = new Set(process.argv.slice(2));
  if (args.has("--help")) {
    console.log("Usage: node test/js/harness.mjs [--rest] [--ws]\n\nWhen no flags are provided, both REST and WebSocket flows run.");
    process.exit(0);
  }

  const runRest = args.size === 0 || args.has("--rest") || args.has("--all");
  const runWs = args.size === 0 || args.has("--ws") || args.has("--all");
  return { runRest, runWs };
}

async function main() {
  const { runRest, runWs } = parseFlags();
  if (!runRest && !runWs) {
    console.warn("No workflows selected. Use --rest and/or --ws.");
    return;
  }

  if (runRest) {
    await runRestFlow();
  }

  if (runWs) {
    await runWebSocketFlow();
  }
}

main().catch((err) => {
  console.error("Harness failed:", err);
  process.exit(1);
});
