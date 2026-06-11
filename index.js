// ============================================================
//  CHATBOT DE WHATSAPP + OPENAI  (openwa-api + webhooks)
//  Memoria conmutable (JSON / PostgreSQL) + panel de administracion.
//
//  npm start ->  servidor + tunel + registro de webhook + panel
// ============================================================

require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const express = require('express');
const multer = require('multer');
const { PDFParse } = require('pdf-parse');
const OpenAI = require('openai');
const { toFile } = require('openai');

// Recibe archivos en memoria (para la base de conocimiento)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const { createStore, probarPostgres } = require('./lib/store');
const cfg = require('./lib/config');
const flow = require('./lib/flow');
const calendar = require('./lib/calendar');
const mailer = require('./lib/mailer');

// ---------------- Configuracion fija (.env) ----------------
const {
  OPENAI_API_KEY,
  OPENWA_API_URL,
  OPENWA_API_KEY,
  OPENWA_SESSION_ID,
  OPENWA_WEBHOOK_SECRET = '',
  PORT = '3000',
  ADMIN_USER = 'admin',
  ADMIN_PASSWORD = '',
} = process.env;

const USE_TUNNEL = (process.env.USE_TUNNEL ?? 'true') === 'true';
const PUBLIC_URL_ENV = process.env.PUBLIC_URL || '';

// Configuracion EDITABLE en caliente desde el panel
const runtime = {
  systemPrompt: process.env.SYSTEM_PROMPT || 'Eres un asistente amable que responde por WhatsApp.',
  model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  maxHistory: parseInt(process.env.MAX_HISTORY || '10', 10) || 10,
  enableImages: (process.env.ENABLE_IMAGES ?? 'true') === 'true',
  enableAudio: (process.env.ENABLE_AUDIO ?? 'true') === 'true',
  replyInGroups: (process.env.REPLY_IN_GROUPS ?? 'false') === 'true',
  enableFlow: (process.env.ENABLE_FLOW ?? 'false') === 'true',
  nativeButtons: (process.env.NATIVE_BUTTONS ?? 'false') === 'true',
  paused: (process.env.BOT_PAUSED ?? 'false') === 'true',
  enableAutoHandoff: (process.env.ENABLE_AUTO_HANDOFF ?? 'true') === 'true',
  handoffMinutes: parseInt(process.env.HANDOFF_MINUTES || '30', 10) || 30,
  delayMin: parseFloat(process.env.RESPONSE_DELAY_MIN || '1') || 0,
  delayMax: parseFloat(process.env.RESPONSE_DELAY_MAX || '4') || 0,
  showTyping: (process.env.SHOW_TYPING ?? 'true') === 'true',
  sessionId: OPENWA_SESSION_ID, // sesión de WhatsApp activa (cambiable desde el panel)
  ignored: (process.env.IGNORED_CHATS || '').split(',').map((s) => s.trim()).filter(Boolean),
  knowledge: '', // base de conocimiento (precios, datos, FAQs) — se carga al arrancar
  strict: (process.env.STRICT_MODE ?? 'true') === 'true', // solo responder con la info dada
  enableCalendar: (process.env.ENABLE_CALENDAR ?? 'false') === 'true',
  enableSmtp: (process.env.ENABLE_SMTP ?? 'false') === 'true',
  enablePagos: (process.env.ENABLE_PAGOS ?? 'false') === 'true',
};

// Configura el módulo de Google Calendar con los valores del entorno
function configurarCalendario() {
  calendar.configurar({
    calendarId: process.env.GOOGLE_CALENDAR_ID || '',
    timezone: process.env.GOOGLE_CALENDAR_TIMEZONE || 'America/Bogota',
    credsFile: process.env.GOOGLE_CREDENTIALS_FILE || 'data/google-credentials.json',
    meetLink: process.env.GOOGLE_MEET_LINK || '',
  });
}
configurarCalendario();

// Configura el envío de correo (SMTP) con los valores del entorno
function configurarCorreo() {
  mailer.configurar({
    host: process.env.SMTP_HOST || '',
    port: process.env.SMTP_PORT || 587,
    secure: (process.env.SMTP_SECURE ?? 'false') === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASSWORD || '',
    from: process.env.SMTP_FROM || '',
  });
}
configurarCorreo();

// Plantilla HTML de confirmación de cita (se carga una vez)
let _plantillaCita;
function plantillaCita() {
  if (_plantillaCita === undefined) {
    try { _plantillaCita = fs.readFileSync(path.join(__dirname, 'templates', 'cita.html'), 'utf8'); }
    catch { _plantillaCita = ''; }
  }
  return _plantillaCita;
}

// Calcula los datos formateados de una cita (fecha/hora en español, Colombia)
function datosCita(evento, datos = {}) {
  if (typeof datos === 'string') datos = { emailCliente: datos };
  const tz = calendar.conf.timezone || 'America/Bogota';
  const dIni = evento.inicio && evento.inicio.dateTime ? new Date(evento.inicio.dateTime) : null;
  const dFin = evento.fin && evento.fin.dateTime ? new Date(evento.fin.dateTime) : null;
  const fFecha = dIni
    ? dIni.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: tz })
    : ((evento.inicio && evento.inicio.date) || '');
  const fHoraIni = dIni ? dIni.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz }) : '';
  const fHoraFin = dFin ? dFin.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz }) : '';
  let dur = '';
  if (dIni && dFin) {
    const min = Math.round((dFin - dIni) / 60000);
    const h = Math.floor(min / 60), mm = min % 60;
    dur = [h ? h + (h === 1 ? ' hora' : ' horas') : '', mm ? mm + ' min' : ''].filter(Boolean).join(' ') || (min + ' min');
  }
  return {
    nombreCliente: datos.nombreCliente || '',
    empresa: datos.empresa || '',
    emailCliente: datos.emailCliente || '',
    titulo: evento.titulo || 'Cita',
    fFecha, fHoraIni, fHoraFin, dur,
    meet: evento.meet || evento.link || '',
  };
}

// Mensaje de confirmación de cita para WhatsApp (mismo formato, en texto)
function mensajeCitaWhatsApp(evento, datos = {}) {
  const d = datosCita(evento, datos);
  const L = ['✅ *¡Cita confirmada!*', '', '📅 *Detalles de la cita*'];
  if (d.empresa) L.push(`🏢 Empresa: ${d.empresa}`);
  if (d.nombreCliente) L.push(`👤 Contacto: ${d.nombreCliente}`);
  if (d.fFecha) L.push(`🗓️ Fecha: ${d.fFecha}`);
  if (d.fHoraIni) L.push(`🕐 Hora: ${d.fHoraIni}${d.fHoraFin ? ' – ' + d.fHoraFin : ''} (hora Colombia)`);
  if (d.dur) L.push(`⏱️ Duración: ${d.dur}`);
  if (d.meet) L.push('💻 Modalidad: Virtual por Google Meet', '', '💻 *Enlace de la reunión*', d.meet);
  L.push('', 'Si necesitas reagendar o tienes alguna duda, respóndenos por aquí. ¡Te esperamos! 🙌');
  return L.join('\n');
}

// Envía la confirmación de una cita por correo (al cliente y/o a ti)
//  datos: { emailCliente, nombreCliente, empresa }  (también acepta solo el email como string)
async function confirmarCita(evento, datos = {}) {
  if (!runtime.enableSmtp || !mailer.disponible()) return;
  if (typeof datos === 'string') datos = { emailCliente: datos };
  const destinatarios = [];
  if (datos.emailCliente) destinatarios.push(datos.emailCliente);
  if (process.env.NOTIFY_EMAIL) destinatarios.push(process.env.NOTIFY_EMAIL);
  if (!destinatarios.length) return;

  const { fFecha, fHoraIni, fHoraFin, dur, meet } = datosCita(evento, datos);

  // Usa la plantilla bonita si existe; si no, un correo simple de respaldo
  const tpl = plantillaCita();
  let html;
  if (tpl) {
    const repl = {
      '[NOMBRE_CLIENTE]': datos.nombreCliente || 'cliente',
      '[NOMBRE_EMPRESA]': datos.empresa || '—',
      '[FECHA_DEMO]': fFecha,
      '[HORA_INICIO]': fHoraIni,
      '[HORA_FIN]': fHoraFin,
      '[DURACION]': dur,
      '[ENLACE_MEET]': meet,
    };
    html = tpl;
    for (const [k, v] of Object.entries(repl)) html = html.split(k).join(v || '');
  } else {
    const cuando = (evento.inicio && (evento.inicio.dateTime || evento.inicio.date)) || '';
    html = `<p>Hola,</p><p>Tu cita ha quedado <b>agendada</b>:</p><ul>
      <li><b>${evento.titulo || 'Cita'}</b></li><li>Fecha/hora: ${cuando}</li>
      ${meet ? `<li>Google Meet: <a href="${meet}">${meet}</a></li>` : ''}</ul>
      ${evento.link ? `<p><a href="${evento.link}">Ver en el calendario</a></p>` : ''}<p>¡Te esperamos!</p>`;
  }

  try {
    await mailer.enviar({ to: destinatarios.join(','), subject: `Confirmación de su cita: ${evento.titulo || 'Cita'}`, html });
    console.log('✉️  Confirmación de cita enviada a', destinatarios.join(', '));
  } catch (e) { console.error('✉️  Error enviando confirmación:', e.message); }
}

