const DEFAULT_MATCH_STORE_NAME = 'global-match-store';

export function getMatchStore(env, name = DEFAULT_MATCH_STORE_NAME) {
  const namespace = resolveMatchStoreNamespace(env);
  if (!namespace) {
    throw new Error(
      'Missing Durable Object binding: MATCH_STORE. Bind the MatchStore namespace or expose its name via MATCH_STORE_BINDING.'
    );
  }

  if (!isDurableObjectNamespace(namespace)) {
    throw new Error('MATCH_STORE binding does not expose the expected Durable Object namespace helpers.');
  }

  const id = namespace.idFromName(name);
  return namespace.get(id);
}

function resolveMatchStoreNamespace(env) {
  if (!env || typeof env !== 'object') {
    return undefined;
  }

  if (env.MATCH_STORE) {
    return env.MATCH_STORE;
  }

  const bindingName = typeof env.MATCH_STORE_BINDING === 'string' ? env.MATCH_STORE_BINDING : undefined;
  if (bindingName && env[bindingName]) {
    return env[bindingName];
  }

  const candidates = Object.values(env).filter(isDurableObjectNamespace);
  if (candidates.length === 1) {
    return candidates[0];
  }

  return undefined;
}

function isDurableObjectNamespace(value) {
  return (
    value &&
    typeof value === 'object' &&
    typeof value.idFromName === 'function' &&
    typeof value.idFromString === 'function' &&
    typeof value.get === 'function'
  );
}
