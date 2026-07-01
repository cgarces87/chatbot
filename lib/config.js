// ============================================================
//  Lectura y escritura del archivo .env desde el panel.
//  Permite editar la parametrizacion sin tocar archivos a mano.
// ============================================================

const fs = require('fs');
const path = require('path');

const ENV_PATH = path.resolve(process.cwd(), '.env');

// Campos editables desde el panel.
//  live=true  -> el cambio se aplica al instante (sin reiniciar)
//  live=false -> requiere reiniciar el bot
//  secret=true -> se muestra enmascarado en el panel
const EDITABLE = {
  SYSTEM_PROMPT:    { live: true,  label: 'Personalidad (system prompt)', type: 'textarea', group: 'Comportamiento' },
  OPENAI_MODEL:     { live: true,  label: 'Modelo de OpenAI',             type: 'text',     group: 'Comportamiento' },
  MAX_HISTORY:      { live: true,  label: 'Mensajes recordados',          type: 'number',   group: 'Comportamiento' },
  ENABLE_IMAGES:    { live: true,  label: 'Reconocer imágenes',  type: 'select', options: ['true', 'false'], group: 'Comportamiento' },
  ENABLE_AUDIO:     { live: true,  label: 'Reconocer audios',    type: 'select', options: ['true', 'false'], group: 'Comportamiento' },
  REPLY_IN_GROUPS:  { live: true,  label: 'Responder en grupos', type: 'select', options: ['true', 'false'], group: 'Comportamiento' },
  ENABLE_FLOW:      { live: true,  label: 'Activar flujo de menús', type: 'select', options: ['true', 'false'], group: 'Comportamiento' },
  NATIVE_BUTTONS:   { live: true,  label: 'Intentar botones nativos', type: 'select', options: ['true', 'false'], group: 'Comportamiento' },
  ENABLE_AUTO_HANDOFF: { live: true, label: 'Pausa automática cuando respondes tú', type: 'select', options: ['true', 'false'], group: 'Comportamiento' },
  HANDOFF_MINUTES:  { live: true,  label: 'Minutos de pausa por atención humana', type: 'number', group: 'Comportamiento' },
  RESPONSE_DELAY_MIN: { live: true, label: 'Delay mínimo antes de responder (segundos)', type: 'number', group: 'Comportamiento' },
  RESPONSE_DELAY_MAX: { live: true, label: 'Delay máximo antes de responder (segundos)', type: 'number', group: 'Comportamiento' },
  SHOW_TYPING:      { live: true,  label: 'Mostrar "escribiendo…" mientras responde', type: 'select', options: ['true', 'false'], group: 'Comportamiento' },
  STRICT_MODE:      { live: true,  label: 'Modo estricto (solo responder con la info dada)', type: 'select', options: ['true', 'false'], group: 'Comportamiento' },

  OPENAI_API_KEY:   { live: false, label: 'OpenAI API Key',  type: 'text', secret: true, group: 'Conexiones' },
  OPENWA_API_URL:   { live: false, label: 'URL de openwa-api',            type: 'text',    group: 'Conexiones' },
  OPENWA_API_KEY:   { live: false, label: 'openwa API Key',  type: 'text', secret: true, group: 'Conexiones' },
  OPENWA_SESSION_ID:{ live: true,  label: 'Sesión de WhatsApp activa',     type: 'text',    group: 'Conexiones' },

  // --- Google Calendar ---
  ENABLE_CALENDAR:  { live: true,  label: 'Activar Google Calendar', type: 'select', options: ['true', 'false'], group: 'Calendario' },
  GOOGLE_CALENDAR_ID: { live: true, label: 'ID del calendario de Google', type: 'text', group: 'Calendario' },
  GOOGLE_CALENDAR_TIMEZONE: { live: true, label: 'Zona horaria (ej. America/Bogota)', type: 'text', group: 'Calendario' },
  GOOGLE_MEET_LINK: { live: true, label: 'Enlaces de Google Meet (varios separados por coma; se rotan)', type: 'text', group: 'Calendario' },

  // --- Correo (SMTP) ---
  ENABLE_SMTP:      { live: true,  label: 'Activar envío de correos', type: 'select', options: ['true', 'false'], group: 'Correo' },
  SMTP_HOST:        { live: true,  label: 'Servidor SMTP (host)', type: 'text', group: 'Correo' },
  SMTP_PORT:        { live: true,  label: 'Puerto SMTP (587 o 465)', type: 'number', group: 'Correo' },
  SMTP_SECURE:      { live: true,  label: 'SSL directo (true=465, false=587)', type: 'select', options: ['false', 'true'], group: 'Correo' },
  SMTP_USER:        { live: true,  label: 'Usuario / correo', type: 'text', group: 'Correo' },
  SMTP_PASSWORD:    { live: true,  label: 'Contraseña / clave de aplicación', type: 'text', secret: true, group: 'Correo' },
  SMTP_FROM:        { live: true,  label: 'Remitente (ej. Pronetsys <correo@dominio.com>)', type: 'text', group: 'Correo' },
  NOTIFY_EMAIL:     { live: true,  label: 'Tu correo para notificaciones/confirmaciones', type: 'text', group: 'Correo' },

  // --- Pagos (QR Bre-B) ---
  ENABLE_PAGOS:     { live: true,  label: 'Activar envío de QR de pago', type: 'select', options: ['true', 'false'], group: 'Pagos' },
  PAGO_QR_CAPTION:  { live: true,  label: 'Texto que acompaña el QR', type: 'text', group: 'Pagos' },
  PAGO_QR_URL:      { live: true,  label: 'URL externa del QR (opcional; si vacío usa el subido)', type: 'text', group: 'Pagos' },
  // NOTA: los enlaces de Wompi son por plan y viven en la base de conocimiento (guía), no aquí.

  // --- Soporte (GLPI) ---
  ENABLE_GLPI:      { live: true,  label: 'Activar tickets de soporte (GLPI)', type: 'select', options: ['true', 'false'], group: 'Soporte GLPI' },
  GLPI_URL:         { live: true,  label: 'URL de GLPI (ej. https://soporte.dominio.com/glpi)', type: 'text', group: 'Soporte GLPI' },
  GLPI_APP_TOKEN:   { live: true,  label: 'App-Token (token de aplicación)', type: 'text', secret: true, group: 'Soporte GLPI' },
  GLPI_USER_TOKEN:  { live: true,  label: 'User-Token (token de la cuenta del bot)', type: 'text', secret: true, group: 'Soporte GLPI' },

  // --- Servidor ---
  PORT:             { live: false, label: 'Puerto del servidor', type: 'number', group: 'Servidor' },

  // --- Exposicion a internet ---
  USE_TUNNEL:       { live: false, label: 'Exponer con tunel Cloudflare', type: 'select', options: ['true', 'false'], group: 'Exposicion a internet' },
  PUBLIC_URL:       { live: false, label: 'URL publica (si no usas tunel)', type: 'text',  group: 'Exposicion a internet' },

  // --- Almacenamiento de la memoria ---
  STORAGE_DRIVER:   { live: false, label: 'Motor de memoria', type: 'select', options: ['json', 'postgres'], group: 'Base de datos' },
  PG_HOST:          { live: false, label: 'Postgres: host',        type: 'text',   group: 'Base de datos' },
  PG_PORT:          { live: false, label: 'Postgres: puerto',      type: 'number', group: 'Base de datos' },
  PG_DATABASE:      { live: false, label: 'Postgres: base de datos', type: 'text', group: 'Base de datos' },
  PG_USER:          { live: false, label: 'Postgres: usuario',     type: 'text',   group: 'Base de datos' },
  PG_PASSWORD:      { live: false, label: 'Postgres: contraseña',  type: 'text', secret: true, group: 'Base de datos' },
  PG_POOL_MAX:      { live: false, label: 'Postgres: tamaño del pool', type: 'number', group: 'Base de datos' },
};