// --- Base de conocimiento (info que el bot usa para responder) ---
const KNOWLEDGE_FILE = process.env.KNOWLEDGE_FILE || 'data/knowledge.md';
function cargarConocimiento() {
  try { return fs.existsSync(KNOWLEDGE_FILE) ? fs.readFileSync(KNOWLEDGE_FILE, 'utf8') : ''; }
  catch { return ''; }
}
function guardarConocimiento(txt) {
  fs.mkdirSync(path.dirname(KNOWLEDGE_FILE), { recursive: true });
  fs.writeFileSync(KNOWLEDGE_FILE, txt);
  runtime.knowledge = txt;
}
function bloqueConocimiento() {
  return runtime.knowledge && runtime.knowledge.trim()
    ? '\n\n=== INFORMACIÓN DE REFERENCIA (úsala para responder: precios, productos, datos. Si te preguntan algo que está aquí, responde con esta info) ===\n' + runtime.knowledge.trim()
    : '';
}

// Reglas estrictas: el bot solo responde con la info dada y no inventa
const REGLAS_ESTRICTAS =
  '\n\n=== REGLAS ESTRICTAS (OBLIGATORIAS) ===\n' +
  '1. Responde ÚNICAMENTE con la INFORMACIÓN DE REFERENCIA de arriba y el contexto de esta conversación.\n' +
  '2. Si te preguntan algo que NO está en esa información, NO lo inventes ni adivines. Di amablemente que no tienes ese dato y, si aplica, ofrece poner en contacto con un asesor humano.\n' +
  '3. No respondas sobre temas ajenos a este negocio (ni opinión general, ni cosas no relacionadas).\n' +
  '4. Sé coherente, breve y concreto. Si no entiendes la pregunta, pide que la aclaren.';

// Arma el system prompt completo (personalidad + conocimiento + reglas + extra)
function systemBase(extra) {
  let s = runtime.systemPrompt + bloqueConocimiento();
  if (runtime.strict) s += REGLAS_ESTRICTAS;
  if (extra) s += '\n\n' + extra;
  return s;
}

// ¿El chat está en la lista de ignorados? (acepta número, número sin indicativo, o chatId completo)
function estaIgnorado(chatId) {
  if (!chatId) return false;
  const numero = chatId.split('@')[0];
  return runtime.ignored.some((e) => e && (chatId === e || numero === e || numero.endsWith(e) || chatId.includes(e)));
}

// Verificaciones basicas
if (!OPENAI_API_KEY || OPENAI_API_KEY.startsWith('pega_aqui')) {
  console.error('❌ Falta OPENAI_API_KEY en .env'); process.exit(1);
}
if (!OPENWA_API_URL || !OPENWA_API_KEY || !OPENWA_SESSION_ID) {
  console.error('❌ Faltan datos de openwa-api (URL, KEY o SESSION_ID) en .env'); process.exit(1);
}
if (!ADMIN_PASSWORD) {
  console.warn('⚠️  ADMIN_PASSWORD vacio: el panel quedara accesible sin contraseña. ¡Ponle una!');
}

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const port = parseInt(PORT, 10) || 3000;
const store = createStore(process.env);

// Estado en vivo (para el panel)
const state = { startedAt: Date.now(), publicUrl: '', webhookActive: false, messagesHandled: 0 };

// Textos enviados por el BOT (para distinguirlos de tus mensajes manuales)
const botSent = new Map(); // texto -> expira (timestamp)
// Conversaciones en ATENCIÓN HUMANA: chatId -> pausada hasta (timestamp)
const handoff = new Map();
// Nombre del contacto por chatId (para mostrar en el panel quién es cada @lid)
const contactos = new Map();

function marcarEnvioBot(text) {
  if (text) botSent.set(text.trim(), Date.now() + 90000);
}
function esEnvioDelBot(text) {
  const t = (text || '').trim();
  const exp = botSent.get(t);
  if (exp) { botSent.delete(t); if (exp > Date.now()) return true; }
  return false;
}
function handoffActivo(chatId) {
  const until = handoff.get(chatId);
  if (!until) return false;
  if (until > Date.now()) return true;
  handoff.delete(chatId);
  return false;
}
function activarHandoff(chatId) {
  handoff.set(chatId, Date.now() + runtime.handoffMinutes * 60000);
}
function contarHandoff() {
  let n = 0;
  for (const [, until] of handoff) if (until > Date.now()) n++;
  return n;
}


// Helpers de openwa-api
function waUrl(p) { return `${OPENWA_API_URL}/api/sessions/${runtime.sessionId}${p}`; }
const waHeaders = { 'X-API-Key': OPENWA_API_KEY, 'Content-Type': 'application/json' };

// Lista los modelos de CHAT disponibles en la cuenta de OpenAI (para el desplegable)
async function getModelos() {
  try {
    const r = await openai.models.list();
    const ids = (r.data || []).map((m) => m.id);
    const excluir = /embedding|whisper|tts|audio|realtime|transcribe|moderation|dall-e|image|search|instruct|babbage|davinci|ada|computer-use|codex/i;
    const conFecha = /-\d{4}-\d{2}-\d{2}$/; // ej. gpt-4o-2024-08-06 (foto con fecha)
    const chat = ids.filter((id) => /^(gpt-|o1|o3|o4|chatgpt)/i.test(id) && !excluir.test(id) && !conFecha.test(id));
    return [...new Set(chat)].sort();
  } catch { return []; }
}

// Lista las sesiones conectadas en openwa-api (para el desplegable del panel)
async function getSessions() {
  try {
    const r = await fetch(`${OPENWA_API_URL}/api/sessions`, { headers: { 'X-API-Key': OPENWA_API_KEY } });
    if (!r.ok) return [];
    const d = await r.json();
    return Array.isArray(d) ? d : (d.data || []);
  } catch { return []; }
}

// ------------------------------------------------------------
//  OpenAI con contexto persistente por conversacion
// ------------------------------------------------------------
// Herramienta de calendario que el modelo puede invocar
const HERRAMIENTA_CAL = {
  type: 'function',
  function: {
    name: 'agendar_evento',
    description: 'Crea una cita o recordatorio en el calendario de Google del negocio cuando el cliente lo solicita.',
    parameters: {
      type: 'object',
      properties: {
        titulo: { type: 'string', description: 'Título breve del evento, ej. "Cita con Juan Pérez"' },
        inicio: { type: 'string', description: 'Fecha y hora de inicio en ISO 8601, ej. "2026-06-10T15:00:00". Calcúlala a partir de la fecha actual indicada en el sistema.' },
        fin: { type: 'string', description: 'Fecha y hora de fin en ISO 8601 (opcional; si falta dura 1 hora).' },
        todoElDia: { type: 'boolean', description: 'true si es un recordatorio de día completo, sin hora.' },
        descripcion: { type: 'string', description: 'Detalles opcionales del evento.' },
        emailCliente: { type: 'string', description: 'Correo del cliente para enviarle la confirmación (si lo proporciona).' },
        nombreCliente: { type: 'string', description: 'Nombre del cliente/contacto (si lo proporciona).' },
        empresa: { type: 'string', description: 'Nombre de la empresa del cliente (si lo proporciona).' },
        conMeet: { type: 'boolean', description: 'true si la cita es una reunión virtual/videollamada y debe generar un enlace de Google Meet.' },
      },
      required: ['titulo', 'inicio'],
    },
  },
};

