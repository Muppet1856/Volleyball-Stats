// src/api/set.ts
import { jsonSuccess, errorResponse, jsonResponse } from "../utils/responses";  // Add this import

export interface ScoreBroadcastUpdate {
  type: string;
  matchId: number;
  setNumber: number | null;
  payload: Record<string, any>;
}

export type ScoreBroadcastCallback = (update: ScoreBroadcastUpdate) => void;

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

export function parseFinalizedSetsColumn(value: any): Record<number, boolean> {
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
  notify: ScoreBroadcastCallback | undefined,
  type: ScoreBroadcastUpdate["type"]
): Response {
  const sql = storage.sql;
  const normalizedScore = normalizeScore(scoreValue);
  try {
    const context = storage.transactionSync(() => {
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
      sql.exec(`UPDATE sets SET ${column} = ? WHERE id = ?`, normalizedScore, setId);
      return { matchId, setNumber };
    });

    const payload = column === "home_score" ? { homeScore: normalizedScore } : { oppScore: normalizedScore };
    notify?.({
      type,
      matchId: context.matchId,
      setNumber: context.setNumber,
      payload,
    });
    return jsonSuccess({ matchId: context.matchId, setNumber: context.setNumber, ...payload }, 200);
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === SET_NOT_FOUND_ERROR) {
        return errorResponse("Set not found", 404);
      }
      return errorResponse(`Error updating score: ${error.message}`, 500);
    }
    return errorResponse("Error updating score: Unknown error", 500);
  }
}

