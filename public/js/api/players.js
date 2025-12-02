// js/api/players.js
// Thin wrappers around the player WebSocket API with client-side normalization.
import {
  createPlayer as createPlayerWs,
  setPlayerLastName,
  setPlayerFirstName,
  setPlayerNumber,
  getPlayers as getPlayersWs,
  deletePlayer as deletePlayerWs,
} from './ws.js';

function normalizeApiPlayer(row = {}) {
  const id = row.id ?? row.player_id ?? row.playerId;
  const number = Number(row.number ?? row.jersey_number ?? row.jerseyNumber);
  const lastName = (row.last_name ?? row.lastName ?? '').trim();
  const initial = (row.initial ?? row.firstInitial ?? '').trim();

  if (!id || !Number.isFinite(number) || !lastName) return null;
  return { id, number, lastName, initial };
}

export async function fetchPlayers() {
  const res = await getPlayersWs();
  const body = res?.body ?? [];
  if (!Array.isArray(body)) return [];
  return body.map(normalizeApiPlayer).filter(Boolean);
}

export async function createPlayer(payload) {
  const res = await createPlayerWs({
    number: payload.number,
    last_name: payload.lastName,
    initial: payload.initial ?? '',
  });
  const id = res?.body?.id;
  if (!id) throw new Error('Player ID missing from create response');
  return {
    id,
    number: payload.number,
    lastName: payload.lastName,
    initial: payload.initial ?? '',
  };
}

export async function updatePlayer(playerId, payload, previous = {}) {
  if (!playerId) throw new Error('Player ID is required for update');
  const tasks = [];

  if (payload.number !== undefined && payload.number !== previous.number) {
    tasks.push(setPlayerNumber(playerId, payload.number));
  }
  if (payload.lastName !== undefined && payload.lastName !== previous.lastName) {
    tasks.push(setPlayerLastName(playerId, payload.lastName));
  }
  if (payload.initial !== undefined && payload.initial !== (previous.initial ?? '')) {
    tasks.push(setPlayerFirstName(playerId, payload.initial ?? ''));
  }

  if (!tasks.length) return { ...previous, ...payload };

  for (const task of tasks) {
    await task;
  }

  return {
    id: playerId,
    number: payload.number ?? previous.number,
    lastName: payload.lastName ?? previous.lastName,
    initial: payload.initial ?? previous.initial ?? '',
  };
}

export async function deletePlayer(playerId) {
  if (!playerId) return;
  await deletePlayerWs(playerId);
}

export default {
  fetchPlayers,
  createPlayer,
  updatePlayer,
  deletePlayer,
};
