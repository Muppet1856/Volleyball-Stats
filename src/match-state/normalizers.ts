export function normalizeScore(value: any): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}

export function normalizeDeletedFlag(value: any): number {
  if (typeof value === "string") {
    const lower = value.trim().toLowerCase();
    if (lower === "true" || lower === "1") {
      return 1;
    }
    return 0;
  }
  if (typeof value === "number") {
    return value !== 0 ? 1 : 0;
  }
  return value ? 1 : 0;
}

export function coerceJsonString(value: any, fallback: any = {}): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value ?? fallback);
  } catch (error) {
    return JSON.stringify(fallback);
  }
}

export function normalizeTimeoutFlag(value: any): number {
  if (value === null || value === undefined) {
    return 0;
  }
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  if (typeof value === "string") {
    if (value.trim() === "") return 0;
    const parsed = Number(value);
    if (Number.isNaN(parsed)) {
      return value ? 1 : 0;
    }
    return parsed ? 1 : 0;
  }
  if (typeof value === "number") {
    return value ? 1 : 0;
  }
  return 0;
}

export function normalizeTimeoutTimestamp(value: any, data?: any): string | null {
  const normalizedValue = normalizeTimeoutFlag(value);
  if (!normalizedValue) {
    return null;
  }

  const hasProvidedTimestamp = data && ("timeoutStartedAt" in data || "timeout_started_at" in data);
  if (hasProvidedTimestamp) {
    const rawTimestamp = data.timeoutStartedAt ?? data.timeout_started_at;
    if (rawTimestamp === null || rawTimestamp === undefined) {
      return null;
    }
    const parsed = new Date(rawTimestamp);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  return new Date().toISOString();
}

export function maybeStampBroadcast(payload: any, resource: string, action: string, actionsMap: Record<string, ReadonlySet<string>>): void {
  const actions = actionsMap[resource];
  if (actions?.has(action)) {
    payload.eventTimestamp = new Date().toISOString();
  }
}

export function parseJsonMaybe(raw: any): any {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}

export function normalizePlayerDelta(raw: any): { player_id: number; appeared?: boolean; temp_number?: number | null } | null {
  const parsed = parseJsonMaybe(raw);
  const playerId = parsed?.player_id ?? parsed?.playerId ?? parsed?.id;
  if (typeof playerId !== "number") return null;

  const appearedRaw = parsed?.appeared ?? parsed?.active ?? parsed?.selected;
  const appeared = appearedRaw === undefined ? undefined : !!appearedRaw;

  const tempRaw = parsed?.temp_number ?? parsed?.tempNumber;
  const tempParsed = tempRaw === undefined || tempRaw === null || tempRaw === "" ? null : Number(tempRaw);
  const hasTemp = tempRaw !== undefined;

  const payload: any = { player_id: playerId };
  if (appeared !== undefined) payload.appeared = appeared;
  if (hasTemp && !Number.isNaN(tempParsed)) {
    payload.temp_number = tempParsed;
  }
  return payload;
}

export function normalizePlayerRemoval(raw: any): { player_id: number; deleted: true } | null {
  const parsed = parseJsonMaybe(raw);
  const playerId = parsed?.player_id ?? parsed?.playerId ?? parsed?.id;
  if (typeof playerId !== "number") return null;
  return { player_id: playerId, deleted: true };
}

export function normalizeTempDelta(raw: any): { player_id: number; temp_number: number | null } | null {
  const parsed = parseJsonMaybe(raw);
  const playerId = parsed?.player_id ?? parsed?.playerId ?? parsed?.id;
  const tempRaw = parsed?.temp_number ?? parsed?.tempNumber;
  if (typeof playerId !== "number" || tempRaw === undefined) return null;
  const tempParsed = tempRaw === null || tempRaw === "" ? null : Number(tempRaw);
  if (tempParsed === null || Number.isFinite(tempParsed)) {
    return { player_id: playerId, temp_number: tempParsed };
  }
  return null;
}

export function normalizeTempRemoval(raw: any): { player_id: number; deleted: true } | null {
  const parsed = parseJsonMaybe(raw);
  const playerId = parsed?.player_id ?? parsed?.playerId ?? parsed?.id;
  if (typeof playerId !== "number") return null;
  return { player_id: playerId, deleted: true };
}