// Herramienta para cancelar una cita ya agendada
const HERRAMIENTA_CANCELAR = {
  type: 'function',
  function: {
    name: 'cancelar_cita',
    description: 'Cancela (elimina) una cita o demo ya agendada en el calendario. Requiere al menos la fecha (y hora si se sabe) de la cita, o el nombre o correo del cliente.',
    parameters: {
      type: 'object',
      properties: {
        inicio: { type: 'string', description: 'Fecha (y hora si la sabe) de la cita a cancelar, en ISO 8601, ej. "2026-06-10T15:00:00".' },
        nombreCliente: { type: 'string', description: 'Nombre del cliente cuya cita se cancela (opcional).' },
        emailCliente: { type: 'string', description: 'Correo del cliente cuya cita se cancela (opcional).' },
      },
      required: [],
    },
  },
};

// Herramienta de correo que el modelo puede invocar
const HERRAMIENTA_CORREO = {
  type: 'function',
  function: {
    name: 'enviar_correo',
    description: 'Envía un correo electrónico desde la cuenta del negocio cuando el cliente lo solicita (ej. enviarle una cotización, información o un resumen a su email).',
    parameters: {
      type: 'object',
      properties: {
        para: { type: 'string', description: 'Correo del destinatario.' },
        asunto: { type: 'string', description: 'Asunto del correo.' },
        mensaje: { type: 'string', description: 'Cuerpo del correo (texto claro y bien redactado).' },
      },
      required: ['para', 'asunto', 'mensaje'],
    },
  },
};

