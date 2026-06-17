// ============================================================
//  Integración con GLPI (API REST): crear y consultar tickets.
//  Auth: App-Token (cliente API) + User-Token (cuenta de servicio).
// ============================================================

let conf = { url: '', appToken: '', userToken: '' };
let sessionToken = '';

// Estados de ticket de GLPI (códigos numéricos -> etiqueta en español)
const ESTADOS = {
  1: 'Nuevo',
  2: 'En curso (asignado)',
  3: 'En curso (planificado)',
  4: 'En espera',
  5: 'Resuelto',
  6: 'Cerrado',
};

function configurar(opciones) {
  conf = { ...conf, ...opciones };
  sessionToken = ''; // forzar nueva sesión con la nueva config
}

function disponible() {
  return !!(conf.url && conf.appToken && conf.userToken);
}

function base() {
  return conf.url.replace(/\/+$/, '') + '/apirest.php';
}

// Inicia sesión y guarda el session_token
async function initSession() {
  const r = await fetch(base() + '/initSession', {
    headers: {
      'Content-Type': 'application/json',
      'App-Token': conf.appToken,
      Authorization: 'user_token ' + conf.userToken,
    },
  });
  const d = await r.json().catch(() => null);
  if (!r.ok || !d || !d.session_token) {
    throw new Error('GLPI initSession falló: ' + (Array.isArray(d) ? d.join(' ') : `${r.status} ${JSON.stringify(d)}`));
  }
  sessionToken = d.session_token;
  return sessionToken;
}

// Llamada autenticada; si la sesión expiró (401), re-inicia y reintenta una vez
async function api(method, path, body) {
  if (!sessionToken) await initSession();
  const hacer = () => fetch(base() + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'App-Token': conf.appToken,
      'Session-Token': sessionToken,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let r = await hacer();
  if (r.status === 401) { await initSession(); r = await hacer(); }
  return r;
}

// Crea un ticket. { titulo, descripcion } -> devuelve { id, titulo }
async function crearTicket({ titulo, descripcion }) {
  const input = { name: titulo || 'Solicitud de soporte', content: descripcion || titulo || '' };
  const r = await api('POST', '/Ticket', { input });
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error('GLPI crearTicket: ' + (Array.isArray(d) ? d.join(' ') : JSON.stringify(d)));
  const id = Array.isArray(d) ? (d[0] && d[0].id) : (d && d.id);
  if (!id) throw new Error('GLPI crearTicket: respuesta sin id (' + JSON.stringify(d) + ')');
  return { id, titulo: input.name };
}

// Consulta un ticket por número -> { id, titulo, estado, estadoNum } o null si no existe
async function estadoTicket(numero) {
  const id = String(numero).replace(/[^0-9]/g, '');
  if (!id) return null;
  const r = await api('GET', '/Ticket/' + id);
  if (r.status === 404) return null;
  const d = await r.json().catch(() => null);
  if (!r.ok || !d || !d.id) {
    if (Array.isArray(d) && /not.?found|unknown|ERROR_ITEM/i.test(d.join(' '))) return null;
    throw new Error('GLPI estadoTicket: ' + (Array.isArray(d) ? d.join(' ') : JSON.stringify(d)));
  }
  return {
    id: d.id,
    titulo: d.name,
    estado: ESTADOS[d.status] || ('Código ' + d.status),
    estadoNum: d.status,
  };
}

// Prueba la conexión (devuelve el usuario de la sesión)
async function probar() {
  await initSession();
  const r = await api('GET', '/getFullSession');
  const d = await r.json().catch(() => null);
  const u = d && d.session && (d.session.glpifriendlyname || d.session.glpiname);
  return { ok: true, usuario: u || 'conectado' };
}

module.exports = { configurar, disponible, crearTicket, estadoTicket, probar, get conf() { return conf; } };
