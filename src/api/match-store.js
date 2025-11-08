const DEFAULT_MATCH_STORE_NAME = 'global-match-store';

export function getMatchStore(env, name = DEFAULT_MATCH_STORE_NAME) {
  const namespace = env?.MATCH_STORE;
  if (!namespace) {
    throw new Error('Missing Durable Object binding: MATCH_STORE.');
  }

  if (typeof namespace.idFromName !== 'function' || typeof namespace.get !== 'function') {
    throw new Error('MATCH_STORE binding does not expose the expected Durable Object namespace helpers.');
  }

  const id = namespace.idFromName(name);
  return namespace.get(id);
}