// Herramienta para enviar el QR de pago (Bre-B) como imagen
const HERRAMIENTA_QR = {
  type: 'function',
  function: {
    name: 'enviar_qr_pago',
    description: 'Envía al cliente la imagen del código QR de pago (Bre-B) cuando pide el QR, quiere pagar por QR o por Bre-B desde su banco.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
};

// Ruta del archivo del QR de pago (busca el que exista: png/jpg) y si está disponible
function pagoQrFile() {
  if (process.env.PAGO_QR_FILE) return path.resolve(process.env.PAGO_QR_FILE);
  for (const ext of ['.png', '.jpg', '.jpeg']) {
    const p = path.resolve('data/qr-pago' + ext);
    if (fs.existsSync(p)) return p;
  }
  return path.resolve('data/qr-pago.png'); // por defecto (puede no existir aún)
}
function qrDisponible() { try { return fs.existsSync(pagoQrFile()); } catch { return false; } }

// Devuelve las herramientas activas según lo configurado
function herramientasActivas() {
  const t = [];
  if (runtime.enableCalendar && calendar.disponible()) t.push(HERRAMIENTA_CAL, HERRAMIENTA_CANCELAR);
  if (runtime.enableSmtp && mailer.disponible()) t.push(HERRAMIENTA_CORREO);
  if (runtime.enablePagos && qrDisponible()) t.push(HERRAMIENTA_QR);
  return t;
}

// Ejecuta una herramienta pedida por el modelo y devuelve el resultado (texto).
// ctx.respuestaDirecta: si se define, ese texto se envía al cliente TAL CUAL (sin que el modelo lo reescriba).
async function ejecutarHerramienta(nombre, args, chatId, ctx = {}) {
  if (nombre === 'agendar_evento') {
    const ev = await calendar.crearEvento(args);
    console.log(`📅 (chat) ${chatId} agendó: ${ev.titulo}`, ev.meet ? '(con Meet)' : '');
    await confirmarCita(ev, { emailCliente: args.emailCliente, nombreCliente: args.nombreCliente, empresa: args.empresa });
    // La confirmación al cliente va con formato fijo (plantilla), no la deja parafrasear el modelo
    ctx.respuestaDirecta = mensajeCitaWhatsApp(ev, args);
    return 'Cita agendada y confirmación enviada al cliente.';
  }
  if (nombre === 'cancelar_cita') {
    const borrados = await calendar.cancelarCita(args);
    console.log(`🗑️  (chat) ${chatId} canceló ${borrados.length} cita(s)`);
    if (!borrados.length) return 'No encontré ninguna cita con esos datos. Pídele al cliente la fecha/hora exacta o su correo para ubicarla.';
    return 'Citas canceladas: ' + borrados.map((b) => `"${b.titulo}"`).join(', ') + '. Confirma al cliente la cancelación.';
  }
  if (nombre === 'enviar_qr_pago') {
    const caption = process.env.PAGO_QR_CAPTION || 'Escanea este código QR desde la app de tu banco para pagar con Bre-B. Llave: @pronetsys';
    // Preferimos enviar por URL (body diminuto) porque el proxy de openwa rechaza POST grandes (base64).
    const esJpg = /\.jpe?g$/i.test(pagoQrFile());
    const ext = esJpg ? 'jpg' : 'png';
    const mime = esJpg ? 'image/jpeg' : 'image/png';
    const filename = `pago-pronetsys.${ext}`;
    const urlExterna = (process.env.PAGO_QR_URL || '').trim();
    let opts;
    if (urlExterna) opts = { url: urlExterna, mimetype: mime, filename, caption };
    else if (state.publicUrl) opts = { url: `${state.publicUrl}/pago/qr.${ext}`, mimetype: mime, filename, caption };
    else { // último recurso: base64 (puede fallar si la imagen pesa mucho)
      const base64 = fs.readFileSync(pagoQrFile()).toString('base64');
      opts = { base64, mimetype: mime, filename, caption };
    }
    await sendWhatsAppImage(chatId, opts);
    console.log(`💳 (chat) ${chatId} recibió el QR de pago`);
    return 'El QR de pago ya se le envió al cliente como imagen (con la llave Bre-B). Solo confirma brevemente; NO repitas el contenido del QR.';
  }
  if (nombre === 'enviar_correo') {
    await mailer.enviar({ to: args.para, subject: args.asunto, text: args.mensaje });
    console.log(`✉️  (chat) ${chatId} envió correo a ${args.para}`);
    return `Correo enviado a ${args.para}.`;
  }
  return 'Herramienta desconocida.';
}

async function askOpenAI(chatId, userMessage, extraSystem = '') {
  const prev = await store.getRecent(chatId, runtime.maxHistory * 2);
  let sys = systemBase(extraSystem);

  const tools = herramientasActivas();
  if (runtime.enableCalendar && calendar.disponible()) {
    const ahora = new Date().toLocaleString('es-CO', { timeZone: calendar.conf.timezone });
    sys += `\n\n=== AGENDAMIENTO DE CITAS (REGLA OBLIGATORIA, PRIORIDAD MÁXIMA) ===
Fecha y hora actual: ${ahora} (zona ${calendar.conf.timezone}).
Tienes una herramienta (función) llamada "agendar_evento". Es la ÚNICA forma real de crear una cita: si NO la llamas, NO ocurre nada (no se crea el evento, no se envía el correo, el cliente NO recibe nada).
- Cuando el cliente confirme el motivo/interfaz y un horario, tu siguiente acción DEBE ser llamar la herramienta "agendar_evento" con: titulo, inicio, fin (45 minutos después del inicio), conMeet=true, emailCliente, nombreCliente y empresa.
- ESTÁ TERMINANTEMENTE PROHIBIDO decir que una cita "quedó agendada", "fue cancelada" o que "se envió un correo de confirmación" si NO has llamado la herramienta en este mismo turno. Afirmarlo sin llamarla es ENGAÑAR al cliente.
- NO escribas mensajes de relleno tipo "un momento por favor". NO redactes tú la confirmación ni repitas los datos. Después de llamar la herramienta, el sistema envía automáticamente el correo (con la plantilla oficial) y el mensaje de WhatsApp con el formato correcto; tú no escribes nada más.
CANCELAR CITAS: para cancelar una cita usa la herramienta "cancelar_cita". Antes, pídele al cliente la fecha (y hora) de la cita o su correo para ubicarla. PROHIBIDO afirmar que una cita "fue cancelada" sin haber llamado "cancelar_cita" en este turno.`;
  }
  if (runtime.enableSmtp && mailer.disponible()) {
    sys += `\n\nTienes una herramienta "enviar_correo" SOLO para cuando el cliente pida enviar a su correo información DISTINTA a una cita (ej. un catálogo, una cotización o datos sueltos).
PROHIBIDO usar "enviar_correo" para confirmaciones, copias, reenvíos o notificaciones de citas/demos: esos correos los envía el sistema AUTOMÁTICAMENTE con la plantilla oficial (al cliente y al equipo) en el momento en que llamas "agendar_evento". NUNCA redactes ni reenvíes tú una confirmación de cita por correo.`;
  }
  if (runtime.enablePagos) {
    let pagos = '\n\nPAGOS:';
    if (qrDisponible()) {
      pagos += ` Cuando el cliente quiera pagar por QR, pida "el QR", o quiera pagar con Bre-B desde su banco, llama la herramienta "enviar_qr_pago" para enviarle la imagen del código QR. No describas el QR con texto; envíalo con la herramienta.`;
    }
    const wompi = (process.env.PAGO_WOMPI_URL || '').trim();
    if (wompi) {
      pagos += ` Si el cliente prefiere pagar en línea (tarjeta de crédito/débito o PSE), compártele este enlace de pago de la pasarela Wompi: ${wompi} — aclárale que este medio tiene un costo adicional por comisión de la pasarela: 2.65% + $700 + IVA por transacción exitosa.`;
    }
    if (qrDisponible() || wompi) sys += pagos;
  }

  const messages = [{ role: 'system', content: sys }, ...prev, { role: 'user', content: userMessage }];
  const opciones = { model: runtime.model, messages };
  if (tools.length) opciones.tools = tools;

  let completion = await openai.chat.completions.create(opciones);
  let msg = completion.choices[0].message;

  // Si el modelo decide usar herramientas, las ejecutamos y volvemos a preguntar
  const ctx = {};
  if (msg.tool_calls && msg.tool_calls.length) {
    messages.push(msg);
    for (const tc of msg.tool_calls) {
      let resultado;
      try {
        resultado = await ejecutarHerramienta(tc.function.name, JSON.parse(tc.function.arguments || '{}'), chatId, ctx);
      } catch (e) { resultado = 'Error al ejecutar ' + tc.function.name + ': ' + e.message; }
      messages.push({ role: 'tool', tool_call_id: tc.id, content: resultado });
    }
    // Si una herramienta definió una respuesta de formato fijo, se envía tal cual (sin parafraseo del modelo)
    if (ctx.respuestaDirecta) {
      await store.append(chatId, 'user', userMessage);
      await store.append(chatId, 'assistant', ctx.respuestaDirecta);
      return ctx.respuestaDirecta;
    }
    completion = await openai.chat.completions.create({ model: runtime.model, messages });
    msg = completion.choices[0].message;
  }

  const reply = (msg.content || '').trim();
  await store.append(chatId, 'user', userMessage);
  await store.append(chatId, 'assistant', reply);
  return reply;
}

// ------------------------------------------------------------
//  Responder a una IMAGEN usando la vision de OpenAI
// ------------------------------------------------------------
async function responderImagen(chatId, base64, mimetype, caption) {
  const prev = await store.getRecent(chatId, runtime.maxHistory * 2);
  const dataUrl = `data:${(mimetype || 'image/jpeg').split(';')[0]};base64,${base64}`;
  const pregunta = caption && caption.trim() ? caption.trim() : '¿Qué hay en esta imagen?';
  const texto = `Observa con atención la imagen adjunta y responde de forma directa y concreta (tienes la imagen, no digas que no puedes verla). ${pregunta}`;

  const systemVision = systemBase(
    'IMPORTANTE: Tienes capacidad de VISIÓN. En este mensaje el usuario adjuntó una imagen real que SÍ puedes ver y analizar. ' +
    'Describe lo que observas y responde con seguridad. Ignora cualquier mensaje anterior donde dijiste que no podías ver imágenes: eso ya no aplica.'
  );

  const messages = [
    { role: 'system', content: systemVision },
    ...prev,
    { role: 'user', content: [
      { type: 'text', text: texto },
      { type: 'image_url', image_url: { url: dataUrl } },
    ] },
  ];

  const completion = await openai.chat.completions.create({ model: runtime.model, messages });
  const reply = completion.choices[0].message.content.trim();

  // Guardamos un texto (no el base64) para mantener el contexto liviano
  await store.append(chatId, 'user', '[Imagen recibida]' + (caption ? ' ' + caption : ''));
  await store.append(chatId, 'assistant', reply);
  return reply;
}

// ------------------------------------------------------------
//  Transcribir un AUDIO / nota de voz con Whisper
// ------------------------------------------------------------
async function transcribirAudio(base64, mimetype) {
  const buf = Buffer.from(base64, 'base64');
  const mt = (mimetype || '').toLowerCase();
  const ext = mt.includes('ogg') ? 'ogg'
    : (mt.includes('mpeg') || mt.includes('mp3')) ? 'mp3'
    : mt.includes('wav') ? 'wav'
    : mt.includes('mp4') || mt.includes('m4a') ? 'm4a' : 'ogg';
  const file = await toFile(buf, 'audio.' + ext, { type: mt.split(';')[0] || 'audio/ogg' });
  const tr = await openai.audio.transcriptions.create({ file, model: 'whisper-1', language: 'es' });
  return (tr.text || '').trim();
}

// ------------------------------------------------------------
//  FLUJO CONVERSACIONAL (menús con opciones)
// ------------------------------------------------------------
async function manejarFlujo(chatId, entrada) {
  const f = flow.obtener();
  const estado = await store.getFlowState(chatId);

  // Palabra clave (menú/inicio...) o usuario nuevo -> ir al inicio
  if (flow.esTrigger(entrada) || !estado || !flow.nodo(estado)) {
    await mostrarNodo(chatId, f.start);
    return;
  }

  const n = flow.nodo(estado);

  // Nodo de chat con IA: respuesta libre (con el contexto del nodo)
  if (n.type === 'ai') {
    const reply = await askOpenAI(chatId, entrada, n.systemAddon || '');
    await sendWhatsApp(chatId, reply);
    console.log(`🤖 (IA/${estado}): ${reply}\n`);
    return;
  }

  // Nodo de menú: emparejar la opción elegida
  const opt = flow.matchOpcion(n, entrada);
  if (!opt) {
    await sendWhatsApp(chatId, '❓ No reconocí esa opción.\n\n' + flow.renderMenu(n));
    return;
  }
  await mostrarNodo(chatId, opt.next);
}

async function mostrarNodo(chatId, nodeId) {
  const f = flow.obtener();
  const valido = !!flow.nodo(nodeId);
  const n = flow.nodo(nodeId) || flow.nodo(f.start);
  await store.setFlowState(chatId, valido ? nodeId : f.start);
  console.log(`🧭 ${chatId} -> nodo "${valido ? nodeId : f.start}"`);

  if (n.type === 'menu') await enviarMenu(chatId, n);
  else if (n.message) await sendWhatsApp(chatId, n.message);
}

async function enviarMenu(chatId, n) {
  // Intento de botones nativos (best-effort, si está activado).
  if (runtime.nativeButtons) {
    try { await intentarBotones(chatId, n); } catch (e) { console.warn('botones nativos:', e.message); }
  }
  // El menú de TEXTO numerado siempre se envía (funciona en todos los teléfonos).
  await sendWhatsApp(chatId, flow.renderMenu(n));
}

async function intentarBotones(chatId, n) {
  const buttons = (n.options || []).slice(0, 3).map((o) => ({ id: String(o.key), text: o.label }));
  await fetch(waUrl('/messages'), {
    method: 'POST', headers: waHeaders,
    body: JSON.stringify({ phone: chatId, type: 'buttons', body: n.message, buttons }),
  });
}

// Espera un tiempo ALEATORIO entre delayMin y delayMax (anti-baneo: parecer humano)
function humanDelay() {
  const min = Math.max(0, runtime.delayMin) * 1000;
  const max = Math.max(min, runtime.delayMax * 1000);
  const ms = max > 0 ? min + Math.random() * (max - min) : 0;
  return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
}

// Muestra/oculta el indicador "escribiendo…" (requiere el parche de typing en openwa-api).
// Es best-effort: si el endpoint no existe aún, simplemente se ignora.
async function mostrarEscribiendo(chatId, state) {
  if (!runtime.showTyping) return;
  try {
    await fetch(waUrl('/messages/typing'), {
      method: 'POST', headers: waHeaders, body: JSON.stringify({ chatId, state }),
    });
  } catch { /* el endpoint puede no estar desplegado todavía */ }
}

async function sendWhatsApp(chatId, text) {
  marcarEnvioBot(text);            // para no confundir este envío con un mensaje manual tuyo
  await mostrarEscribiendo(chatId, true); // "escribiendo…" mientras "piensa"
  await humanDelay();              // pausa humanizada antes de enviar

  // Reintento: el openwa-api a veces da 500 en el primer envío a un contacto nuevo
  let ultimoError = '';
  for (let intento = 1; intento <= 2; intento++) {
    const res = await fetch(waUrl('/messages/send-text'), {
      method: 'POST', headers: waHeaders, body: JSON.stringify({ chatId, text }),
    });
    if (res.ok) return res.json();
    ultimoError = `${res.status} ${(await res.text()).slice(0, 150)}`;
    if (intento < 2) { console.warn(`↻ Reintentando envío a ${chatId} (falló: ${ultimoError})`); await new Promise((r) => setTimeout(r, 1500)); }
  }
  throw new Error(`send-text fallo a ${chatId}: ${ultimoError}`);
}

// Envía una imagen por WhatsApp (por URL o base64) con caption opcional
async function sendWhatsAppImage(chatId, { url, base64, mimetype, caption, filename } = {}) {
  marcarEnvioBot(caption || '[imagen]');
  await mostrarEscribiendo(chatId, true);
  await humanDelay();
  const body = { chatId, caption: caption || undefined };
  if (url) body.url = url;
  if (base64) body.base64 = base64;
  if (mimetype) body.mimetype = mimetype;   // así openwa sabe que es JPG/PNG (no un .img genérico)
  if (filename) body.filename = filename;

  let ultimoError = '';
  for (let intento = 1; intento <= 2; intento++) {
    const res = await fetch(waUrl('/messages/send-image'), {
      method: 'POST', headers: waHeaders, body: JSON.stringify(body),
    });
    if (res.ok) return res.json();
    ultimoError = `${res.status} ${(await res.text()).slice(0, 150)}`;
    if (intento < 2) { console.warn(`↻ Reintentando imagen a ${chatId} (falló: ${ultimoError})`); await new Promise((r) => setTimeout(r, 1500)); }
  }
  throw new Error(`send-image fallo a ${chatId}: ${ultimoError}`);
}

async function getSessionInfo() {
  try {
    const r = await fetch(waUrl(''), { headers: waHeaders });
    if (!r.ok) return null;
    const d = await r.json();
    return d.data || d;
  } catch { return null; }
}

// ------------------------------------------------------------
//  Verificacion HMAC del webhook
// ------------------------------------------------------------
function firmaValida(rawBody, signatureHeader) {
  if (!OPENWA_WEBHOOK_SECRET) return true;
  if (!signatureHeader) return false;
  const esperado = 'sha256=' + crypto.createHmac('sha256', OPENWA_WEBHOOK_SECRET).update(rawBody).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(esperado)); }
  catch { return false; }
}