export async function createSet(storage: any, request: Request, notify?: ScoreBroadcastCallback): Promise<Response> {
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
    const normalizedHomeTimeout1 = normalizeTimeout(body.home_timeout_1);
    const normalizedHomeTimeout2 = normalizeTimeout(body.home_timeout_2);
    const normalizedOppTimeout1 = normalizeTimeout(body.opp_timeout_1);
    const normalizedOppTimeout2 = normalizeTimeout(body.opp_timeout_2);
    const normalizedHomeScore = normalizeScore(body.home_score);
    const normalizedOppScore = normalizeScore(body.opp_score);

    const result = storage.transactionSync(() => {
      sql.exec(`
        INSERT INTO sets (match_id, set_number, home_score, opp_score, home_timeout_1, home_timeout_2, opp_timeout_1, opp_timeout_2)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
        matchId,
        setNumber,
        normalizedHomeScore,
        normalizedOppScore,
        normalizedHomeTimeout1,
        normalizedHomeTimeout2,
        normalizedOppTimeout1,
        normalizedOppTimeout2
      );
      return sql.exec(`SELECT last_insert_rowid() AS id`).toArray()[0].id;
    });

    const payload = {
      id: Number(result),
      homeScore: normalizedHomeScore,
      oppScore: normalizedOppScore,
      homeTimeouts: {
        1: normalizedHomeTimeout1,
        2: normalizedHomeTimeout2,
      },
      oppTimeouts: {
        1: normalizedOppTimeout1,
        2: normalizedOppTimeout2,
      },
    };

    notify?.({
      type: "createSet",
      matchId,
      setNumber,
      payload,
    });

    return jsonSuccess({ matchId, setNumber, ...payload }, 201);
  } catch (error) {
    return errorResponse("Error creating set: " + (error as Error).message, 500);
  }
}

export async function setHomeScore(
  storage: any,
  setId: number,
  homeScore: number | null,
  notify?: ScoreBroadcastCallback
): Promise<Response> {
  return updateScoreWithFinalizedGuard(
    storage,
    setId,
    "home_score",
    homeScore,
    notify,
    "setHomeScore"
  );
}

export async function setOppScore(
  storage: any,
  setId: number,
  oppScore: number | null,
  notify?: ScoreBroadcastCallback
): Promise<Response> {
  return updateScoreWithFinalizedGuard(
    storage,
    setId,
    "opp_score",
    oppScore,
    notify,
    "setOppScore"
  );
}

export async function setHomeTimeout(
  storage: any,
  setId: number,
  timeoutNumber: 1 | 2,
  value: 0 | 1,
  notify?: ScoreBroadcastCallback
): Promise<Response> {
  const sql = storage.sql;
  const field = timeoutNumber === 1 ? 'home_timeout_1' : 'home_timeout_2';
  try {
    const normalizedValue = normalizeTimeout(value);
    const context = storage.transactionSync(() => {
      const setCursor = sql.exec(`SELECT match_id, set_number FROM sets WHERE id = ?`, setId);
      const setRow = setCursor.toArray()[0];
      if (!setRow) {
        throw new Error(SET_NOT_FOUND_ERROR);
      }
      sql.exec(`UPDATE sets SET ${field} = ? WHERE id = ?`, normalizedValue, setId);
      return {
        matchId: Number(setRow.match_id),
        setNumber: Number(setRow.set_number),
      };
    });

    const payload = { timeoutNumber, value: normalizedValue };
    notify?.({
      type: "setHomeTimeout",
      matchId: context.matchId,
      setNumber: context.setNumber,
      payload,
    });

    return jsonSuccess({ matchId: context.matchId, setNumber: context.setNumber, ...payload }, 200);
  } catch (error) {
    if (error instanceof Error && error.message === SET_NOT_FOUND_ERROR) {
      return errorResponse("Set not found", 404);
    }
    return errorResponse("Error updating home timeout: " + (error as Error).message, 500);
  }
}

export async function setOppTimeout(
  storage: any,
  setId: number,
  timeoutNumber: 1 | 2,
  value: 0 | 1,
  notify?: ScoreBroadcastCallback
): Promise<Response> {
  const sql = storage.sql;
  const field = timeoutNumber === 1 ? 'opp_timeout_1' : 'opp_timeout_2';
  try {
    const normalizedValue = normalizeTimeout(value);
    const context = storage.transactionSync(() => {
      const setCursor = sql.exec(`SELECT match_id, set_number FROM sets WHERE id = ?`, setId);
      const setRow = setCursor.toArray()[0];
      if (!setRow) {
        throw new Error(SET_NOT_FOUND_ERROR);
      }
      sql.exec(`UPDATE sets SET ${field} = ? WHERE id = ?`, normalizedValue, setId);
      return {
        matchId: Number(setRow.match_id),
        setNumber: Number(setRow.set_number),
      };
    });

    const payload = { timeoutNumber, value: normalizedValue };
    notify?.({
      type: "setOppTimeout",
      matchId: context.matchId,
      setNumber: context.setNumber,
      payload,
    });

    return jsonSuccess({ matchId: context.matchId, setNumber: context.setNumber, ...payload }, 200);
  } catch (error) {
    if (error instanceof Error && error.message === SET_NOT_FOUND_ERROR) {
      return errorResponse("Set not found", 404);
    }
    return errorResponse("Error updating opponent timeout: " + (error as Error).message, 500);
  }
}

export async function setIsFinal(
  storage: any,
  matchId: number,
  finalizedSets: string,
  notify?: ScoreBroadcastCallback
): Promise<Response> {
  const sql = storage.sql;
  // Assuming 'finalized_sets' is in matches table; update there
  try {
    storage.transactionSync(() => {
      sql.exec(`UPDATE matches SET finalized_sets = ? WHERE id = ?`, finalizedSets, matchId);
    });

    const parsedFinalizedSets = parseFinalizedSetsColumn(finalizedSets);

    notify?.({
      type: "setIsFinal",
      matchId,
      setNumber: null,
      payload: { finalizedSets: parsedFinalizedSets },
    });

    return jsonSuccess({ matchId, setNumber: null, finalizedSets: parsedFinalizedSets }, 200);
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

export async function deleteSet(storage: any, setId: number, notify?: ScoreBroadcastCallback): Promise<Response> {
  const sql = storage.sql;
  try {
    const context = storage.transactionSync(() => {
      const setCursor = sql.exec(`SELECT match_id, set_number FROM sets WHERE id = ?`, setId);
      const setRow = setCursor.toArray()[0];
      if (!setRow) {
        throw new Error(SET_NOT_FOUND_ERROR);
      }
      sql.exec(`DELETE FROM sets WHERE id = ?`, setId);
      return {
        matchId: Number(setRow.match_id),
        setNumber: Number(setRow.set_number),
      };
    });

    const payload = { id: setId };
    notify?.({
      type: "deleteSet",
      matchId: context.matchId,
      setNumber: context.setNumber,
      payload,
    });

    return jsonSuccess({ matchId: context.matchId, setNumber: context.setNumber, ...payload, deleted: true }, 200);
  } catch (error) {
    if (error instanceof Error && error.message === SET_NOT_FOUND_ERROR) {
      return errorResponse("Set not found", 404);
    }
    return errorResponse("Error deleting set: " + (error as Error).message, 500);
  }
}