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
        INSERT INTO matches (date, location, types, opponent, jersey_color_home, jersey_color_opp, result_home, result_opp, first_server, players, finalized_sets, deleted)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      sql.exec(`UPDATE matches SET players = ? WHERE id = ?`, players, matchId);
    });
    return textResponse("Players updated successfully", 200);
  } catch (error) {
    return errorResponse("Error updating players: " + (error as Error).message, 500);
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

export async function deleteMatch(storage: any, matchId: number): Promise<Response> {
  const sql = storage.sql;
  try {
    storage.transactionSync(() => {
      sql.exec(`DELETE FROM matches WHERE id = ?`, matchId);
    });
    return textResponse("Match deleted successfully", 200);
  } catch (error) {
    return errorResponse("Error deleting match: " + (error as Error).message, 500);
  }
}