// ------------------------------------------------------------
//  Webhooks en openwa-api
// ------------------------------------------------------------
async function limpiarWebhooksDe(sid) {
  const baseUrl = `${OPENWA_API_URL}/api/sessions/${sid}/webhooks`;
  const r = await fetch(baseUrl, { headers: waHeaders });
  if (!r.ok) return;
  const data = await r.json();
  const lista = Array.isArray(data) ? data : data.data || [];
  for (const wh of lista) await fetch(`${baseUrl}/${wh.id}`, { method: 'DELETE', headers: waHeaders });
  if (lista.length) console.log(`🧹 Limpiados ${lista.length} webhook(s) de la sesión ${sid}`);
}
async function limpiarWebhooks() {
  return limpiarWebhooksDe(runtime.sessionId);
}

async function registrarWebhook(publicUrl) {
  await limpiarWebhooks();
  const r = await fetch(waUrl('/webhooks'), {
    method: 'POST', headers: waHeaders,
    body: JSON.stringify({ url: publicUrl + '/webhook', events: ['message.received', 'message.sent'], secret: OPENWA_WEBHOOK_SECRET || undefined }),
  });
  if (!r.ok) throw new Error(`No se pudo registrar webhook: ${r.status} ${await r.text()}`);
  state.webhookActive = true;
  console.log('✅ Webhook registrado ->', publicUrl + '/webhook');
}

// ------------------------------------------------------------
//  Tunel de Cloudflare
// ------------------------------------------------------------
function iniciarTunel() {
  return new Promise((resolve, reject) => {
    const { bin } = require('cloudflared');
    const cf = spawn(bin, ['tunnel', '--url', `http://localhost:${port}`]);
    let listo = false;
    const buscar = (buf) => {
      const m = buf.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m && !listo) { listo = true; resolve({ url: m[0], proc: cf }); }
    };
    cf.stdout.on('data', buscar);
    cf.stderr.on('data', buscar);
    cf.on('exit', (c) => { if (!listo) reject(new Error('cloudflared se cerro (codigo ' + c + ')')); });
    setTimeout(() => { if (!listo) reject(new Error('Tiempo agotado esperando la URL del tunel')); }, 30000);
  });
}

// ------------------------------------------------------------
//  Servidor web
// ------------------------------------------------------------
const app = express();
// Limite alto: la media (imagenes/audios) llega en base64 dentro del webhook
app.use(express.json({ limit: '50mb', verify: (req, _res, buf) => { req.rawBody = buf; } }));
// Si un webhook llega demasiado grande, respondemos 200 (para que openwa no reintente) y lo ignoramos
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') {
    console.warn('⚠️  Webhook demasiado grande (media muy pesada), ignorado.');
    return res.sendStatus(200);
  }
  next(err);
});

// ---- Webhook (publico, SIN login: lo llama openwa-api) ----
app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    const body = req.body || {};
    const sig = req.get('x-openwa-signature') || req.get('X-OpenWA-Signature');
    if (!firmaValida(req.rawBody, sig)) { console.warn('⚠️  Firma de webhook invalida.'); return; }

    const event = body.event || body.payload?.event;
    const data = body.data || body.payload?.data || {};

    // Mensaje SALIENTE: si lo escribiste TÚ a mano, activamos atención humana
    if (event === 'message.sent') {
      if (!runtime.enableAutoHandoff) return;
      if (data.fromMe !== true) return;
      if (esEnvioDelBot(data.body)) return; // fue un envío del propio bot, no tuyo
      const chatId = data.chatId || data.to;
      if (chatId && (chatId.endsWith('@c.us') || chatId.endsWith('@lid') || chatId.endsWith('@g.us'))) {
        activarHandoff(chatId);
        console.log(`🙋 Atención humana activada en ${chatId} por ${runtime.handoffMinutes} min (escribiste tú)`);
      }
      return;
    }

    if (event !== 'message.received') return;

    const chatId = data.chatId || data.from;
    const text = data.body ?? data.text ?? '';
    const type = data.type || 'text';
    const fromMe = data.fromMe === true;

    // Guardamos el nombre del contacto para mostrarlo en el panel
    const nombreContacto = data.contact?.name || data.contact?.pushName || data.pushName || '';
    if (chatId && nombreContacto) contactos.set(chatId, nombreContacto);
    // Atendemos chats personales (@c.us / @lid) y, si esta activado en el panel,
    // tambien grupos (@g.us). Siempre ignoramos estados (status@broadcast),
    // canales (@newsletter) y difusiones (@broadcast).
    const esGrupo = !!chatId && chatId.endsWith('@g.us');
    const esPersonal = !!chatId && (chatId.endsWith('@c.us') || chatId.endsWith('@lid'));
    const permitido = esPersonal || (esGrupo && runtime.replyInGroups);

    if (!chatId || fromMe || !permitido) return;

    // 🚫 Número/chat en la lista de ignorados: no respondemos
    if (estaIgnorado(chatId)) {
      console.log(`🚫 Ignorado (en lista): ${chatId}`);
      return;
    }

    // ⏸️ Bot en pausa global: no respondemos (el humano atiende directamente)
    if (runtime.paused) {
      console.log(`⏸️  (pausado) mensaje ignorado de ${chatId}`);
      return;
    }

    // 🙋 Atención humana en ESTA conversación: el bot calla (tú la atiendes)
    if (handoffActivo(chatId)) {
      console.log(`🙋 (atención humana) bot en silencio para ${chatId}`);
      return;
    }

    // --- Mensajes con MEDIA (imagen / audio) ---
    // OJO: openwa a veces manda hasMedia=false aunque SI incluya el archivo,
    // por eso detectamos la media por la presencia de media.data.
    const media = data.media;
    if (media && media.data) {
      const mt = (media.mimetype || '').toLowerCase();
      try {
        if (type === 'image' || mt.startsWith('image/')) {
          if (!runtime.enableImages) { await sendWhatsApp(chatId, '🤖 No estoy configurado para procesar imágenes. Escríbeme tu consulta en texto. 🙂'); return; }
          console.log(`🖼️  ${chatId}: [imagen]${text ? ' ' + text : ''}`);
          const reply = await responderImagen(chatId, media.data, media.mimetype, text);
          await sendWhatsApp(chatId, reply);
          state.messagesHandled++;
          console.log(`🤖 Bot: ${reply}\n`);
          return;
        }
        if (type === 'ptt' || type === 'audio' || mt.startsWith('audio/')) {
          if (!runtime.enableAudio) { await sendWhatsApp(chatId, '🤖 No estoy configurado para procesar audios. Escríbeme tu consulta en texto. 🙂'); return; }
          console.log(`🎤 ${chatId}: [audio] transcribiendo...`);
          const texto = await transcribirAudio(media.data, media.mimetype);
          if (!texto) { await sendWhatsApp(chatId, '🤖 No logré entender el audio. ¿Puedes repetirlo o escribirlo?'); return; }
          console.log(`   → "${texto}"`);
          const reply = await askOpenAI(chatId, texto);
          await sendWhatsApp(chatId, reply);
          state.messagesHandled++;
          console.log(`🤖 Bot: ${reply}\n`);
          return;
        }
        await sendWhatsApp(chatId, '🤖 Puedo leer texto, imágenes y audios. Ese tipo de archivo todavía no lo proceso.');
        return;
      } catch (e) {
        console.error('⚠️  Error procesando media:', e.message);
        await sendWhatsApp(chatId, '😕 Tuve un problema procesando tu archivo. Intenta de nuevo.');
        return;
      }
    }

    // --- Mensajes de solo TEXTO ---
    if (type !== 'text' && type !== 'chat') {
      // Solo avisamos por MEDIA real que un cliente envía y aún no soportamos.
      // Los mensajes de SISTEMA (cifrado e2e, notificaciones, etc.) se ignoran en silencio.
      const mediaNoSoportada = ['video', 'document', 'sticker', 'location', 'vcard', 'contact', 'multi_vcard'];
      if (mediaNoSoportada.includes(type)) {
        await sendWhatsApp(chatId, '🤖 Por ahora entiendo texto, imágenes y audios.');
      } else {
        console.log(`ℹ️  Ignorado mensaje de tipo "${type}" (mensaje de sistema, no de usuario)`);
      }
      return;
    }
    if (!text.trim()) return;

    console.log(`📩 ${chatId}: ${text}`);
    if (runtime.enableFlow) {
      // Modo flujo: menús + IA según el nodo en que esté el usuario
      await manejarFlujo(chatId, text.trim());
    } else {
      // Modo IA puro
      const reply = await askOpenAI(chatId, text);
      await sendWhatsApp(chatId, reply);
      console.log(`🤖 Bot: ${reply}\n`);
    }
    state.messagesHandled++;
  } catch (err) {
    console.error('⚠️  Error procesando webhook:', err.message);
  }
});

