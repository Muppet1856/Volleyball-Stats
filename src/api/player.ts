// src/api/player.ts (updated with responses.ts import and usage)
import { jsonSuccess, textResponse, errorResponse, jsonResponse } from "../utils/responses";  // Add this import

export async function createPlayer(sql: any, request: Request): Promise<Response> {
  const body = await request.json();  // Expect JSON: { number: "...", last_name: "...", initial: "..." }
  if (body) {
    sql.exec('BEGIN;');
    try {
      sql.exec(`
        INSERT INTO players (number, last_name, initial)
        VALUES (?, ?, ?)
      `, body.number, body.last_name, body.initial || '');
      const newId = sql.exec(`SELECT last_insert_rowid()`).toArray()[0][0];
      sql.exec('COMMIT;');
      return jsonSuccess({ id: newId }, 201);  // Updated with responses.ts
    } catch (error) {
      sql.exec('ROLLBACK;');
      return errorResponse("Error creating player: " + (error as Error).message, 500);  // Updated with responses.ts
    }
  } else {
    return errorResponse("No body provided", 400);  // Updated with responses.ts
  }
}

export async function setPlayerLName(sql: any, playerId: number, lastName: string): Promise<Response> {
  sql.exec('BEGIN;');
  try {
    sql.exec(`UPDATE players SET last_name = ? WHERE id = ?`, lastName, playerId);
    sql.exec('COMMIT;');
    return textResponse("Last name updated successfully", 200);  // Updated with responses.ts
  } catch (error) {
    sql.exec('ROLLBACK;');
    return errorResponse("Error updating last name: " + (error as Error).message, 500);  // Updated with responses.ts
  }
}

export async function setPlayerFName(sql: any, playerId: number, initial: string): Promise<Response> {
  sql.exec('BEGIN;');
  try {
    sql.exec(`UPDATE players SET initial = ? WHERE id = ?`, initial, playerId);
    sql.exec('COMMIT;');
    return textResponse("Initial/First name updated successfully", 200);  // Updated with responses.ts
  } catch (error) {
    sql.exec('ROLLBACK;');
    return errorResponse("Error updating initial/first name: " + (error as Error).message, 500);  // Updated with responses.ts
  }
}

export async function setPlayerNumber(sql: any, playerId: number, number: string): Promise<Response> {
  sql.exec('BEGIN;');
  try {
    sql.exec(`UPDATE players SET number = ? WHERE id = ?`, number, playerId);
    sql.exec('COMMIT;');
    return textResponse("Player number updated successfully", 200);  // Updated with responses.ts
  } catch (error) {
    sql.exec('ROLLBACK;');
    return errorResponse("Error updating player number: " + (error as Error).message, 500);  // Updated with responses.ts
  }
}

export async function getPlayer(sql: any, playerId: number): Promise<Response> {
  const cursor = sql.exec(`SELECT * FROM players WHERE id = ?`, playerId);
  const row = cursor.toArray()[0] || null;
  return jsonResponse(row);  // Updated with responses.ts
}

export async function getPlayers(sql: any): Promise<Response> {
  const cursor = sql.exec(`SELECT * FROM players`);
  const rows = cursor.toArray();
  return jsonResponse(rows);  // Updated with responses.ts
}