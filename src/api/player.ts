// src/api/player.ts
import { jsonSuccess, textResponse, errorResponse, jsonResponse } from "../utils/responses";  // Add this import

export async function createPlayer(storage: any, request: Request): Promise<Response> {
  const sql = storage.sql;
  const body = await request.json();  // Expect JSON: { number: "...", last_name: "...", initial: "..." }
  if (!body) {
    return errorResponse("No body provided", 400);
  }

  try {
    const newId = storage.transactionSync(() => {
      sql.exec(`
        INSERT INTO players (number, last_name, initial)
        VALUES (?, ?, ?)
      `, body.number, body.last_name, body.initial || '');
      return sql.exec(`SELECT last_insert_rowid() AS id`).toArray()[0].id;
    });
    return jsonSuccess({ id: newId }, 201);
  } catch (error) {
    return errorResponse("Error creating player: " + (error as Error).message, 500);
  }
}

export async function setPlayerLName(storage: any, playerId: number, lastName: string): Promise<Response> {
  const sql = storage.sql;
  try {
    storage.transactionSync(() => {
      sql.exec(`UPDATE players SET last_name = ? WHERE id = ?`, lastName, playerId);
    });
    return textResponse("Last name updated successfully", 200);
  } catch (error) {
    return errorResponse("Error updating last name: " + (error as Error).message, 500);
  }
}

export async function setPlayerFName(storage: any, playerId: number, initial: string): Promise<Response> {
  const sql = storage.sql;
  try {
    storage.transactionSync(() => {
      sql.exec(`UPDATE players SET initial = ? WHERE id = ?`, initial, playerId);
    });
    return textResponse("Initial/First name updated successfully", 200);
  } catch (error) {
    return errorResponse("Error updating initial/first name: " + (error as Error).message, 500);
  }
}

export async function setPlayerNumber(storage: any, playerId: number, number: string): Promise<Response> {
  const sql = storage.sql;
  try {
    storage.transactionSync(() => {
      sql.exec(`UPDATE players SET number = ? WHERE id = ?`, number, playerId);
    });
    return textResponse("Player number updated successfully", 200);
  } catch (error) {
    return errorResponse("Error updating player number: " + (error as Error).message, 500);
  }
}

export async function getPlayer(storage: any, playerId: number): Promise<Response> {
  const sql = storage.sql;
  const cursor = sql.exec(`SELECT * FROM players WHERE id = ?`, playerId);
  const row = cursor.toArray()[0] || null;
  return jsonResponse(row);
}

export async function getPlayers(storage: any): Promise<Response> {
  const sql = storage.sql;
  const cursor = sql.exec(`SELECT * FROM players`);
  const rows = cursor.toArray();
  return jsonResponse(rows);
}

export async function deletePlayer(storage: any, playerId: number): Promise<Response> {
  const sql = storage.sql;
  try {
    storage.transactionSync(() => {
      sql.exec(`DELETE FROM players WHERE id = ?`, playerId);
    });
    return textResponse("Player deleted successfully", 200);
  } catch (error) {
    return errorResponse("Error deleting player: " + (error as Error).message, 500);
  }
}
