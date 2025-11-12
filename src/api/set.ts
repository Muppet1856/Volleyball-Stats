// src/api/set.ts
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

function normalizeTimeout(value: any): number {
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

export async function createSet(storage: any, request: Request): Promise<Response> {
  const sql = storage.sql;
  const body = await request.json();  // Expect JSON: { match_id: number, set_number: 1-5, ... }
  if (!body) {
    return errorResponse("No body provided", 400);
  }

  const matchId = Number(body.match_id);
  const setNumber = Number(body.set_number);
  if (!Number.isInteger(matchId) || !Number.isInteger(setNumber) || setNumber < 1 || setNumber > 5) {
    return errorResponse("Invalid match or set identifier", 400);
  }

  try {
    const newId = storage.transactionSync(() => {
      sql.exec(`
        INSERT INTO sets (match_id, set_number, home_score, opp_score, home_timeout_1, home_timeout_2, opp_timeout_1, opp_timeout_2)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
        matchId,
        setNumber,
        normalizeScore(body.home_score),
        normalizeScore(body.opp_score),
        normalizeTimeout(body.home_timeout_1),
        normalizeTimeout(body.home_timeout_2),
        normalizeTimeout(body.opp_timeout_1),
        normalizeTimeout(body.opp_timeout_2)
      );
      return sql.exec(`SELECT last_insert_rowid() AS id`).toArray()[0].id;
    });
    return jsonSuccess({ id: newId }, 201);
  } catch (error) {
    return errorResponse("Error creating set: " + (error as Error).message, 500);
  }
}

export async function setHomeScore(storage: any, setId: number, homeScore: number | null): Promise<Response> {
  const sql = storage.sql;
  try {
    storage.transactionSync(() => {
      sql.exec(`UPDATE sets SET home_score = ? WHERE id = ?`, normalizeScore(homeScore), setId);
    });
    return textResponse("Home score updated successfully", 200);
  } catch (error) {
    return errorResponse("Error updating home score: " + (error as Error).message, 500);
  }
}

export async function setOppScore(storage: any, setId: number, oppScore: number | null): Promise<Response> {
  const sql = storage.sql;
  try {
    storage.transactionSync(() => {
      sql.exec(`UPDATE sets SET opp_score = ? WHERE id = ?`, normalizeScore(oppScore), setId);
    });
    return textResponse("Opponent score updated successfully", 200);
  } catch (error) {
    return errorResponse("Error updating opponent score: " + (error as Error).message, 500);
  }
}

export async function setHomeTimeout(storage: any, setId: number, timeoutNumber: 1 | 2, value: 0 | 1): Promise<Response> {
  const sql = storage.sql;
  const field = timeoutNumber === 1 ? 'home_timeout_1' : 'home_timeout_2';
  try {
    storage.transactionSync(() => {
      sql.exec(`UPDATE sets SET ${field} = ? WHERE id = ?`, normalizeTimeout(value), setId);
    });
    return textResponse("Home timeout updated successfully", 200);
  } catch (error) {
    return errorResponse("Error updating home timeout: " + (error as Error).message, 500);
  }
}

export async function setOppTimeout(storage: any, setId: number, timeoutNumber: 1 | 2, value: 0 | 1): Promise<Response> {
  const sql = storage.sql;
  const field = timeoutNumber === 1 ? 'opp_timeout_1' : 'opp_timeout_2';
  try {
    storage.transactionSync(() => {
      sql.exec(`UPDATE sets SET ${field} = ? WHERE id = ?`, normalizeTimeout(value), setId);
    });
    return textResponse("Opponent timeout updated successfully", 200);
  } catch (error) {
    return errorResponse("Error updating opponent timeout: " + (error as Error).message, 500);
  }
}

export async function setIsFinal(storage: any, matchId: number, finalizedSets: string): Promise<Response> {
  const sql = storage.sql;
  // Assuming 'finalized_sets' is in matches table; update there
  try {
    storage.transactionSync(() => {
      sql.exec(`UPDATE matches SET finalized_sets = ? WHERE id = ?`, finalizedSets, matchId);
    });
    return textResponse("Finalized sets updated successfully", 200);
  } catch (error) {
    return errorResponse("Error updating finalized sets: " + (error as Error).message, 500);
  }
}

export async function getSet(storage: any, setId: number): Promise<Response> {
  const sql = storage.sql;
  const cursor = sql.exec(`SELECT * FROM sets WHERE id = ?`, setId);
  const row = cursor.toArray()[0] || null;
  return jsonResponse(row);
}

export async function getSets(storage: any, matchId?: number): Promise<Response> {
  const sql = storage.sql;
  let query = `SELECT * FROM sets`;
  let params: any[] = [];
  if (matchId !== undefined && matchId !== null && !Number.isNaN(matchId)) {
    query += ` WHERE match_id = ?`;
    params.push(matchId);
  }
  const cursor = sql.exec(query, ...params);
  const rows = cursor.toArray();
  return jsonResponse(rows);
}

export async function deleteSet(storage: any, setId: number): Promise<Response> {
  const sql = storage.sql;
  try {
    storage.transactionSync(() => {
      sql.exec(`DELETE FROM sets WHERE id = ?`, setId);
    });
    return textResponse("Set deleted successfully", 200);
  } catch (error) {
    return errorResponse("Error deleting set: " + (error as Error).message, 500);
  }
}