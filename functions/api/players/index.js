export async function onRequest(context) {
  const { request, env } = context;
  switch (request.method.toUpperCase()) {
    case 'GET':
      return handleGetPlayers(env);
    case 'POST':
      return handleCreatePlayer(request, env);
    default:
      return methodNotAllowed(['GET', 'POST']);
  }
}

function methodNotAllowed(allowed) {
  return new Response('Method Not Allowed', {
    status: 405,
    headers: { 'Allow': allowed.join(', ') }
  });
}

async function handleGetPlayers(env) {
  try {
    const statement = env.VOLLEYBALL_STATS_DB.prepare(
      'SELECT id, number, last_name AS lastName, initial FROM players ORDER BY CAST(number AS INTEGER) ASC, last_name ASC, id ASC'
    );
    const { results } = await statement.all();
    return Response.json(results || []);
  } catch (error) {
    console.error('Failed to fetch players', error);
    return Response.json({ error: 'Failed to fetch players' }, { status: 500 });
  }
}

async function handleCreatePlayer(request, env) {
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
      'INSERT INTO players (number, last_name, initial) VALUES (?, ?, ?)'
    ).bind(number, lastName, initial);
    const result = await statement.run();
    const id = result?.meta?.last_row_id;
    return Response.json({ id, number, lastName, initial }, { status: 201 });
  } catch (error) {
    console.error('Failed to create player', error);
    return Response.json({ error: 'Failed to create player' }, { status: 500 });
  }
}
