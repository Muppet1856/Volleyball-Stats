// src/api/match.ts
import { jsonSuccess, textResponse, errorResponse, jsonResponse } from "../utils/responses";  // Add this import

function normalizeScore(value: any): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}

function coerceJsonString(value: any, fallback: any = {}): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value ?? fallback);
  } catch (error) {
    return JSON.stringify(fallback);
  }
}

function normalizeDeletedFlag(value: any): number {
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

export async function createMatch(storage: any, request: Request): Promise<Response> {
  const sql = storage.sql;
  const body = await request.json();  // Expect JSON: { date: "...", location: "...", ... }
  if (!body) {
    return errorResponse("No body provided", 400);
  }

  try {
    const newId = storage.transactionSync(() => {
      sql.exec(`
        INSERT INTO matches (date, location, types, opponent, jersey_color_home, jersey_color_opp, result_home, result_opp, first_server, players, temp_numbers, finalized_sets, deleted)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        body.date || null,
        body.location || null,
        coerceJsonString(body.types, {}),
        body.opponent || null,
        body.jersey_color_home || null,
        body.jersey_color_opp || null,
        normalizeScore(body.result_home),
        normalizeScore(body.result_opp),
        body.first_server || null,
        coerceJsonString(body.players, []),
        coerceJsonString(body.temp_numbers, []),
        coerceJsonString(body.finalized_sets, {}),
        normalizeDeletedFlag(body.deleted)
      );
      return sql.exec(`SELECT last_insert_rowid() AS id`).toArray()[0].id;
    });
    return jsonSuccess({ id: newId }, 201);
  } catch (error) {
    return errorResponse("Error creating match: " + (error as Error).message, 500);
  }
}

export async function setLocation(storage: any, matchId: number, location: string): Promise<Response> {
  const sql = storage.sql;
  try {
    storage.transactionSync(() => {
      sql.exec(`UPDATE matches SET location = ? WHERE id = ?`, location, matchId);
    });
    return textResponse("Location updated successfully", 200);
  } catch (error) {
    return errorResponse("Error updating location: " + (error as Error).message, 500);
  }
}

export async function setDateTime(storage: any, matchId: number, date: string): Promise<Response> {
  const sql = storage.sql;
  try {
    storage.transactionSync(() => {
      sql.exec(`UPDATE matches SET date = ? WHERE id = ?`, date, matchId);
    });
    return textResponse("Date updated successfully", 200);
  } catch (error) {
    return errorResponse("Error updating date: " + (error as Error).message, 500);
  }
}

export async function setOppName(storage: any, matchId: number, opponent: string): Promise<Response> {
  const sql = storage.sql;
  try {
    storage.transactionSync(() => {
      sql.exec(`UPDATE matches SET opponent = ? WHERE id = ?`, opponent, matchId);
    });
    return textResponse("Opponent name updated successfully", 200);
  } catch (error) {
    return errorResponse("Error updating opponent name: " + (error as Error).message, 500);
  }
}

export async function setType(storage: any, matchId: number, types: string): Promise<Response> {
  const sql = storage.sql;
  try {
    storage.transactionSync(() => {
      sql.exec(`UPDATE matches SET types = ? WHERE id = ?`, types, matchId);
    });
    return textResponse("Type updated successfully", 200);
  } catch (error) {
    return errorResponse("Error updating type: " + (error as Error).message, 500);
  }
}

export async function setResult(storage: any, matchId: number, resultHome: number | null, resultOpp: number | null): Promise<Response> {
  const sql = storage.sql;
  try {
    storage.transactionSync(() => {
      sql.exec(`UPDATE matches SET result_home = ?, result_opp = ? WHERE id = ?`, normalizeScore(resultHome), normalizeScore(resultOpp), matchId);
    });
    return textResponse("Result updated successfully", 200);
  } catch (error) {
    return errorResponse("Error updating result: " + (error as Error).message, 500);
  }
}

export async function setPlayers(storage: any, matchId: number, players: string): Promise<Response> {
  const sql = storage.sql;
  try {
    storage.transactionSync(() => {
      const rows = sql.exec(`SELECT players, temp_numbers FROM matches WHERE id = ?`, matchId).toArray();
      if (rows.length === 0) {
        throw new Error("Match not found");
      }
      const { players: normalizedPlayers, tempNumbers } = splitPlayersAndTempNumbers(players);
      const existingTemps = parseTempNumbersField(rows[0]?.temp_numbers);
      const playerIds = new Set(normalizedPlayers.map((p: any) => p?.player_id));
      const filteredTemps = existingTemps.filter((entry: any) => playerIds.has(entry?.player_id));
      const nextTemps = tempNumbers.length ? tempNumbers : filteredTemps;
      sql.exec(
        `UPDATE matches SET players = ?, temp_numbers = ? WHERE id = ?`,
        JSON.stringify(normalizedPlayers),
        JSON.stringify(nextTemps),
        matchId
      );
    });
    return textResponse("Players updated successfully", 200);
  } catch (error) {
    if ((error as Error).message === "Match not found") {
      return errorResponse("Match not found", 404);
    }
    return errorResponse("Error updating players: " + (error as Error).message, 500);
  }
}

// Helper — keep it at the top of the file or in a utils file
function playerIdFromJson(playerJson: any): number {
  const parsed = typeof playerJson === "string" ? JSON.parse(playerJson) : playerJson;
  const id = parsed?.player_id;
  if (typeof id !== "number") throw new Error("Invalid/missing player_id");
  return id;
}

function parsePlayersField(raw: any): any[] {
  if (!raw) return [];
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseTempNumbersField(raw: any): any[] {
  if (!raw) return [];
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizePlayerAndTemp(entry: any): { player: any | null; temp: any | null } {
  const playerId = entry?.player_id ?? entry?.playerId ?? entry?.id;
  if (typeof playerId !== "number") return { player: null, temp: null };

  const appearedRaw = entry?.appeared ?? entry?.active ?? entry?.selected;
  const appeared = appearedRaw === undefined ? undefined : !!appearedRaw;
  const player = appeared === undefined ? { player_id: playerId } : { player_id: playerId, appeared };

  const temp = entry?.temp_number ?? entry?.tempNumber;
  const parsedTemp = temp === null || temp === undefined || temp === "" ? null : Number(temp);
  const tempEntry = parsedTemp === null || Number.isNaN(parsedTemp) ? null : { player_id: playerId, temp_number: parsedTemp };

  return { player, temp: tempEntry };
}

function splitPlayersAndTempNumbers(rawPlayers: any): { players: any[]; tempNumbers: any[] } {
  const parsed = parsePlayersField(rawPlayers);
  const players: any[] = [];
  const tempNumbers: any[] = [];

  parsed.forEach((entry) => {
    const { player, temp } = normalizePlayerAndTemp(entry);
    if (player) players.push(player);
    if (temp) tempNumbers.push(temp);
  });

  return { players, tempNumbers };
}

function normalizeTempNumberEntry(raw: any): { player_id: number; temp_number: number } | null {
  let payload: any;
  try {
    payload = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
  const playerId = payload?.player_id ?? payload?.playerId ?? payload?.id;
  const temp = payload?.temp_number ?? payload?.tempNumber;
  const parsedTemp = temp === null || temp === undefined || temp === "" ? null : Number(temp);
  if (typeof playerId !== "number" || parsedTemp === null || Number.isNaN(parsedTemp)) {
    return null;
  }
  return { player_id: playerId, temp_number: parsedTemp };
}

function upsertTempNumber(list: any[], entry: any): any[] {
  const filtered = list.filter((p: any) => p && p.player_id !== entry.player_id);
  filtered.push(entry);
  return filtered;
}

function removeTempNumberEntry(list: any[], playerId: number): any[] {
  return list.filter((p: any) => p && p.player_id !== playerId);
}

// ————————————————————————————————————————————————————————
// 1. ADD PLAYER (you receive ready-made JSON → just append)
export async function addPlayer(storage: any, matchId: number, playerJson: string): Promise<Response> {
  let parsedPlayer: any;
  try {
    parsedPlayer = typeof playerJson === "string" ? JSON.parse(playerJson) : playerJson;
  } catch {
    return errorResponse("Invalid player JSON", 400);
  }
  if (typeof parsedPlayer?.player_id !== "number") {
    return errorResponse("Invalid player JSON", 400);
  }
  const { player: playerEntry, temp: tempEntry } = normalizePlayerAndTemp(parsedPlayer);
  if (!playerEntry) {
    return errorResponse("Invalid player JSON", 400);
  }

  try {
    storage.transactionSync(() => {
      const rows = storage.sql.exec(`SELECT players, temp_numbers FROM matches WHERE id = ?`, matchId).toArray();
      if (rows.length === 0) {
        throw new Error("Match not found");
      }
      const normalized = parsePlayersField(rows[0]?.players);
      normalized.push(playerEntry);
      const tempNumbers = parseTempNumbersField(rows[0]?.temp_numbers);
      const nextTemps = tempEntry ? upsertTempNumber(tempNumbers, tempEntry) : tempNumbers;
      storage.sql.exec(
        `UPDATE matches SET players = ?, temp_numbers = ? WHERE id = ?`,
        JSON.stringify(normalized),
        JSON.stringify(nextTemps),
        matchId
      );
    });
    return textResponse("Player added", 200);
  } catch (e) {
    console.error("addPlayer failed:", e);
    if ((e as Error).message === "Match not found") {
      return errorResponse("Match not found", 404);
    }
    return errorResponse("Failed to add player", 500);
  }
}

// ————————————————————————————————————————————————————————
// 2. REMOVE PLAYER
export async function removePlayer(storage: any, matchId: number, playerJson: string): Promise<Response> {
  let playerId: number;
  try {
    playerId = playerIdFromJson(playerJson);
  } catch {
    return errorResponse("Invalid player JSON", 400);
  }

  try {
    storage.transactionSync(() => {
      const rows = storage.sql.exec(`SELECT players, temp_numbers FROM matches WHERE id = ?`, matchId).toArray();
      if (rows.length === 0) {
        throw new Error("Match not found");
      }
      const normalized = parsePlayersField(rows[0]?.players);
      const filtered = normalized.filter((p: any) => p && p.player_id !== playerId);
      const temps = parseTempNumbersField(rows[0]?.temp_numbers);
      const nextTemps = removeTempNumberEntry(temps, playerId);
      storage.sql.exec(
        `UPDATE matches SET players = ?, temp_numbers = ? WHERE id = ?`,
        JSON.stringify(filtered),
        JSON.stringify(nextTemps),
        matchId
      );
    });
    return textResponse("Player removed", 200);
  } catch (e) {
    console.error("removePlayer failed:", e);
    if ((e as Error).message === "Match not found") {
      return errorResponse("Match not found", 404);
    }
    return errorResponse("Failed to remove player", 500);
  }
}

// ————————————————————————————————————————————————————————
// 3. UPDATE PLAYER (patch a single entry atomically)
export async function updatePlayer(storage: any, matchId: number, playerJson: string): Promise<Response> {
  let playerId: number;
  let parsedPlayer: any;
  try {
    parsedPlayer = typeof playerJson === "string" ? JSON.parse(playerJson) : playerJson;
    playerId = playerIdFromJson(parsedPlayer);
  } catch {
    return errorResponse("Invalid player JSON", 400);
  }

  try {
    storage.transactionSync(() => {
      const rows = storage.sql.exec(`SELECT players, temp_numbers FROM matches WHERE id = ?`, matchId).toArray();
      if (rows.length === 0) {
        throw new Error("Match not found");
      }
      const normalized = parsePlayersField(rows[0]?.players);
      const { player: playerPatch, temp } = normalizePlayerAndTemp(parsedPlayer);

      let matched = false;
      const updated = normalized.map((p: any) => {
        if (p && p.player_id === playerId) {
          matched = true;
          if (!playerPatch) return p;
          // Merge to avoid losing existing fields when only part of the player record changes.
          return { ...p, ...playerPatch };
        }
        return p;
      });
      if (!matched && playerPatch) {
        updated.push(playerPatch);
      }

      const temps = parseTempNumbersField(rows[0]?.temp_numbers);
      const nextTemps = temp ? upsertTempNumber(temps, temp) : temps;
      storage.sql.exec(
        `UPDATE matches SET players = ?, temp_numbers = ? WHERE id = ?`,
        JSON.stringify(updated),
        JSON.stringify(nextTemps),
        matchId
      );
    });
    return textResponse("Player updated", 200);
  } catch (e) {
    console.error("updatePlayer failed:", e);
    if ((e as Error).message === "Match not found") {
      return errorResponse("Match not found", 404);
    }
    return errorResponse("Failed to update player", 500);
  }
}

export async function addTempNumber(storage: any, matchId: number, tempNumberJson: string): Promise<Response> {
  const entry = normalizeTempNumberEntry(tempNumberJson);
  if (!entry) {
    return errorResponse("Invalid temp number payload", 400);
  }

  try {
    storage.transactionSync(() => {
      const rows = storage.sql.exec(`SELECT temp_numbers FROM matches WHERE id = ?`, matchId).toArray();
      if (rows.length === 0) {
        throw new Error("Match not found");
      }
      const temps = parseTempNumbersField(rows[0]?.temp_numbers);
      if (temps.some((p: any) => p && p.player_id === entry.player_id)) {
        throw new Error("Temp number already exists for player");
      }
      temps.push(entry);
      storage.sql.exec(`UPDATE matches SET temp_numbers = ? WHERE id = ?`, JSON.stringify(temps), matchId);
    });
    return textResponse("Temp number added", 200);
  } catch (error) {
    if ((error as Error).message === "Match not found") {
      return errorResponse("Match not found", 404);
    }
    if ((error as Error).message.includes("Temp number already exists")) {
      return errorResponse("Temp number already exists for player", 400);
    }
    return errorResponse("Failed to add temp number", 500);
  }
}

export async function updateTempNumber(storage: any, matchId: number, tempNumberJson: string): Promise<Response> {
  const entry = normalizeTempNumberEntry(tempNumberJson);
  if (!entry) {
    return errorResponse("Invalid temp number payload", 400);
  }

  try {
    storage.transactionSync(() => {
      const rows = storage.sql.exec(`SELECT temp_numbers FROM matches WHERE id = ?`, matchId).toArray();
      if (rows.length === 0) {
        throw new Error("Match not found");
      }
      const temps = parseTempNumbersField(rows[0]?.temp_numbers);
      const exists = temps.some((p: any) => p && p.player_id === entry.player_id);
      if (!exists) {
        throw new Error("Temp number not found");
      }
      const next = upsertTempNumber(temps, entry);
      storage.sql.exec(`UPDATE matches SET temp_numbers = ? WHERE id = ?`, JSON.stringify(next), matchId);
    });
    return textResponse("Temp number updated", 200);
  } catch (error) {
    if ((error as Error).message === "Match not found") {
      return errorResponse("Match not found", 404);
    }
    if ((error as Error).message === "Temp number not found") {
      return errorResponse("Temp number not found for player", 404);
    }
    return errorResponse("Failed to update temp number", 500);
  }
}

export async function removeTempNumber(storage: any, matchId: number, tempNumberJson: string): Promise<Response> {
  const entry = normalizeTempNumberEntry(tempNumberJson);
  let playerId = entry?.player_id ?? (typeof tempNumberJson === "number" ? tempNumberJson : undefined);
  if (playerId === undefined) {
    try {
      playerId = playerIdFromJson(tempNumberJson);
    } catch {
      // noop
    }
  }
  if (typeof playerId !== "number") {
    return errorResponse("Invalid temp number payload", 400);
  }

  try {
    storage.transactionSync(() => {
      const rows = storage.sql.exec(`SELECT temp_numbers FROM matches WHERE id = ?`, matchId).toArray();
      if (rows.length === 0) {
        throw new Error("Match not found");
      }
      const temps = parseTempNumbersField(rows[0]?.temp_numbers);
      const exists = temps.some((p: any) => p && p.player_id === playerId);
      if (!exists) {
        throw new Error("Temp number not found");
      }
      const next = removeTempNumberEntry(temps, playerId);
      storage.sql.exec(`UPDATE matches SET temp_numbers = ? WHERE id = ?`, JSON.stringify(next), matchId);
    });
    return textResponse("Temp number removed", 200);
  } catch (error) {
    if ((error as Error).message === "Match not found") {
      return errorResponse("Match not found", 404);
    }
    if ((error as Error).message === "Temp number not found") {
      return errorResponse("Temp number not found for player", 404);
    }
    return errorResponse("Failed to remove temp number", 500);
  }
}

export async function setDeleted(storage: any, matchId: number, deleted: any): Promise<Response> {
  const sql = storage.sql;
  try {
    storage.transactionSync(() => {
      sql.exec(`UPDATE matches SET deleted = ? WHERE id = ?`, normalizeDeletedFlag(deleted), matchId);
    });
    return textResponse("Deleted flag updated successfully", 200);
  } catch (error) {
    return errorResponse("Error updating deleted flag: " + (error as Error).message, 500);
  }
}

export async function setHomeColor(storage: any, matchId: number, jerseyColorHome: string): Promise<Response> {
  const sql = storage.sql;
  try {
    storage.transactionSync(() => {
      sql.exec(`UPDATE matches SET jersey_color_home = ? WHERE id = ?`, jerseyColorHome, matchId);
    });
    return textResponse("Home jersey color updated successfully", 200);
  } catch (error) {
    return errorResponse("Error updating home jersey color: " + (error as Error).message, 500);
  }
}

export async function setOppColor(storage: any, matchId: number, jerseyColorOpp: string): Promise<Response> {
  const sql = storage.sql;
  try {
    storage.transactionSync(() => {
      sql.exec(`UPDATE matches SET jersey_color_opp = ? WHERE id = ?`, jerseyColorOpp, matchId);
    });
    return textResponse("Opponent jersey color updated successfully", 200);
  } catch (error) {
    return errorResponse("Error updating opponent jersey color: " + (error as Error).message, 500);
  }
}

export async function setFirstServer(storage: any, matchId: number, firstServer: string): Promise<Response> {
  const sql = storage.sql;
  try {
    storage.transactionSync(() => {
      sql.exec(`UPDATE matches SET first_server = ? WHERE id = ?`, firstServer, matchId);
    });
    return textResponse("First server updated successfully", 200);
  } catch (error) {
    return errorResponse("Error updating first server: " + (error as Error).message, 500);
  }
}

export async function getMatches(storage: any): Promise<Response> {
  const sql = storage.sql;
  const matchesCursor = sql.exec(`SELECT * FROM matches`);
  const matchRows = matchesCursor.toArray();
  return jsonResponse(matchRows);
}

export async function getMatch(storage: any, matchId: number): Promise<Response> {
  const sql = storage.sql;
  try {
    const cursor = sql.exec(`SELECT * FROM matches WHERE id = ?`, matchId);
    const matchRow = cursor.toArray()[0] || null;
    if (!matchRow) {
      return errorResponse("Match not found", 404);
    }
    return jsonResponse(matchRow);
  } catch (error) {
    return errorResponse("Error fetching match: " + (error as Error).message, 500);
  }
}

export async function deleteMatch(storage: any, matchId: number): Promise<Response> {
  const sql = storage.sql;
  const parsedId = Number(matchId);
  if (!Number.isInteger(parsedId) || parsedId < 1) {
    return errorResponse("Invalid match id", 400);
  }
  try {
    const existing = sql.exec(`SELECT id FROM matches WHERE id = ?`, parsedId).toArray();
    if (existing.length === 0) {
      return errorResponse("Match not found", 404);
    }

    storage.transactionSync(() => {
      // Delete child sets first to keep DB tidy even if FK constraints are off
      sql.exec(`DELETE FROM sets WHERE match_id = ?`, parsedId);
      sql.exec(`DELETE FROM matches WHERE id = ?`, parsedId);
    });
    return textResponse("Match deleted successfully", 200);
  } catch (error) {
    return errorResponse("Error deleting match: " + (error as Error).message, 500);
  }
}
