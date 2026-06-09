// ============================================================
//  Integración con Google Calendar (cuenta de servicio).
//  Crea/lista citas y recordatorios en un calendario de Google.
// ============================================================

const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

let clienteCal = null;
let conf = {
  calendarId: '',
  timezone: 'America/Bogota',
  credsFile: 'data/google-credentials.json',
};

// Configura el módulo (se llama al arrancar y cuando cambian los ajustes)
function configurar(opciones) {
  conf = { ...conf, ...opciones };
  clienteCal = null; // forzar reconexión con la nueva config
}

// ¿Está listo para usarse? (hay calendarId y archivo de credenciales)
function disponible() {
  try { return !!conf.calendarId && fs.existsSync(path.resolve(conf.credsFile)); }
  catch { return false; }
}

// Cliente autenticado de Google Calendar (cuenta de servicio)
async function cliente() {
  if (clienteCal) return clienteCal;
  const creds = JSON.parse(fs.readFileSync(path.resolve(conf.credsFile), 'utf8'));
  if (!creds.client_email) throw new Error('El JSON no tiene "client_email" (¿es una clave de cuenta de servicio?)');
  let key = creds.private_key || '';
  if (!key) throw new Error('El JSON no tiene "private_key" (¿es una clave de cuenta de servicio?)');
  if (key.includes('\\n')) key = key.replace(/\\n/g, '\n'); // por si vienen los saltos escapados

  const auth = new google.auth.JWT({
    email: creds.client_email,
    key,
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });
  await auth.authorize();
  clienteCal = google.calendar({ version: 'v3', auth });
  return clienteCal;
}

// Crea un evento (cita o recordatorio).
//  - inicio: Date/ISO. fin: opcional (por defecto +1h).
//  - todoElDia: true => recordatorio de día completo (sin hora).
//  - invitadoEmail: opcional, invita por correo.
//  - recordatorioMin: minutos antes para el aviso (por defecto 30).
// Convierte cualquier fecha/hora a "wall-clock" (YYYY-MM-DDTHH:MM:SS, sin zona)
function wall(s) { return String(s).slice(0, 19); }
// Suma minutos a una hora de pared y devuelve wall-clock
function sumarMin(inicioStr, min) {
  const d = new Date(wall(inicioStr) + 'Z'); // tratar como UTC solo para la aritmética
  d.setUTCMinutes(d.getUTCMinutes() + (min || 60));
  return d.toISOString().slice(0, 19);
}

async function crearEvento({ titulo, descripcion, inicio, fin, todoElDia, duracionMin, invitadoEmail, recordatorioMin, conMeet }) {
  const cal = await cliente();
  const ini = wall(inicio);
  const evento = {
    summary: titulo || 'Cita',
    description: descripcion || '',
    reminders: {
      useDefault: false,
      overrides: [{ method: 'popup', minutes: Number.isFinite(+recordatorioMin) ? +recordatorioMin : 30 }],
    },
  };

  if (todoElDia) {
    const dia = ini.slice(0, 10); // YYYY-MM-DD
    evento.start = { date: dia };
    evento.end = { date: dia };
  } else {
    // La hora se interpreta SIEMPRE en la zona del calendario (sin desfase de UTC)
    evento.start = { dateTime: ini, timeZone: conf.timezone };
    evento.end = { dateTime: fin ? wall(fin) : sumarMin(ini, duracionMin), timeZone: conf.timezone };
  }
  if (invitadoEmail) evento.attendees = [{ email: invitadoEmail }];

  // Google Meet: solo se crea si mandamos el bloque de conferencia Y conferenceDataVersion=1
  const pideMeet = !!conMeet && !todoElDia;
  if (pideMeet) {
    evento.conferenceData = {
      createRequest: {
        requestId: 'meet-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10),
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    };
  }

  const r = await cal.events.insert({
    calendarId: conf.calendarId,
    requestBody: evento,
    sendUpdates: invitadoEmail ? 'all' : 'none',
    conferenceDataVersion: pideMeet ? 1 : 0,
  });

  // Enlace de Meet (puede venir como hangoutLink o dentro de conferenceData)
  const meet = r.data.hangoutLink
    || (r.data.conferenceData && r.data.conferenceData.entryPoints
        && (r.data.conferenceData.entryPoints.find((e) => e.entryPointType === 'video') || {}).uri)
    || null;

  return { id: r.data.id, link: r.data.htmlLink, meet, titulo: r.data.summary, inicio: r.data.start, fin: r.data.end };
}

// Lista los próximos eventos
async function listarEventos(desde, hasta, max = 20) {
  const cal = await cliente();
  const r = await cal.events.list({
    calendarId: conf.calendarId,
    timeMin: (desde ? new Date(desde) : new Date()).toISOString(),
    timeMax: hasta ? new Date(hasta).toISOString() : undefined,
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: max,
  });
  return (r.data.items || []).map((e) => ({
    id: e.id,
    titulo: e.summary || '(sin título)',
    inicio: e.start?.dateTime || e.start?.date,
    fin: e.end?.dateTime || e.end?.date,
    link: e.htmlLink,
  }));
}

// Borra un evento
async function borrarEvento(id) {
  const cal = await cliente();
  await cal.events.delete({ calendarId: conf.calendarId, eventId: id });
}

// Prueba la conexión (devuelve el nombre del calendario)
async function probar() {
  const cal = await cliente();
  const r = await cal.calendars.get({ calendarId: conf.calendarId });
  return { ok: true, nombre: r.data.summary, zona: r.data.timeZone };
}

module.exports = { configurar, disponible, crearEvento, listarEventos, borrarEvento, probar, get conf() { return conf; } };
