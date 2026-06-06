// ============================================================
//  Selector de almacenamiento: decide JSON o PostgreSQL
//  segun la variable STORAGE_DRIVER.
// ============================================================

const JsonStore = require('./store-json');
const PgStore = require('./store-pg');

// Lee la config de Postgres desde un objeto de entorno
function pgConfig(env) {
  return {
    host: env.PG_HOST || 'localhost',
    port: parseInt(env.PG_PORT || '5432', 10),
    database: env.PG_DATABASE || 'chatbot',
    user: env.PG_USER || 'postgres',
    password: env.PG_PASSWORD || '',
    poolMax: parseInt(env.PG_POOL_MAX || '10', 10),
  };
}

// Crea el almacen segun STORAGE_DRIVER
function createStore(env) {
  const driver = (env.STORAGE_DRIVER || 'json').toLowerCase();
  if (driver === 'postgres') return new PgStore(pgConfig(env));
  return new JsonStore(env.CONV_STORE_FILE || 'data/conversations.json');
}

// Prueba una conexion a Postgres con los datos dados (para el boton "Probar")
async function probarPostgres(env) {
  const { Pool } = require('pg');
  const c = pgConfig(env);
  const pool = new Pool({ host: c.host, port: c.port, database: c.database, user: c.user, password: c.password, max: 1, connectionTimeoutMillis: 5000 });
  try {
    const r = await pool.query('SELECT version()');
    return { ok: true, info: r.rows[0].version.split(',')[0] };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    try { await pool.end(); } catch {}
  }
}

module.exports = { createStore, pgConfig, probarPostgres };
