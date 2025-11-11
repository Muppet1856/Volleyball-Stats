// src/api/set.ts
import { jsonSuccess, textResponse, errorResponse, jsonResponse } from "../utils/responses";  // Add this import

export async function createSet(storage: any, request: Request): Promise<Response> {
  const sql = storage.sql;
  const body = await request.json();  // Expect JSON: { match_id: number, set_number: 1-5, ... }
  if (!body) {
    return errorResponse("No body provided", 400);
  }

  try {
    const newId = storage.transactionSync(() => {
      sql.exec(`
        INSERT INTO sets (match_id, set_number, home_score, opp_score, home_timeout_1, home_timeout_2, opp_timeout_1, opp_timeout_2)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, body.match_id, body.set_number, body.home_score || 0, body.opp_score || 0, body.home_timeout_1 || 0, body.home_timeout_2 || 0, body.opp_timeout_1 || 0, body.opp_timeout_2 || 0);
      return sql.exec(`SELECT last_insert_rowid() AS id`).toArray()[0].id;
    });
    return jsonSuccess({ id: newId }, 201);
  } catch (error) {
    return errorResponse("Error creating set: " + (error as Error).message, 500);
  }
}

export async function setHomeScore(storage: any, setId: number, homeScore: number): Promise<Response> {
  const sql = storage.sql;
  try {
    storage.transactionSync(() => {
      sql.exec(`UPDATE sets SET home_score = ? WHERE id = ?`, homeScore, setId);
    });
    return textResponse("Home score updated successfully", 200);
  } catch (error) {
    return errorResponse("Error updating home score: " + (error as Error).message, 500);
  }
}

export async function setOppScore(storage: any, setId: number, oppScore: number): Promise<Response> {
  const sql = storage.sql;
  try {
    storage.transactionSync(() => {
      sql.exec(`UPDATE sets SET opp_score = ? WHERE id = ?`, oppScore, setId);
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
      sql.exec(`UPDATE sets SET ${field} = ? WHERE id = ?`, value, setId);
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
      sql.exec(`UPDATE sets SET ${field} = ? WHERE id = ?`, value, setId);
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
  if (matchId) {
    query += ` WHERE match_id = ?`;
    params.push(matchId);
  }
  const cursor = sql.exec(query, ...params);
  const rows = cursor.toArray();
  return jsonResponse(rows);
}