// ============================================================
//  Almacen de conversaciones en un archivo JSON (sencillo).
//  Misma interfaz que PgStore para poder intercambiarlos.
// ============================================================

const fs = require('fs');
const path = require('path');

class JsonStore {
  constructor(file) {
    this.file = path.resolve(file);
    this.map = new Map();
    this.flow = new Map(); // estado del flujo por usuario (en memoria)
    this._timer = null;
  }

  async getFlowState(chatId) { return this.flow.get(chatId) || null; }
  async setFlowState(chatId, node) { this.flow.set(chatId, node); }

  async recentChats(limit = 20) {
    const out = [];
    for (const [chatId, h] of this.map) {
      const lastUser = [...h].reverse().find((m) => m.role === 'user');
      out.push({ chatId, lastMessage: (lastUser ? lastUser.content : '').slice(0, 40) });
    }
    return out.slice(-limit).reverse();
  }

  async init() {
    try {
      if (fs.existsSync(this.file)) {
        const obj = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        for (const [k, v] of Object.entries(obj)) this.map.set(k, v);
        console.log(`💾 Memoria en archivo JSON: ${this.map.size} conversacion(es)`);
      } else {
        console.log('💾 Memoria en archivo JSON (nuevo)');
      }
    } catch (e) {
      console.warn('⚠️  No se pudo cargar la memoria:', e.message);
    }
  }

  async getRecent(chatId, max) {
    const h = this.map.get(chatId) || [];
    return h.slice(-max);
  }

  async append(chatId, role, content) {
    const h = this.map.get(chatId) || [];
    h.push({ role, content });
    this.map.set(chatId, h);
    this._guardarPronto();
  }

  async clear(chatId) {
    if (chatId) this.map.delete(chatId);
    else this.map.clear();
    this._guardarPronto();
  }

  async metrics() {
    let total = 0;
    for (const h of this.map.values()) total += h.length;
    return { driver: 'json', conversations: this.map.size, totalMessages: total, today: null, last7: [] };
  }

  async close() {
    this._guardar();
  }

  _guardarPronto() {
    if (this._timer) return;
    this._timer = setTimeout(() => { this._timer = null; this._guardar(); }, 1000);
  }

  _guardar() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.map), null, 2));
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.warn('⚠️  No se pudo guardar la memoria:', e.message);
    }
  }
}

module.exports = JsonStore;
