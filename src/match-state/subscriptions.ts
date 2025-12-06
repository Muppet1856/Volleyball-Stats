export interface SubscriptionContext {
  state: DurableObjectState;
  matchSubscriptions: Map<string, Set<number>>;
  isDebug: boolean;
}

export interface SubscriptionHelpers {
  restoreSubscriptionsFromAttachments: () => void;
  addMatchSubscription: (ws: WebSocket, matchId: number) => void;
  removeMatchSubscription: (ws: WebSocket, matchId?: number) => void;
  broadcast: (message: string, exclude?: WebSocket) => void;
  normalizeMatchId: (raw: any) => number | null;
  getClientId: (ws: WebSocket) => string | null;
  registerClient: (clientId: string, socket: WebSocket) => void;
  dropClient: (ws: WebSocket) => void;
}

export function createSubscriptionHelpers(context: SubscriptionContext): SubscriptionHelpers {
  const { state, matchSubscriptions, isDebug } = context;

  const normalizeMatchId = (raw: any): number | null => {
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };

  const safeDeserializeAttachment = (ws: WebSocket): any | null => {
    const socketAny = ws as any;
    if (!socketAny || typeof socketAny.deserializeAttachment !== "function") {
      return null;
    }
    try {
      return socketAny.deserializeAttachment();
    } catch (error) {
      if (isDebug) {
        console.error("Failed to deserialize WebSocket attachment", error);
      }
      return null;
    }
  };

  const extractMatchIdsFromAttachment = (ws: WebSocket): Set<number> | undefined => {
    const attachment = safeDeserializeAttachment(ws);
    if (!attachment || typeof attachment !== "object") {
      return undefined;
    }
    const rawIds = Array.isArray((attachment as any).matchIds)
      ? (attachment as any).matchIds
      : Array.isArray((attachment as any).match_ids)
        ? (attachment as any).match_ids
        : null;
    if (!rawIds) return undefined;
    const normalized: number[] = [];
    for (const raw of rawIds) {
      const id = normalizeMatchId(raw);
      if (id !== null) {
        normalized.push(id);
      }
    }
    if (normalized.length === 0) return undefined;
    // Enforce single-subscription rule: keep only the most recent entry.
    const last = normalized[normalized.length - 1];
    return new Set<number>([last]);
  };

  const persistSubscriptionAttachment = (ws: WebSocket, clientId: string, matchIds: Set<number>): void => {
    const socketAny = ws as any;
    if (!socketAny || typeof socketAny.serializeAttachment !== "function") {
      return;
    }
    try {
      socketAny.serializeAttachment({ clientId, matchIds: Array.from(matchIds) });
    } catch (error) {
      if (isDebug) {
        console.error("Failed to serialize WebSocket attachment", error);
      }
    }
  };

  const getClientId = (ws: WebSocket): string | null => {
    const tags = state.getTags(ws);
    const tagId = tags && tags.length > 0 && typeof tags[0] === "string" ? (tags[0] as string) : null;
    if (tagId) return tagId;
    const attachment = safeDeserializeAttachment(ws);
    const attachedId = attachment?.clientId ?? attachment?.client_id ?? attachment?.id;
    return typeof attachedId === "string" ? attachedId : null;
  };

  const getSubscriptionsForSocket = (ws: WebSocket): { clientId: string | null; subscriptions?: Set<number> } => {
    const clientId = getClientId(ws);
    if (!clientId) {
      const restored = extractMatchIdsFromAttachment(ws);
      return { clientId: null, subscriptions: restored };
    }
    const cached = matchSubscriptions.get(clientId);
    if (cached) {
      return { clientId, subscriptions: cached };
    }
    const restored = extractMatchIdsFromAttachment(ws);
    if (restored) {
      matchSubscriptions.set(clientId, restored);
      return { clientId, subscriptions: restored };
    }
    return { clientId, subscriptions: undefined };
  };

  const restoreSubscriptionsFromAttachments = (): void => {
    const sockets = state.getWebSockets ? state.getWebSockets() : [];
    for (const socket of sockets) {
      const clientId = getClientId(socket);
      if (!clientId) continue;
      const restored = extractMatchIdsFromAttachment(socket);
      if (restored) {
        matchSubscriptions.set(clientId, restored);
      }
    }
  };

  const addMatchSubscription = (ws: WebSocket, matchId: number) => {
    const { clientId } = getSubscriptionsForSocket(ws);
    if (!clientId) return;
    // Only one active subscription per client: replace any existing set.
    const next = new Set<number>([matchId]);
    matchSubscriptions.set(clientId, next);
    persistSubscriptionAttachment(ws, clientId, next);
  };

  const removeMatchSubscription = (ws: WebSocket, matchId?: number) => {
    const { clientId, subscriptions } = getSubscriptionsForSocket(ws);
    if (!clientId) return;
    if (matchId === undefined) {
      matchSubscriptions.delete(clientId);
      persistSubscriptionAttachment(ws, clientId, new Set());
      return;
    }
    if (!subscriptions) {
      persistSubscriptionAttachment(ws, clientId, new Set());
      return;
    }
    subscriptions.delete(matchId);
    if (subscriptions.size === 0) {
      matchSubscriptions.delete(clientId);
    } else {
      matchSubscriptions.set(clientId, subscriptions);
    }
    persistSubscriptionAttachment(ws, clientId, subscriptions);
  };

  const extractMatchIdForBroadcast = (message: string): number | null => {
    try {
      const parsed = JSON.parse(message);
      const rawMatchId = parsed?.matchId ?? parsed?.data?.matchId ?? parsed?.data?.match_id;
      const normalized = normalizeMatchId(rawMatchId);
      if (normalized !== null) return normalized;
      // Fallback: allow match create/delete messages that omit explicit matchId.
      if (parsed?.resource === 'match') {
        return normalizeMatchId(parsed?.id);
      }
      return null;
    } catch {
      return null;
    }
  };

  const shouldDeliverBroadcast = (conn: WebSocket, targetMatchId: number | null): boolean => {
    const { subscriptions } = getSubscriptionsForSocket(conn);
    // No subscriptions -> legacy behaviour: receive everything.
    if (!subscriptions || subscriptions.size === 0) return true;
    if (targetMatchId === null) return true;
    return subscriptions.has(targetMatchId);
  };

  const broadcast = (message: string, exclude?: WebSocket) => {
    console.log('websocket broadcast =>', message);
    const targetMatchId = extractMatchIdForBroadcast(message);
    for (const conn of state.getWebSockets() || []) {
      if (conn === exclude) {
        continue;
      }
      if (!shouldDeliverBroadcast(conn, targetMatchId)) {
        continue;
      }
      conn.send(message);
    }
  };

  const registerClient = (clientId: string, socket: WebSocket) => {
    matchSubscriptions.set(clientId, new Set());
    persistSubscriptionAttachment(socket, clientId, new Set());
  };

  const dropClient = (ws: WebSocket) => {
    const clientId = getClientId(ws);
    if (clientId) {
      matchSubscriptions.delete(clientId);
    }
  };

  return {
    restoreSubscriptionsFromAttachments,
    addMatchSubscription,
    removeMatchSubscription,
    broadcast,
    normalizeMatchId,
    getClientId,
    registerClient,
    dropClient,
  };
}
