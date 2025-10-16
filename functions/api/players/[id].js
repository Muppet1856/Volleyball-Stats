export async function onRequest(context) {
  const { request, env, params } = context;
  const id = Number.parseInt(params.id, 10);
  if (!Number.isInteger(id)) {
    return Response.json({ error: 'Invalid player id' }, { status: 400 });
  }

  switch (request.method.toUpperCase()) {
    case 'PUT':
      return handleUpdatePlayer(request, env, id);
    case 'DELETE':
      return handleDeletePlayer(env, id);
    default:
      return methodNotAllowed(['PUT', 'DELETE']);
  }
}

function methodNotAllowed(allowed) {
  return new Response('Method Not Allowed', {
    status: 405,
    headers: { 'Allow': allowed.join(', ') }
  });
}

async function handleUpdatePlayer(request, env, id) {
  let body;
  try {
    body = await request.json();
  } catch (error) {
    return Response.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }
  const number = String(body?.number ?? '').trim();
  const lastName = String(body?.lastName ?? '').trim();
  const initial = String(body?.initial ?? '').trim();
  if (!number || !lastName) {
    return Response.json({ error: 'Player number and last name are required' }, { status: 400 });
  }
  try {
    const statement = env.VOLLEYBALL_STATS_DB.prepare(
      'UPDATE players SET number = ?, last_name = ?, initial = ? WHERE id = ?'
    ).bind(number, lastName, initial, id);
    const result = await statement.run();
    if (!result?.meta || result.meta.changes === 0) {
      return Response.json({ error: 'Player not found' }, { status: 404 });
    }
    return Response.json({ id, number, lastName, initial });
  } catch (error) {
    console.error('Failed to update player', error);
    return Response.json({ error: 'Failed to update player' }, { status: 500 });
  }
}

async function handleDeletePlayer(env, id) {
  try {
    const result = await env.VOLLEYBALL_STATS_DB.prepare(
      'DELETE FROM players WHERE id = ?'
    ).bind(id).run();
    if (!result?.meta || result.meta.changes === 0) {
      return Response.json({ error: 'Player not found' }, { status: 404 });
    }
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error('Failed to delete player', error);
    return Response.json({ error: 'Failed to delete player' }, { status: 500 });
  }
}