// Lee las variables como objeto { CLAVE: valor }.
// Si no hay archivo .env (ej. en Docker), usa las variables de entorno actuales.
function leerEnv() {
  const out = {};
  try {
    const txt = fs.readFileSync(ENV_PATH, 'utf8');
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m) out[m[1]] = m[2];
    }
  } catch {
    // Sin archivo .env: tomar los valores del entorno (para los campos editables)
    for (const k of Object.keys(EDITABLE)) {
      if (process.env[k] !== undefined) out[k] = process.env[k];
    }
  }
  return out;
}

// Actualiza las claves indicadas. Aplica SIEMPRE en process.env (efecto en vivo)
// y, si hay archivo .env, también lo persiste conservando comentarios y orden.
function actualizarEnv(updates) {
  // 1) Aplicar en memoria (para que tome efecto al instante aunque no haya archivo)
  for (const [k, v] of Object.entries(updates)) process.env[k] = String(v);

  // 2) Persistir en el archivo .env si existe / se puede escribir
  let lines;
  try { lines = fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/); }
  catch { lines = []; }
  const hechas = new Set();
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*([A-Z0-9_]+)\s*=/);
    if (m && Object.prototype.hasOwnProperty.call(updates, m[1])) {
      lines[i] = `${m[1]}=${updates[m[1]]}`;
      hechas.add(m[1]);
    }
  }
  for (const k of Object.keys(updates)) {
    if (!hechas.has(k)) lines.push(`${k}=${updates[k]}`);
  }
  try { fs.writeFileSync(ENV_PATH, lines.join('\n')); }
  catch { /* en Docker sin .env montado no persiste, pero ya aplicó en vivo */ }
}

// Enmascara un secreto: muestra solo los ultimos 4 caracteres
function enmascarar(valor) {
  if (!valor) return '';
  if (valor.length <= 6) return '••••';
  return '••••••••' + valor.slice(-4);
}

module.exports = { ENV_PATH, EDITABLE, leerEnv, actualizarEnv, enmascarar };
