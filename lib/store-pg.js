// ============================================================
//  Almacen de conversaciones en PostgreSQL (con POOL de conexiones).
//  Guarda un registro por mensaje -> permite memoria Y metricas.
// ============================================================

const { Pool } = require('pg');

class PgStore {
  constructor(cfg) {
    this.cfg = cfg; // { host, port, database, user, password, poolMax }
    this.pool = null;
  }

  // Crea la base de datos si no existe y la tabla de mensajes
  async init() {
    this._validarNombre(this.cfg.database);
    await this._asegurarBaseDeDatos();

    this.pool = new Pool({
      host: this.cfg.host,
      port: this.cfg.port,
      database: this.cfg.database,
      user: this.cfg.user,
      password: this.cfg.password,
      max: this.cfg.poolMax || 10,      // <-- POOL de conexiones
      idleTimeoutMillis: 30000,
    });

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id         BIGSERIAL PRIMARY KEY,
        chat_id    TEXT NOT NULL,
        role       TEXT NOT NULL,
        content    TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await this.pool.query(`CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, id);`);
    await this.pool.query(`CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);`);

    // Estado del flujo conversacional por usuario (en que nodo del menu esta)
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS flow_state (
        chat_id    TEXT PRIMARY KEY,
        node       TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    console.log(`🐘 Memoria en PostgreSQL: ${this.cfg.database}@${this.cfg.host}:${this.cfg.port} (pool max ${this.cfg.poolMax || 10})`);
  }

  _validarNombre(name) {
    if (!/^[A-Za-z0-9_]+$/.test(name)) {
      throw new Error('Nombre de base de datos invalido (usa letras, numeros y _)');
    }
  }

  // Conecta a la BD "postgres" del sistema para crear la nuestra si falta
  async _asegurarBaseDeDatos() {
    const admin = new Pool({
      host: this.cfg.host, port: this.cfg.port, database: 'postgres',
      user: this.cfg.user, password: this.cfg.password, max: 1,
    });
    try {
      const r = await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [this.cfg.database]);
      if (r.rowCount === 0) {
        await admin.query(`CREATE DATABASE "${this.cfg.database}"`);
        console.log('🐘 Base de datos creada:', this.cfg.database);
      }
    } finally {
      await admin.end();
    }
  }

  // Devuelve los ultimos N mensajes de un chat (orden cronologico)
  async getRecent(chatId, max) {
    const r = await this.pool.query(
      'SELECT role, content FROM messages WHERE chat_id=$1 ORDER BY id DESC LIMIT $2',
      [chatId, max]
    );
    return r.rows.reverse();
  }

  // Agrega un mensaje al historial
  async append(chatId, role, content) {
    await this.pool.query(
      'INSERT INTO messages(chat_id, role, content) VALUES($1,$2,$3)',
      [chatId, role, content]
    );
  }

  // Borra el historial (de un chat, o todo)
  async clear(chatId) {
    if (chatId) await this.pool.query('DELETE FROM messages WHERE chat_id=$1', [chatId]);
    else await this.pool.query('TRUNCATE messages');
  }

  // Metricas para el panel
  async metrics() {
    const one = async (sql, p = []) => (await this.pool.query(sql, p)).rows[0];
    const conv = await one('SELECT COUNT(DISTINCT chat_id)::int AS n FROM messages');
    const total = await one('SELECT COUNT(*)::int AS n FROM messages');
    const today = await one("SELECT COUNT(*)::int AS n FROM messages WHERE created_at::date = now()::date");
    const last7 = (await this.pool.query(
      `SELECT to_char(created_at::date,'YYYY-MM-DD') AS dia, COUNT(*)::int AS n
       FROM messages WHERE created_at > now() - interval '7 days'
       GROUP BY 1 ORDER BY 1`
    )).rows;
    return {
      driver: 'postgres',
      conversations: conv.n,
      totalMessages: total.n,
      today: today.n,
      last7,
    };
  }

  // --- Estado del flujo conversacional ---
  async getFlowState(chatId) {
    const r = await this.pool.query('SELECT node FROM flow_state WHERE chat_id=$1', [chatId]);
    return r.rows[0] ? r.rows[0].node : null;
  }
  async setFlowState(chatId, node) {
    await this.pool.query(
      `INSERT INTO flow_state(chat_id, node, updated_at) VALUES($1,$2,now())
       ON CONFLICT (chat_id) DO UPDATE SET node=$2, updated_at=now()`,
      [chatId, node]
    );
  }

  // Conversaciones recientes (para elegir a quién ignorar desde el panel)
  async recentChats(limit = 20) {
    const r = await this.pool.query(
      `SELECT chat_id, MAX(created_at) AS last_at,
        (SELECT content FROM messages m2 WHERE m2.chat_id = m1.chat_id AND m2.role = 'user' ORDER BY id DESC LIMIT 1) AS last_user
       FROM messages m1 GROUP BY chat_id ORDER BY last_at DESC LIMIT $1`,
      [limit]
    );
    return r.rows.map((x) => ({ chatId: x.chat_id, lastMessage: (x.last_user || '').slice(0, 40) }));
  }

  async close() {
    if (this.pool) await this.pool.end();
  }
}

module.exports = PgStore;
