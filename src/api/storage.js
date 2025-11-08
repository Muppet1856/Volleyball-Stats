const BINDING_CANDIDATES = [
  'VOLLEYBALL_STATS_DO',
  'VOLLEYBALL_STATS_DURABLE_OBJECT',
  'VOLLEYBALL_STATS',
  'volleyballStatsDO',
  'volleyball_stats_do',
  'statsDo'
];

function getBinding(env) {
  for (const name of BINDING_CANDIDATES) {
    if (env && env[name]) {
      return env[name];
    }
  }
  return undefined;
}

export function getStatsDurableObjectStub(env) {
  const binding = getBinding(env);

  if (!binding) {
    throw new Error(
      'Missing Durable Object binding. Bind VOLLEYBALL_STATS_DO (preferred) to your Worker.'
    );
  }

  if (typeof binding.idFromName !== 'function' || typeof binding.get !== 'function') {
    throw new Error('Configured Durable Object binding does not provide idFromName()/get().');
  }

  const id = binding.idFromName('primary');
  return binding.get(id);
}

export async function callStatsDurableObject(env, path, init = {}) {
  const stub = getStatsDurableObjectStub(env);
  const urlPath = path.startsWith('/') ? path : `/${path}`;
  const requestInit = { ...init };
  const headers = new Headers(init.headers || {});

  if (init.body !== undefined && init.body !== null) {
    if (typeof init.body === 'string') {
      requestInit.body = init.body;
    } else {
      requestInit.body = JSON.stringify(init.body);
    }
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
  }

  if (headers.size > 0) {
    requestInit.headers = headers;
  }

  return stub.fetch(`https://volleyball-stats.internal${urlPath}`, requestInit);
}