// ============================================================
//  Autenticacion por sesion (cookie firmada) — con pagina de login
// ============================================================
// Dos roles: 'admin' (administración, todo) y 'gestion' (solo lectura).
const GESTION_USER = process.env.GESTION_USER || '';
const GESTION_PASSWORD = process.env.GESTION_PASSWORD || '';
// El secreto depende de las contraseñas: si las cambias, las sesiones caducan.
const SESSION_SECRET = crypto.createHash('sha256')
  .update('sess|' + ADMIN_USER + '|' + ADMIN_PASSWORD + '|' + GESTION_PASSWORD).digest();
const SESSION_DIAS = 7;

function b64url(x) { return Buffer.from(x).toString('base64url'); }

function crearToken(user, role) {
  const payload = b64url(JSON.stringify({ u: user, r: role, exp: Date.now() + SESSION_DIAS * 86400000 }));
  const sig = b64url(crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest());
  return payload + '.' + sig;
}

// Devuelve los datos de la sesión { u, r } si el token es válido, o null
function tokenInfo(token) {
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const esperado = b64url(crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest());
  if (sig.length !== esperado.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(esperado))) return null;
  try { const d = JSON.parse(Buffer.from(payload, 'base64url')); return d.exp > Date.now() ? d : null; }
  catch { return null; }
}

function leerCookie(req, nombre) {
  const h = req.headers.cookie || '';
  for (const parte of h.split(';')) {
    const i = parte.indexOf('=');
    if (i > -1 && parte.slice(0, i).trim() === nombre) return decodeURIComponent(parte.slice(i + 1));
  }
  return null;
}

// Sesión actual del request (o null). Si no hay contraseña configurada, admin.
function sesion(req) {
  if (!ADMIN_PASSWORD) return { u: ADMIN_USER, r: 'admin' };
  return tokenInfo(leerCookie(req, 'session'));
}

// Para paginas: redirige al login.
function authPage(req, res, next) { return sesion(req) ? next() : res.redirect('/login'); }
// Para APIs de LECTURA (cualquier rol con sesión válida).
function authApi(req, res, next) { return sesion(req) ? next() : res.sendStatus(401); }
// Solo ADMINISTRACIÓN (escritura / configuración).
function authAdmin(req, res, next) {
  const s = sesion(req);
  if (!s) return res.sendStatus(401);
  if (s.r !== 'admin') return res.status(403).json({ error: 'Tu rol es de solo lectura (gestión).' });
  next();
}

// ---- Login / logout ----
app.get('/login', (req, res) => {
  if (sesion(req)) return res.redirect('/admin');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/api/login', (req, res) => {
  const { user, password } = req.body || {};
  let role = null;
  if (user === ADMIN_USER && password === ADMIN_PASSWORD) role = 'admin';
  else if (GESTION_USER && user === GESTION_USER && password === GESTION_PASSWORD) role = 'gestion';
  if (role) {
    res.set('Set-Cookie', `session=${crearToken(user, role)}; HttpOnly; Path=/; Max-Age=${SESSION_DIAS * 86400}; SameSite=Lax`);
    return res.json({ ok: true, role });
  }
  res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
});

app.post('/api/logout', (_req, res) => {
  res.set('Set-Cookie', 'session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax');
  res.json({ ok: true });
});

// ---- Logo (publico, lo usan el login y el panel) ----
app.get('/logo.png', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'logo.png')));

