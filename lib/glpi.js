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

// Normaliza un NIT/identificador para comparar (quita puntos, guiones y espacios)
function normNit(s) { return String(s || '').replace(/[.\s-]/g, '').toLowerCase(); }

// Busca una entidad cuyo NIT esté en su descripción/comentario (agnóstico al campo).
// Devuelve { id, nombre, comment } o null si no la encuentra.
async function buscarEntidadPorNit(nit) {
  const objetivo = normNit(nit);
  if (!objetivo) return null;
  const r = await api('GET', '/Entity?range=0-1000&expand_dropdowns=true');
  const lista = await r.json().catch(() => null);
  if (!Array.isArray(lista)) return null;
  // Busca el NIT en cualquier campo de texto de la entidad (comment, registration_number, etc.)
  const match = lista.find((e) =>
    Object.values(e).some((v) => typeof v === 'string' && normNit(v).includes(objetivo) && objetivo.length >= 5)
  );
  if (!match) return null;
  return { id: match.id, nombre: match.completename || match.name, comment: match.comment || '' };
}

// Lista las ubicaciones de una entidad -> [{ id, nombre }]
async function listarUbicaciones(entityId) {
  const r = await api('GET', '/Location?range=0-1000&expand_dropdowns=false');
  const lista = await r.json().catch(() => null);
  if (!Array.isArray(lista)) return [];
  return lista
    .filter((l) => String(l.entities_id) === String(entityId))
    .map((l) => ({ id: l.id, nombre: l.completename || l.name }));
}

// Sube un documento (base64) y lo enlaza a un ticket. Devuelve el id del documento.
async function adjuntarDocumento(ticketId, { base64, filename, mimetype }) {
  if (!sessionToken) await initSession();
  const nombre = filename || 'evidencia';
  const manifest = JSON.stringify({ input: { name: nombre, _filename: [nombre] } });
  const fd = new FormData();
  fd.append('uploadManifest', manifest);
  fd.append('filename[0]', new Blob([Buffer.from(base64, 'base64')], { type: mimetype || 'application/octet-stream' }), nombre);

  const hacer = () => fetch(base() + '/Document', {
    method: 'POST',
    headers: { 'App-Token': conf.appToken, 'Session-Token': sessionToken }, // sin Content-Type: lo pone FormData
    body: fd,
  });
  let r = await hacer();
  if (r.status === 401) { await initSession(); r = await hacer(); }
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error('GLPI subir documento: ' + (Array.isArray(d) ? d.join(' ') : JSON.stringify(d)));
  const docId = Array.isArray(d) ? (d[0] && d[0].id) : (d && d.id);
  if (!docId) throw new Error('GLPI subir documento: respuesta sin id (' + JSON.stringify(d) + ')');
  // Enlazar el documento al ticket
  await api('POST', '/Document_Item', { input: { documents_id: docId, itemtype: 'Ticket', items_id: ticketId } });
  return docId;
}

// Crea un ticket. { titulo, descripcion, entityId, locationId } -> { id, titulo }
async function crearTicket({ titulo, descripcion, entityId, locationId }) {
  const input = { name: titulo || 'Solicitud de soporte', content: descripcion || titulo || '' };
  if (entityId) input.entities_id = entityId;
  if (locationId) input.locations_id = locationId;
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

// Lista los tickets ABIERTOS (status 1-4) de UNA entidad. Aislamiento doble:
// restringe la sesión a esa entidad Y filtra por entities_id (nunca devuelve de otras).
async function listarTicketsAbiertos(entityId) {
  const eid = Number(entityId);
  try { await api('POST', '/changeActiveEntities', { entities_id: eid, is_recursive: false }); } catch { /* el filtro de abajo igual aísla */ }
  const r = await api('GET', '/Ticket?range=0-300&expand_dropdowns=false&order=DESC&sort=19');
  const lista = await r.json().catch(() => null);
  if (!Array.isArray(lista)) return [];
  return lista
    .filter((t) => String(t.entities_id) === String(eid) && [1, 2, 3, 4].includes(Number(t.status)))
    .map((t) => ({ id: t.id, titulo: t.name, estado: ESTADOS[t.status] || ('Código ' + t.status) }));
}

// Devuelve el último comentario (seguimiento) de un ticket -> { contenido, fecha } o null
async function ultimoComentario(ticketId) {
  for (const sub of ['ITILFollowup', 'TicketFollowup']) {
    const r = await api('GET', '/Ticket/' + ticketId + '/' + sub + '?range=0-100');
    if (!r.ok) continue;
    const arr = await r.json().catch(() => null);
    if (Array.isArray(arr) && arr.length) {
      const last = arr[arr.length - 1];
      const texto = String(last.content || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
      return { contenido: texto, fecha: last.date };
    }
  }
  return null;
}

// Prueba la conexión (devuelve el usuario de la sesión)
async function probar() {
  await initSession();
  const r = await api('GET', '/getFullSession');
  const d = await r.json().catch(() => null);
  const u = d && d.session && (d.session.glpifriendlyname || d.session.glpiname);
  return { ok: true, usuario: u || 'conectado' };
}

// Devuelve datos crudos de una entidad (para inspección/diagnóstico)
async function getEntidad(id) {
  const r = await api('GET', '/Entity/' + id + '?expand_dropdowns=true');
  return r.json().catch(() => null);
}

module.exports = {
  configurar, disponible, probar,
  buscarEntidadPorNit, listarUbicaciones, crearTicket, estadoTicket, adjuntarDocumento, getEntidad,
  listarTicketsAbiertos, ultimoComentario,
  get conf() { return conf; },
};
