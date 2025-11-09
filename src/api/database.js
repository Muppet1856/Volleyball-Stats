export function getDatabase(env) {
  const binding =
    env.STATS_DB_DO ??
    env.VOLLEYBALL_STATS_DB ??
    env.DB ??
    env.db ??
    env.database ??
    env.Database ??
    env.volleyball_stats_db;

  if (!binding) {
    throw new Error(
      'Missing database binding. Bind the StatsDatabase durable object (preferred) or provide a D1-compatible binding such as VOLLEYBALL_STATS_DB.'
    );
  }

  if (typeof binding.prepare !== 'function') {
    throw new Error('Configured database binding does not expose a prepare() method.');
  }

  return binding;
}
