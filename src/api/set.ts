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

const SET_NOT_FOUND_ERROR = "SET_NOT_FOUND";
const SET_FINALIZED_ERROR = "SET_FINALIZED";

function parseFinalizedSetsColumn(value: any): Record<number, boolean> {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") {
      return {};
    }
    try {
      return parseFinalizedSetsColumn(JSON.parse(trimmed));
    } catch (error) {
      return {};
    }
  }
  if (!value || typeof value !== "object") {
    return {};
  }
  const result: Record<number, boolean> = {};
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      let setNumber: number;
      if (entry && typeof entry === "object") {
        if ("setNumber" in entry) {
          setNumber = Number((entry as any).setNumber);
        } else if ("set_number" in entry) {
          setNumber = Number((entry as any).set_number);
        } else {
          setNumber = index + 1;
        }
      } else {
        setNumber = index + 1;
      }
      if (!Number.isInteger(setNumber) || setNumber < 1 || setNumber > 5) {
        return;
      }
      let isFinal: boolean;
      if (entry && typeof entry === "object" && "finalized" in entry) {
        isFinal = Boolean((entry as any).finalized);
      } else if (entry && typeof entry === "object" && "final" in entry) {
        isFinal = Boolean((entry as any).final);
      } else {
        isFinal = Boolean(entry);
      }
      result[setNumber] = isFinal;
    });
    return result;
  }
  Object.entries(value).forEach(([key, val]) => {
    const setNumber = Number(key);
    if (!Number.isInteger(setNumber) || setNumber < 1 || setNumber > 5) {
      return;
    }
    result[setNumber] = Boolean(val);
  });
  return result;
}

function updateScoreWithFinalizedGuard(
  storage: any,
  setId: number,
  column: "home_score" | "opp_score",
  scoreValue: number | null,
  successMessage: string,
  errorPrefix: string
): Response {
  const sql = storage.sql;
  try {
    storage.transactionSync(() => {
      const setCursor = sql.exec(`SELECT match_id, set_number FROM sets WHERE id = ?`, setId);
      const setRow = setCursor.toArray()[0];
      if (!setRow) {
        throw new Error(SET_NOT_FOUND_ERROR);
      }
      const matchId = Number(setRow.match_id);
      const setNumber = Number(setRow.set_number);
      if (!Number.isInteger(matchId) || !Number.isInteger(setNumber)) {
        throw new Error(SET_NOT_FOUND_ERROR);
      }
      const matchCursor = sql.exec(`SELECT finalized_sets FROM matches WHERE id = ?`, matchId);
      const matchRow = matchCursor.toArray()[0];
      if (!matchRow) {
        throw new Error(SET_NOT_FOUND_ERROR);
      }
      const finalizedSets = parseFinalizedSetsColumn(matchRow.finalized_sets);
      if (finalizedSets[setNumber]) {
        throw new Error(SET_FINALIZED_ERROR);
      }
      sql.exec(`UPDATE sets SET ${column} = ? WHERE id = ?`, normalizeScore(scoreValue), setId);
    });
    return textResponse(successMessage, 200);
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === SET_NOT_FOUND_ERROR) {
        return errorResponse("Set not found", 404);
      }
      if (error.message === SET_FINALIZED_ERROR) {
        return errorResponse("Set is finalized; scores cannot be updated", 409);
      }
      return errorResponse(`${errorPrefix}: ${error.message}`, 500);
    }
    return errorResponse(`${errorPrefix}: Unknown error`, 500);
  }
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
  return updateScoreWithFinalizedGuard(
    storage,
    setId,
    "home_score",
    homeScore,
    "Home score updated successfully",
    "Error updating home score"
  );
}

export async function setOppScore(storage: any, setId: number, oppScore: number | null): Promise<Response> {
  return updateScoreWithFinalizedGuard(
    storage,
    setId,
    "opp_score",
    oppScore,
    "Opponent score updated successfully",
    "Error updating opponent score"
  );
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