// src/api/match.ts
import { jsonSuccess, textResponse, errorResponse, jsonResponse } from "../utils/responses";  // Add this import

export async function createMatch(storage: any, request: Request): Promise<Response> {
  const sql = storage.sql;
  const body = await request.json();  // Expect JSON: { date: "...", location: "...", ... }
  if (!body) {
    return errorResponse("No body provided", 400);
  }

  try {
    const newId = storage.transactionSync(() => {
      sql.exec(`
        INSERT INTO matches (date, location, types, opponent, jersey_color_home, jersey_color_opp, result_home, result_opp, first_server, players, finalized_sets, is_swapped)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, body.date || null, body.location || null, body.types || null, body.opponent || null, body.jersey_color_home || null, body.jersey_color_opp || null, body.result_home || 0, body.result_opp || 0, body.first_server || null, body.players || null, body.finalized_sets || null, body.is_swapped || 0);
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

export async function setResult(storage: any, matchId: number, resultHome: number, resultOpp: number): Promise<Response> {
  const sql = storage.sql;
  try {
    storage.transactionSync(() => {
      sql.exec(`UPDATE matches SET result_home = ?, result_opp = ? WHERE id = ?`, resultHome, resultOpp, matchId);
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

export async function getSets(storage: any, matchId: number): Promise<Response> {
  const sql = storage.sql;
  const cursor = sql.exec(`SELECT * FROM sets WHERE match_id = ?`, matchId);
  const rows = cursor.toArray();
  return jsonResponse(rows);
}

export async function getMatches(storage: any): Promise<Response> {
  const sql = storage.sql;
  const cursor = sql.exec(`SELECT * FROM matches`);
  const rows = cursor.toArray();
  return jsonResponse(rows);
}