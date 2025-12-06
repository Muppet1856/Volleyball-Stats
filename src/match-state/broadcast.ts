import * as matchApi from "../api/match";
import * as playerApi from "../api/player";
import * as setApi from "../api/set";
import {
  coerceJsonString,
  maybeStampBroadcast,
  normalizeDeletedFlag,
  normalizePlayerDelta,
  normalizePlayerRemoval,
  normalizeScore,
  normalizeTempDelta,
  normalizeTempRemoval,
  normalizeTimeoutFlag,
  normalizeTimeoutTimestamp,
} from "./normalizers";

export interface BroadcastContext {
  state: DurableObjectState;
}

export const BROADCAST_EVENT_TIMESTAMP_ACTIONS: Record<string, ReadonlySet<string>> = {
  set: new Set(['set-home-score', 'set-opp-score', 'set-home-timeout', 'set-opp-timeout']),
};

type BroadcastParams = { resource: string; action: string; id?: number; matchId?: number; data: any; };

export async function prepareBroadcastMessage(context: BroadcastContext, params: BroadcastParams): Promise<string | undefined> {
  const { resource, action, id, matchId, data } = params;

  if (action === 'delete') {
    if (id === undefined) return undefined;
    const payload: any = { type: 'delete', resource, id };
    if (matchId !== undefined) payload.matchId = matchId;
    return JSON.stringify(payload);
  }

  if (resource === 'set' && action === 'set-is-final' && matchId) {
    // Special: Broadcast all sets for the match
    const setsRes = await setApi.getSets(context.state.storage, matchId);
    const setsData = await setsRes.json();
    return JSON.stringify({ type: 'update', resource: 'sets', action, matchId, data: setsData });
  }

  if (action === 'create') {
    if (id === undefined) return undefined;
    // Creation still sends the full record to allow clients to render new items
    const created = await getUpdated(context, resource, id);
    const payload: any = { type: 'update', resource, action, id, data: created };
    if (matchId !== undefined) payload.matchId = matchId;
    maybeStampBroadcast(payload, resource, action, BROADCAST_EVENT_TIMESTAMP_ACTIONS);
    return JSON.stringify(payload);
  }

  if (id === undefined) return undefined;

  const changes = await getChanges(context, resource, action, id, data, matchId);
  if (!changes) return undefined;

  const prunedChanges = Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined));
  if (Object.keys(prunedChanges).length === 0) return undefined;

  const payload: any = { type: 'update', resource, action, id, changes: prunedChanges };
  if (matchId !== undefined) payload.matchId = matchId;
  maybeStampBroadcast(payload, resource, action, BROADCAST_EVENT_TIMESTAMP_ACTIONS);
  return JSON.stringify(payload);
}

async function getChanges(context: BroadcastContext, resource: string, action: string, id: number, data: any, matchId?: number): Promise<Record<string, any> | null> {
  switch (resource) {
    case 'match':
      return getMatchChanges(context, action, id, data);
    case 'player':
      return getPlayerChanges(action, id, data);
    case 'set':
      return getSetChanges(action, id, data, matchId);
    default:
      return null;
  }
}

async function getMatchChanges(context: BroadcastContext, action: string, matchId: number, data: any): Promise<Record<string, any> | null> {
  switch (action) {
    case 'set-location':
      return { location: data.location ?? null };
    case 'set-date-time':
      return { date: data.date ?? null };
    case 'set-opp-name':
      return { opponent: data.opponent ?? null };
    case 'set-type':
      return { types: coerceJsonString(data.types, {}) };
    case 'set-result':
      return {
        result_home: normalizeScore(data.resultHome),
        result_opp: normalizeScore(data.resultOpp),
      };
    case 'set-players':
      return {
        players: coerceJsonString(data.players, []),
        temp_numbers: await getMatchColumn(context, matchId, 'temp_numbers'),
      };
    case 'add-player':
    case 'update-player': {
      const playerDelta = normalizePlayerDelta(data.player);
      const tempDelta = normalizeTempDelta(data.player);
      if (!playerDelta && !tempDelta) return null;
      return {
        player_delta: playerDelta,
        temp_number_delta: tempDelta ?? undefined,
      };
    }
    case 'remove-player': {
      const playerDelta = normalizePlayerRemoval(data.player);
      if (!playerDelta) return null;
      return {
        player_delta: playerDelta,
        temp_number_delta: { player_id: playerDelta.player_id, deleted: true },
      };
    }
    case 'add-temp-number':
    case 'update-temp-number': {
      const tempDelta = normalizeTempDelta(data.tempNumber ?? data.temp_number ?? data.temp);
      if (!tempDelta) return null;
      return { temp_number_delta: tempDelta };
    }
    case 'remove-temp-number': {
      const tempDelta = normalizeTempRemoval(data.tempNumber ?? data.temp_number ?? data.temp);
      if (!tempDelta) return null;
      return { temp_number_delta: tempDelta };
    }
    case 'set-home-color':
      return { jersey_color_home: data.jerseyColorHome ?? null };
    case 'set-opp-color':
      return { jersey_color_opp: data.jerseyColorOpp ?? null };
    case 'set-first-server':
      return { first_server: data.firstServer ?? null };
    case 'set-deleted':
      return { deleted: normalizeDeletedFlag(data.deleted) };
    default:
      return null;
  }
}

function getPlayerChanges(action: string, _playerId: number, data: any): Record<string, any> | null {
  switch (action) {
    case 'set-lname':
      return { last_name: data.lastName ?? null };
    case 'set-fname':
      return { initial: data.initial ?? null };
    case 'set-number':
      return { number: data.number ?? null };
    default:
      return null;
  }
}

function getSetChanges(action: string, _setId: number, data: any, matchId?: number): Record<string, any> | null {
  switch (action) {
    case 'set-home-score':
      return { home_score: normalizeScore(data.homeScore) };
    case 'set-opp-score':
      return { opp_score: normalizeScore(data.oppScore) };
    case 'set-home-timeout': {
      const field = data.timeoutNumber === 2 || data.timeoutNumber === '2' ? 'home_timeout_2' : 'home_timeout_1';
      return {
        [field]: normalizeTimeoutFlag(data.value),
        timeout_started_at: normalizeTimeoutTimestamp(data.value, data),
      };
    }
    case 'set-opp-timeout': {
      const field = data.timeoutNumber === 2 || data.timeoutNumber === '2' ? 'opp_timeout_2' : 'opp_timeout_1';
      return {
        [field]: normalizeTimeoutFlag(data.value),
        timeout_started_at: normalizeTimeoutTimestamp(data.value, data),
      };
    }
    case 'set-is-final':
      return matchId ? { finalized_sets: data.finalizedSets } : null;
    default:
      return null;
  }
}

async function getUpdated(context: BroadcastContext, resource: string, id: number): Promise<any> {
  const storage = context.state.storage;
  switch (resource) {
    case 'match': {
      const matchRes = await matchApi.getMatch(storage, id);
      return await matchRes.json();
    }
    case 'player': {
      const playerRes = await playerApi.getPlayer(storage, id);
      return await playerRes.json();
    }
    case 'set': {
      const setRes = await setApi.getSet(storage, id);
      return await setRes.json();
    }
    default:
      throw new Error(`No getUpdated for resource: ${resource}`);
  }
}

async function getMatchColumn(context: BroadcastContext, matchId: number, column: string): Promise<any> {
  const sql = context.state.storage.sql;
  const cursor = sql.exec(`SELECT ${column} FROM matches WHERE id = ?`, matchId);
  const row = cursor.toArray()[0];
  return row ? row[column] : undefined;
}
