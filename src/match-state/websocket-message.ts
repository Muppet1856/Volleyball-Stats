import { jsonResponse } from "../utils/responses";
import * as matchApi from "../api/match";
import * as playerApi from "../api/player";
import * as setApi from "../api/set";
import { prepareBroadcastMessage } from "./broadcast";
import { normalizeTimeoutTimestamp } from "./normalizers";
import { SubscriptionHelpers } from "./subscriptions";
import { BroadcastContext } from "./broadcast";

export interface WebSocketContext {
  state: DurableObjectState;
  subscriptions: SubscriptionHelpers;
  broadcastContext: BroadcastContext;
}

export async function handleWebSocketMessage(context: WebSocketContext, ws: WebSocket, message: string | ArrayBuffer) {
  const storage = context.state.storage;
  try {
    // Handle potential ArrayBuffer (safe for text/binary; Miniflare might send text as buffer)
    let msgStr: string;
    if (message instanceof ArrayBuffer) {
      msgStr = new TextDecoder().decode(message);
    } else {
      msgStr = message;
    }
    const payload = JSON.parse(msgStr);
    const resource = Object.keys(payload)[0];
    if (!resource) throw new Error('Invalid payload: missing resource');

    const actionObj = payload[resource];
    const action = Object.keys(actionObj)[0];
    if (!action) throw new Error('Invalid payload: missing action');

    const data = actionObj[action] || {};

    let res: Response;
    let matchId: number | undefined;

    switch (resource) {
      case 'match':
        switch (action) {
          case 'subscribe': {
            const normalized = context.subscriptions.normalizeMatchId(data.matchId ?? data.id);
            if (!normalized) {
              throw new Error('Invalid matchId for subscribe');
            }
            context.subscriptions.addMatchSubscription(ws, normalized);
            res = jsonResponse({ matchId: normalized });
            matchId = normalized;
            break;
          }
          case 'unsubscribe': {
            const normalized = context.subscriptions.normalizeMatchId(data.matchId ?? data.id);
            if (normalized) {
              context.subscriptions.removeMatchSubscription(ws, normalized);
            } else {
              context.subscriptions.removeMatchSubscription(ws);
            }
            res = jsonResponse({ matchId: normalized ?? null });
            matchId = normalized ?? undefined;
            break;
          }
          case 'create': {
            // Mock Request for create
            const mockReq = {
              json: async () => data,
            } as Request;
            res = await matchApi.createMatch(storage, mockReq);
            matchId = (await res.clone().json()).id;
            break;
          }
          case 'set-location':
            res = await matchApi.setLocation(storage, data.matchId, data.location);
            matchId = data.matchId;
            break;
          case 'set-date-time':
            res = await matchApi.setDateTime(storage, data.matchId, data.date);
            matchId = data.matchId;
            break;
          case 'set-opp-name':
            res = await matchApi.setOppName(storage, data.matchId, data.opponent);
            matchId = data.matchId;
            break;
          case 'set-type':
            res = await matchApi.setType(storage, data.matchId, data.types);
            matchId = data.matchId;
            break;
          case 'set-result':
            res = await matchApi.setResult(storage, data.matchId, data.resultHome, data.resultOpp);
            matchId = data.matchId;
            break;
          case 'set-players':
            res = await matchApi.setPlayers(storage, data.matchId, data.players);
            matchId = data.matchId;
            break;
          case 'add-player':
            res = await matchApi.addPlayer(storage, data.matchId, data.player);
            matchId = data.matchId;
            break;
          case 'remove-player':
            res = await matchApi.removePlayer(storage, data.matchId, data.player);
            matchId = data.matchId;
            break;
          case 'update-player':
            res = await matchApi.updatePlayer(storage, data.matchId, data.player);
            matchId = data.matchId;
            break;
          case 'add-temp-number':
            res = await matchApi.addTempNumber(storage, data.matchId, data.tempNumber ?? data.temp_number ?? data.temp);
            matchId = data.matchId;
            break;
          case 'update-temp-number':
            res = await matchApi.updateTempNumber(storage, data.matchId, data.tempNumber ?? data.temp_number ?? data.temp);
            matchId = data.matchId;
            break;
          case 'remove-temp-number':
            res = await matchApi.removeTempNumber(storage, data.matchId, data.tempNumber ?? data.temp_number ?? data.temp);
            matchId = data.matchId;
            break;
          case 'set-home-color':
            res = await matchApi.setHomeColor(storage, data.matchId, data.jerseyColorHome);
            matchId = data.matchId;
            break;
          case 'set-opp-color':
            res = await matchApi.setOppColor(storage, data.matchId, data.jerseyColorOpp);
            matchId = data.matchId;
            break;
          case 'set-first-server':
            res = await matchApi.setFirstServer(storage, data.matchId, data.firstServer);
            matchId = data.matchId;
            break;
          case 'set-deleted':
            res = await matchApi.setDeleted(storage, data.matchId, data.deleted);
            matchId = data.matchId;
            break;
          case 'get':
            if (data.matchId) {
              res = await matchApi.getMatch(storage, data.matchId);
              matchId = data.matchId;
            } else {
              res = await matchApi.getMatches(storage);
            }
            break;
          case 'delete':
            res = await matchApi.deleteMatch(storage, data.id);
            matchId = data.id;
            break;
          default:
            throw new Error(`Unknown action for match: ${action}`);
        }
        break;

      case 'player':
        switch (action) {
          case 'create': {
            const mockReq = {
              json: async () => data,
            } as Request;
            res = await playerApi.createPlayer(storage, mockReq);
            break;
          }
          case 'set-lname':
            res = await playerApi.setPlayerLName(storage, data.playerId, data.lastName);
            break;
          case 'set-fname':
            res = await playerApi.setPlayerFName(storage, data.playerId, data.initial);
            break;
          case 'set-number':
            res = await playerApi.setPlayerNumber(storage, data.playerId, data.number);
            break;
          case 'get':
            if (data.id) {
              res = await playerApi.getPlayer(storage, data.id);
            } else {
              res = await playerApi.getPlayers(storage);
            }
            break;
          case 'delete':
            res = await playerApi.deletePlayer(storage, data.id);
            break;
          default:
            throw new Error(`Unknown action for player: ${action}`);
        }
        break;

      case 'set':
        switch (action) {
          case 'create': {
            const normalizedSetData = {
              ...data,
              match_id: data.match_id ?? data.matchId,
              set_number: data.set_number ?? data.setNumber,
              home_score: data.home_score ?? data.homeScore,
              opp_score: data.opp_score ?? data.oppScore,
              home_timeout_1: data.home_timeout_1 ?? data.homeTimeout1 ?? data.homeTimeout_1,
              home_timeout_2: data.home_timeout_2 ?? data.homeTimeout2 ?? data.homeTimeout_2,
              opp_timeout_1: data.opp_timeout_1 ?? data.oppTimeout1 ?? data.oppTimeout_1,
              opp_timeout_2: data.opp_timeout_2 ?? data.oppTimeout2 ?? data.oppTimeout_2,
              timeout_started_at: data.timeout_started_at ?? data.timeoutStartedAt ?? null,
            };
            const mockReq = {
              json: async () => normalizedSetData,
            } as Request;
            res = await setApi.createSet(storage, mockReq);
            matchId = normalizedSetData.match_id; // Assume provided; fallback if needed
            break;
          }
          case 'set-home-score':
            res = await setApi.setHomeScore(storage, data.setId, data.homeScore);
            matchId = data.matchId;
            break;
          case 'set-opp-score':
            res = await setApi.setOppScore(storage, data.setId, data.oppScore);
            matchId = data.matchId;
            break;
          case 'set-home-timeout': {
            const timeoutStartedAt = normalizeTimeoutTimestamp(data.value, data);
            res = await setApi.setHomeTimeout(storage, data.setId, data.timeoutNumber, data.value, timeoutStartedAt);
            data.timeoutStartedAt = timeoutStartedAt;
            matchId = data.matchId;
            break;
          }
          case 'set-opp-timeout': {
            const timeoutStartedAt = normalizeTimeoutTimestamp(data.value, data);
            res = await setApi.setOppTimeout(storage, data.setId, data.timeoutNumber, data.value, timeoutStartedAt);
            data.timeoutStartedAt = timeoutStartedAt;
            matchId = data.matchId;
            break;
          }
          case 'set-is-final':
            res = await setApi.setIsFinal(storage, data.matchId, data.finalizedSets);
            matchId = data.matchId;
            break;
          case 'get':
            if (data.id) {
              res = await setApi.getSet(storage, data.id);
            } else {
              res = await setApi.getSets(storage, data.matchId);
            }
            break;
          case 'delete':
            res = await setApi.deleteSet(storage, data.id);
            matchId = data.matchId;
            break;
          default:
            throw new Error(`Unknown action for set: ${action}`);
        }
        if (!matchId && data.setId) {
          // Fallback fetch if not provided
          const setRes = await setApi.getSet(storage, data.setId);
          const setData = await setRes.json();
          matchId = setData.match_id;
        }
        break;

      default:
        throw new Error(`Unknown resource: ${resource}`);
    }
    // Prepare response to send over WS to sender
    let body: any;
    const contentType = res.headers.get('Content-Type');
    if (contentType?.includes('json')) {
      body = await res.json();
    } else {
      body = await res.text();
    }
    const responseMsg = JSON.stringify({
      resource,
      action,
      status: res.status,
      body,
    });
    ws.send(responseMsg);

    // If successful write action, broadcast update/delete to other clients
    if (res.status < 300 && action !== 'get') {
      const id = getIdFromData(resource, action, data, body);

      const broadcastMsg = await prepareBroadcastMessage(context.broadcastContext, {
        resource,
        action,
        id,
        matchId,
        data,
      });

      if (broadcastMsg) {
        context.subscriptions.broadcast(broadcastMsg, ws);  // Exclude sender
      }
    }

  } catch (e) {
    ws.send(JSON.stringify({
      error: {
        message: (e as Error).message,
      }
    }));
  }
}

function getIdFromData(resource: string, action: string, data: any, body: any): number | undefined {
  if (action === 'create' && body.id) {
    return body.id;
  }
  switch (resource) {
    case 'match':
      return data.matchId || data.id;
    case 'player':
      return data.playerId || data.id;
    case 'set':
      return data.setId || data.id;
    default:
      return undefined;
  }
}
