// Small-group deployment: one locked document preserves upstream's synchronous,
// single-process invariants across Vercel instances. No data is stored in /tmp.
// Keep a transaction open only while a bounded JSON request runs. This intentionally
// trades throughput for compatibility; it is not intended for a public gym service.
export const SCHEMA = `CREATE TABLE IF NOT EXISTS opengym_instance (
  id integer PRIMARY KEY CHECK (id = 1),
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
)`;

export function createPostgresStore(pool) {
  let initialized;
  function init() {
    return initialized ||= (async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SET LOCAL lock_timeout = '10s'");
        // Serialize first-time schema creation across simultaneous cold starts.
        await client.query('SELECT pg_advisory_xact_lock(731904281)');
        await client.query(SCHEMA);
        await client.query(`INSERT INTO opengym_instance (id, payload) VALUES (1, $1::jsonb)
          ON CONFLICT (id) DO NOTHING`, [JSON.stringify({ version: 1, documents: {}, runtime: {} })]);
        await client.query('COMMIT');
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch { /* preserve original failure */ }
        throw error;
      } finally { client.release(); }
    })().catch(error => { initialized = undefined; throw error; });
  }
  return {
    async transaction(run) {
      await init();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SET LOCAL lock_timeout = '10s'");
        await client.query("SET LOCAL statement_timeout = '15s'");
        const { rows } = await client.query('SELECT payload FROM opengym_instance WHERE id = 1 FOR UPDATE');
        const snapshot = rows[0]?.payload;
        if (snapshot?.version !== 1 || !snapshot.documents || !snapshot.runtime) {
          throw new Error('Unsupported or missing openGym database snapshot');
        }
        const result = await run(snapshot);
        await client.query('UPDATE opengym_instance SET payload = $1::jsonb, updated_at = now() WHERE id = 1', [JSON.stringify(snapshot)]);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch { /* preserve original failure */ }
        throw error;
      } finally {
        client.release();
      }
    }
  };
}