// ---- Panel (protegido) ----
app.get('/', (_req, res) => res.redirect('/admin'));
app.get('/admin', authPage, (_req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

app.get('/api/admin/status', authApi, async (req, res) => {
  const session = await getSessionInfo();
  let storage;
  try { storage = await store.metrics(); }
  catch (e) { storage = { driver: 'error', error: e.message, conversations: 0, totalMessages: 0 }; }
  res.json({
    online: true,
    role: (sesion(req) || {}).r || 'admin',
    paused: runtime.paused,
    humanHandling: contarHandoff(),
    uptimeSec: (Date.now() - state.startedAt) / 1000,
    publicUrl: state.publicUrl,
    webhookActive: state.webhookActive,
    messagesHandled: state.messagesHandled,
    model: runtime.model,
    session: session ? { phone: session.phone, status: session.status, name: session.name } : null,
    storage,
  });
});

app.get('/api/admin/config', authAdmin, async (_req, res) => {
  const env = cfg.leerEnv();
  let sessions = [];
  try { sessions = await getSessions(); } catch { /* ignore */ }
  let modelos = [];
  try { modelos = await getModelos(); } catch { /* ignore */ }

  const fields = Object.entries(cfg.EDITABLE).map(([key, meta]) => {
    const f = {
      key, label: meta.label, type: meta.type, live: !!meta.live, secret: !!meta.secret,
      group: meta.group || 'General', options: meta.options || null,
      value: meta.secret ? cfg.enmascarar(env[key]) : (env[key] || ''),
    };
    // La sesión de WhatsApp se muestra como desplegable con las sesiones conectadas
    if (key === 'OPENWA_SESSION_ID' && sessions.length) {
      f.type = 'select';
      f.options = sessions.map((s) => ({ value: s.id, label: `${s.name || s.id} (${s.phone || '?'}) · ${s.status || ''}` }));
    }
    // El modelo de OpenAI se muestra como desplegable con los modelos disponibles
    if (key === 'OPENAI_MODEL' && modelos.length) {
      const lista = modelos.includes(f.value) || !f.value ? modelos : [f.value, ...modelos];
      f.type = 'select';
      f.options = lista;
    }
    return f;
  });
  res.json({ fields });
});

app.post('/api/admin/config', authAdmin, async (req, res) => {
  try {
    const updates = {};
    const needsRestart = [];
    for (const [key, meta] of Object.entries(cfg.EDITABLE)) {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) {
        updates[key] = String(req.body[key]);
        if (!meta.live) needsRestart.push(meta.label);
      }
    }
    if (Object.keys(updates).length === 0) return res.json({ ok: true, needsRestart: [] });

    cfg.actualizarEnv(updates);

    if (updates.SYSTEM_PROMPT !== undefined) runtime.systemPrompt = updates.SYSTEM_PROMPT;
    if (updates.OPENAI_MODEL !== undefined) runtime.model = updates.OPENAI_MODEL;
    if (updates.MAX_HISTORY !== undefined) runtime.maxHistory = parseInt(updates.MAX_HISTORY, 10) || runtime.maxHistory;
    if (updates.ENABLE_IMAGES !== undefined) runtime.enableImages = updates.ENABLE_IMAGES === 'true';
    if (updates.ENABLE_AUDIO !== undefined) runtime.enableAudio = updates.ENABLE_AUDIO === 'true';
    if (updates.REPLY_IN_GROUPS !== undefined) runtime.replyInGroups = updates.REPLY_IN_GROUPS === 'true';
    if (updates.ENABLE_FLOW !== undefined) runtime.enableFlow = updates.ENABLE_FLOW === 'true';
    if (updates.NATIVE_BUTTONS !== undefined) runtime.nativeButtons = updates.NATIVE_BUTTONS === 'true';
    if (updates.ENABLE_AUTO_HANDOFF !== undefined) runtime.enableAutoHandoff = updates.ENABLE_AUTO_HANDOFF === 'true';
    if (updates.HANDOFF_MINUTES !== undefined) runtime.handoffMinutes = parseInt(updates.HANDOFF_MINUTES, 10) || runtime.handoffMinutes;
    if (updates.RESPONSE_DELAY_MIN !== undefined) runtime.delayMin = parseFloat(updates.RESPONSE_DELAY_MIN) || 0;
    if (updates.RESPONSE_DELAY_MAX !== undefined) runtime.delayMax = parseFloat(updates.RESPONSE_DELAY_MAX) || 0;
    if (updates.SHOW_TYPING !== undefined) runtime.showTyping = updates.SHOW_TYPING === 'true';
    if (updates.STRICT_MODE !== undefined) runtime.strict = updates.STRICT_MODE === 'true';
    if (updates.ENABLE_CALENDAR !== undefined) runtime.enableCalendar = updates.ENABLE_CALENDAR === 'true';
    if (['GOOGLE_CALENDAR_ID', 'GOOGLE_CALENDAR_TIMEZONE', 'GOOGLE_MEET_LINK'].some(k => updates[k] !== undefined)) configurarCalendario();
    if (updates.ENABLE_SMTP !== undefined) runtime.enableSmtp = updates.ENABLE_SMTP === 'true';
    if (['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM'].some(k => updates[k] !== undefined)) configurarCorreo();
    if (updates.ENABLE_PAGOS !== undefined) runtime.enablePagos = updates.ENABLE_PAGOS === 'true';

    // Cambio de sesión de WhatsApp EN VIVO: mueve el webhook a la nueva sesión
    if (updates.OPENWA_SESSION_ID !== undefined && updates.OPENWA_SESSION_ID !== runtime.sessionId) {
      const sidViejo = runtime.sessionId;
      runtime.sessionId = updates.OPENWA_SESSION_ID;
      try { await limpiarWebhooksDe(sidViejo); } catch { /* ignore */ }
      try {
        if (state.publicUrl) await registrarWebhook(state.publicUrl);
        console.log('🔄 Sesión cambiada a', runtime.sessionId);
      } catch (e) {
        console.error('⚠️  Error re-registrando webhook tras cambio de sesión:', e.message);
      }
    }

    res.json({ ok: true, needsRestart });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- Pausar / reanudar el bot (modo atención humana) ----
app.post('/api/admin/pause', authAdmin, (req, res) => {
  const paused = req.body && req.body.paused === true;
  runtime.paused = paused;
  try { cfg.actualizarEnv({ BOT_PAUSED: String(paused) }); } catch (e) { /* no crítico */ }
  console.log(paused ? '⏸️  Bot PAUSADO desde el panel' : '▶️  Bot REANUDADO desde el panel');
  res.json({ ok: true, paused });
});

// ---- Reiniciar el bot (lo relanza el supervisor con npm start) ----
app.post('/api/admin/restart', authAdmin, (_req, res) => {
  res.json({ ok: true });
  console.log('♻️  Reinicio solicitado desde el panel');
  setTimeout(() => cerrar(75), 300);
});

// ---- Números/chats ignorados ----
app.get('/api/admin/ignored', authApi, async (_req, res) => {
  let recent = [];
  try { recent = await store.recentChats(20); } catch { /* ignore */ }
  // marcamos cuáles ya están ignorados
  recent = recent.map((c) => ({ ...c, nombre: contactos.get(c.chatId) || '', ignored: estaIgnorado(c.chatId) }));
  res.json({ ignored: runtime.ignored, recent });
});

app.post('/api/admin/ignored', authAdmin, (req, res) => {
  const accion = req.body && req.body.action;
  const valor = (req.body && String(req.body.value || '').trim()) || '';
  if (!valor) return res.status(400).json({ error: 'Valor vacío' });

  if (accion === 'add') {
    if (!runtime.ignored.includes(valor)) runtime.ignored.push(valor);
  } else if (accion === 'remove') {
    runtime.ignored = runtime.ignored.filter((x) => x !== valor);
  } else {
    return res.status(400).json({ error: 'Acción inválida' });
  }
  try { cfg.actualizarEnv({ IGNORED_CHATS: runtime.ignored.join(',') }); } catch { /* no crítico */ }
  console.log(`🚫 Lista de ignorados actualizada (${runtime.ignored.length}): ${runtime.ignored.join(', ')}`);
  res.json({ ok: true, ignored: runtime.ignored });
});

// ---- Base de conocimiento: leer / guardar ----
app.get('/api/admin/knowledge', authApi, (_req, res) => {
  res.json({ knowledge: runtime.knowledge || '' });
});
app.post('/api/admin/knowledge', authAdmin, (req, res) => {
  try {
    guardarConocimiento(String((req.body && req.body.knowledge) || ''));
    console.log(`📚 Base de conocimiento actualizada (${runtime.knowledge.length} caracteres)`);
    res.json({ ok: true, length: runtime.knowledge.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Subir un documento (.txt o .pdf) y agregar su texto al conocimiento
app.post('/api/admin/knowledge/upload', authAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibió ningún archivo' });
    const nombre = req.file.originalname || 'documento';
    const ext = nombre.toLowerCase().split('.').pop();
    let texto = '';

    if (ext === 'pdf' || req.file.mimetype === 'application/pdf') {
      const parser = new PDFParse({ data: req.file.buffer });
      const r = await parser.getText();
      texto = (r.text || '').replace(/--\s*\d+\s*of\s*\d+\s*--/g, '').replace(/\n{3,}/g, '\n\n').trim();
      try { await parser.destroy(); } catch {}
    } else if (ext === 'txt' || ext === 'md' || (req.file.mimetype || '').startsWith('text/')) {
      texto = req.file.buffer.toString('utf8').trim();
    } else {
      return res.status(400).json({ error: 'Solo se aceptan archivos .txt o .pdf' });
    }

    if (!texto) return res.status(400).json({ error: 'No se pudo extraer texto (¿es un PDF escaneado/de imágenes?)' });

    const bloque = `\n\n=== Documento: ${nombre} ===\n${texto}`;
    guardarConocimiento(((runtime.knowledge || '').trim() + bloque).trim());
    console.log(`📚 Documento "${nombre}" agregado al conocimiento (${texto.length} caracteres)`);
    res.json({ ok: true, nombre, caracteres: texto.length, total: runtime.knowledge.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- Google Calendar ----
app.get('/api/admin/calendar/status', authApi, async (_req, res) => {
  let info = null, error = null;
  if (calendar.disponible()) {
    try { info = await calendar.probar(); } catch (e) { error = e.message; }
  }
  res.json({
    enabled: runtime.enableCalendar,
    configurado: calendar.disponible(),
    calendarId: calendar.conf.calendarId,
    timezone: calendar.conf.timezone,
    calendario: info,
    error,
  });
});

app.post('/api/admin/calendar/credentials', authAdmin, upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' });
    let json;
    try { json = JSON.parse(req.file.buffer.toString('utf8')); }
    catch { return res.status(400).json({ error: 'El archivo no es un JSON válido' }); }
    if (!json.client_email || !json.private_key) return res.status(400).json({ error: 'No parece una clave de cuenta de servicio (falta client_email/private_key)' });
    const dest = process.env.GOOGLE_CREDENTIALS_FILE || 'data/google-credentials.json';
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, JSON.stringify(json, null, 2));
    configurarCalendario();
    console.log('📅 Credenciales de Google Calendar guardadas:', json.client_email);
    res.json({ ok: true, email: json.client_email });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/calendar/events', authApi, async (_req, res) => {
  if (!calendar.disponible()) return res.json({ events: [] });
  try { res.json({ events: await calendar.listarEventos(new Date(), null, 25) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/calendar/event', authAdmin, async (req, res) => {
  try {
    if (!calendar.disponible()) return res.status(400).json({ error: 'Calendario no configurado' });
    const ev = await calendar.crearEvento(req.body || {});
    console.log('📅 Evento creado:', ev.titulo, '->', ev.link);
    await confirmarCita(ev, { emailCliente: (req.body || {}).emailCliente, nombreCliente: (req.body || {}).nombreCliente, empresa: (req.body || {}).empresa });
    res.json({ ok: true, evento: ev });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/calendar/event/delete', authAdmin, async (req, res) => {
  try { await calendar.borrarEvento((req.body || {}).id); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- Correo (SMTP) ----
app.get('/api/admin/smtp/status', authApi, async (_req, res) => {
  let info = null, error = null;
  if (mailer.disponible()) {
    try { info = await mailer.probar(); } catch (e) { error = e.message; }
  }
  res.json({
    enabled: runtime.enableSmtp,
    configurado: mailer.disponible(),
    from: mailer.conf.from || mailer.conf.user,
    host: mailer.conf.host,
    notifica: process.env.NOTIFY_EMAIL || '',
    info,
    error,
  });
});

app.post('/api/admin/smtp/test', authAdmin, async (req, res) => {
  try {
    const to = (req.body || {}).to;
    if (!to) return res.status(400).json({ error: 'Falta el correo destinatario' });
    await mailer.enviar({
      to,
      subject: 'Prueba del chatbot ✅',
      text: 'Este es un correo de prueba enviado desde el panel del chatbot. Si lo recibiste, el SMTP funciona correctamente. 🎉',
    });
    console.log('✉️  Correo de prueba enviado a', to);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- Pagos: QR (Bre-B) ----
app.get('/api/admin/pagos/status', authApi, (_req, res) => {
  res.json({
    enabled: runtime.enablePagos,
    qrCargado: qrDisponible(),
    caption: process.env.PAGO_QR_CAPTION || '',
  });
});

app.post('/api/admin/pagos/qr', authAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' });
    if (!/^image\//.test(req.file.mimetype || '')) return res.status(400).json({ error: 'El archivo debe ser una imagen (PNG o JPG)' });
    fs.mkdirSync(path.resolve('data'), { recursive: true });
    // Quitar variantes previas para no dejar dos archivos
    for (const e of ['.png', '.jpg', '.jpeg']) { const p = path.resolve('data/qr-pago' + e); if (fs.existsSync(p)) fs.unlinkSync(p); }

    // Re-codificar SIEMPRE a JPEG estándar (baseline, sin metadatos raros):
    // garantiza que WhatsApp lo acepte y se pueda descargar sin errores.
    // (jimp es JavaScript puro: funciona en cualquier CPU, sin binarios nativos)
    let buffer = req.file.buffer;
    let ext = /jpe?g/i.test(req.file.mimetype) ? '.jpg' : '.png';
    try {
      const { Jimp } = require('jimp');
      let img = await Jimp.read(req.file.buffer); // aplica la orientación EXIF al decodificar
      if (img.width > 1280 || img.height > 1280) img.scaleToFit({ w: 1280, h: 1280 });
      if (img.hasAlpha()) { // quita transparencia (los PNG pasan a fondo blanco)
        const fondo = new Jimp({ width: img.width, height: img.height, color: 0xffffffff });
        fondo.composite(img, 0, 0);
        img = fondo;
      }
      buffer = await img.getBuffer('image/jpeg', { quality: 90 });
      ext = '.jpg';
      console.log(`💳 QR re-codificado a JPEG estándar (${Math.round(req.file.buffer.length / 1024)} KB -> ${Math.round(buffer.length / 1024)} KB)`);
    } catch (e) { console.warn('💳 No se pudo re-codificar el QR (se guarda original):', e.message); }

    const dest = process.env.PAGO_QR_FILE ? path.resolve(process.env.PAGO_QR_FILE) : path.resolve('data/qr-pago' + ext);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buffer);
    console.log('💳 QR de pago actualizado:', dest);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/pagos/qr/delete', authAdmin, (_req, res) => {
  try {
    let borrado = false;
    for (const e of ['.png', '.jpg', '.jpeg']) {
      const p = path.resolve('data/qr-pago' + e);
      if (fs.existsSync(p)) { fs.unlinkSync(p); borrado = true; }
    }
    if (process.env.PAGO_QR_FILE) {
      const p = path.resolve(process.env.PAGO_QR_FILE);
      if (fs.existsSync(p)) { fs.unlinkSync(p); borrado = true; }
    }
    if (borrado) console.log('💳 QR de pago eliminado');
    res.json({ ok: true, borrado });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/pagos/qr-img', authApi, (_req, res) => {
  if (!qrDisponible()) return res.status(404).end();
  res.sendFile(pagoQrFile()); // sendFile pone Content-Type y Content-Length correctos
});

// Ruta PÚBLICA del QR (sin auth) para que openwa-api la descargue al enviar la imagen
app.get(['/pago/qr.jpg', '/pago/qr.jpeg', '/pago/qr.png', '/pago/qr.img'], (_req, res) => {
  if (!qrDisponible()) return res.status(404).end();
  res.sendFile(pagoQrFile());
});

// ---- Flujo conversacional: leer / guardar ----
app.get('/api/admin/flow', authApi, (_req, res) => {
  res.json(flow.obtener());
});

app.post('/api/admin/flow', authAdmin, (req, res) => {
  try {
    flow.guardar(req.body);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---- Probar la conexion a Postgres (con los datos guardados) ----
app.post('/api/admin/test-db', authAdmin, async (_req, res) => {
  try {
    const env = cfg.leerEnv();
    const r = await probarPostgres(env);
    res.json(r);
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ------------------------------------------------------------
//  Arranque
// ------------------------------------------------------------
let tunnelProc = null;

(async () => {
  try {
    await store.init();
  } catch (e) {
    console.error('❌ No se pudo iniciar el almacenamiento:', e.message);
    console.error('   Revisa la configuracion de la base de datos en .env o en el panel.');
    process.exit(1);
  }

  flow.cargar();
  runtime.knowledge = cargarConocimiento();
  console.log(`🧭 Flujo conversacional: ${runtime.enableFlow ? 'ACTIVADO' : 'desactivado'}`);
  console.log(`📚 Base de conocimiento: ${runtime.knowledge ? runtime.knowledge.length + ' caracteres' : 'vacía'}`);
  console.log(`📅 Calendario: ${runtime.enableCalendar ? (calendar.disponible() ? 'ACTIVO (herramienta agendar_evento disponible)' : 'activado pero SIN credenciales/ID') : 'desactivado'}`);
  console.log(`✉️  Correo SMTP: ${runtime.enableSmtp ? (mailer.disponible() ? 'ACTIVO' : 'activado pero sin host/usuario/clave') : 'desactivado'}`);
  console.log(`🔧 Herramientas del bot activas: ${herramientasActivas().map((t) => t.function.name).join(', ') || 'NINGUNA'}`);

  app.listen(port, async () => {
    console.log(`\n✅ Servidor local escuchando en http://localhost:${port}`);
    console.log(`🖥️  Panel de administracion: http://localhost:${port}/admin`);
    try {
      let publicUrl;
      if (USE_TUNNEL) {
        console.log('🌐 Abriendo tunel de Cloudflare...');
        const t = await iniciarTunel();
        publicUrl = t.url; tunnelProc = t.proc;
        console.log('🌐 URL publica:', publicUrl);
      } else {
        publicUrl = PUBLIC_URL_ENV;
        if (!publicUrl) { console.error('❌ USE_TUNNEL=false pero PUBLIC_URL esta vacio'); process.exit(1); }
      }
      state.publicUrl = publicUrl;
      await registrarWebhook(publicUrl);
      console.log('\n🤖 ¡Bot listo! Enviale un WhatsApp y respondera.\n');
    } catch (e) {
      console.error('❌ Error en el arranque:', e.message); process.exit(1);
    }
  });
})();

// Cierre limpio. codigo 75 = el supervisor lo vuelve a arrancar (reinicio).
function cerrar(codigo) {
  console.log('\n👋 Cerrando bot...');
  try { store.close(); } catch {}
  if (tunnelProc) try { tunnelProc.kill(); } catch {}
  setTimeout(() => process.exit(codigo), 200);
}
process.on('SIGINT', () => cerrar(0));
process.on('SIGTERM', () => cerrar(0));
