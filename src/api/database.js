export function getDatabase(env) {
  const binding =
    env.VOLLEYBALL_STATS_DB ??
    env.DB ??
    env.db ??
    env.database ??
    env.Database ??
    env.volleyball_stats_db;

  if (!binding) {
    throw new Error('Missing D1 database binding. Bind VOLLEYBALL_STATS_DB (preferred) or DB to your Worker.');
  }

  if (typeof binding.prepare !== 'function') {
    throw new Error('Configured database binding does not expose a prepare() method.');
  }

  return binding;
}

export function getDO(env) {
  const binding =
    env.DURABLE_OBJECT_NAME ??
    env.durable_object_name;

  if (!binding) {
    throw new Error('Missing D0 database binding. Bind MATCH_DO (preferred) or DO to your Worker.');
  }

  if (typeof binding.prepare !== 'function') {
    throw new Error('Configured database binding does not expose a prepare() method.');
  }

  return binding;
}
