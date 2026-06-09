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
  meetLink: '', // enlace fijo de Google Meet (reutilizable) para las citas
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

// Elige un enlace de Meet de la lista evitando los que usan reuniones cercanas en horario.
// Así dos reuniones seguidas (dentro del margen) nunca reciben el mismo enlace.
async function elegirMeet(inicioWall, finWall, links) {
  if (!links.length) return '';
  if (links.length === 1) return links[0];
  try {
    const cal = await cliente();
    const iniMs = new Date(wall(inicioWall) + 'Z').getTime();
    const finMs = new Date(wall(finWall) + 'Z').getTime();
    // Ventana amplia para la consulta (tolerante a la zona horaria)
    const r = await cal.events.list({
      calendarId: conf.calendarId,
      timeMin: new Date(iniMs - 24 * 3600000).toISOString(),
      timeMax: new Date(finMs + 24 * 3600000).toISOString(),
      singleEvents: true,
      maxResults: 100,
    });
    const bufferMs = 30 * 60000; // 30 min de margen => se consideran "seguidas"
    const usados = new Set();
    for (const e of (r.data.items || [])) {
      const eIni = e.start && (e.start.dateTime || e.start.date);
      if (!eIni) continue;
      const eFin = (e.end && (e.end.dateTime || e.end.date)) || eIni;
      const eIniMs = new Date(wall(eIni) + 'Z').getTime();
      const eFinMs = new Date(wall(eFin) + 'Z').getTime();
      const cerca = eIniMs < finMs + bufferMs && eFinMs > iniMs - bufferMs; // se solapan o están pegadas
      if (!cerca) continue;
      const texto = (e.location || '') + ' ' + (e.description || '') + ' ' + (e.hangoutLink || '');
      for (const l of links) if (texto.includes(l)) usados.add(l);
    }
    return links.find((l) => !usados.has(l)) || links[0]; // libre, o el primero si todos ocupados
  } catch {
    return links[0];
  }
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

  // Google Meet
  const pideMeet = !!conMeet && !todoElDia;
  const meetLinks = (conf.meetLink || '').split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
  let intentarApi = false;
  let meetElegido = '';
  if (pideMeet) {
    meetElegido = meetLinks.length ? await elegirMeet(evento.start.dateTime, evento.end.dateTime, meetLinks) : '';
    if (meetElegido) {
      // Enlace fijo (rotado para no chocar con reuniones seguidas): a descripción y ubicación
      evento.description = (evento.description ? evento.description + '\n\n' : '') + 'Reunión por Google Meet: ' + meetElegido;
      evento.location = meetElegido;
    } else {
      // Sin enlaces fijos: intentamos que Google cree uno (solo funciona con Workspace/OAuth)
      intentarApi = true;
      evento.conferenceData = {
        createRequest: {
          requestId: 'meet-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10),
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      };
    }
  }

  const r = await cal.events.insert({
    calendarId: conf.calendarId,
    requestBody: evento,
    sendUpdates: invitadoEmail ? 'all' : 'none',
    conferenceDataVersion: intentarApi ? 1 : 0,
  });

  // Enlace de Meet: el que genere Google, o el fijo elegido
  const meetGenerado = r.data.hangoutLink
    || (r.data.conferenceData && r.data.conferenceData.entryPoints
        && (r.data.conferenceData.entryPoints.find((e) => e.entryPointType === 'video') || {}).uri);
  const meet = meetGenerado || meetElegido || null;

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

// Cancela (elimina) citas que coincidan con los criterios dados.
//  Requiere al menos uno: inicio (fecha/hora), nombreCliente o emailCliente.
async function cancelarCita({ inicio, nombreCliente, emailCliente } = {}) {
  if (!inicio && !nombreCliente && !emailCliente) {
    throw new Error('Falta un criterio (fecha, nombre o correo) para ubicar la cita.');
  }
  const cal = await cliente();
  const ahora = new Date();
  const r = await cal.events.list({
    calendarId: conf.calendarId,
    timeMin: ahora.toISOString(),
    timeMax: new Date(ahora.getTime() + 90 * 24 * 3600000).toISOString(), // próximos 90 días
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 250,
  });
  let items = r.data.items || [];
  const norm = (s) => (s || '').toLowerCase().trim();

  if (emailCliente) {
    const e = norm(emailCliente);
    items = items.filter((ev) => norm(ev.description).includes(e) || norm(ev.summary).includes(e)
      || (ev.attendees || []).some((a) => norm(a.email) === e));
  }
  if (nombreCliente) {
    const n = norm(nombreCliente);
    items = items.filter((ev) => norm(ev.summary).includes(n) || norm(ev.description).includes(n));
  }
  if (inicio) {
    const w = wall(inicio);
    const dia = w.slice(0, 10);
    const tieneHora = w.length > 10 && w.slice(11) !== '00:00:00';
    items = items.filter((ev) => {
      const s = ev.start && (ev.start.dateTime || ev.start.date);
      if (!s) return false;
      const sw = wall(s);
      if (sw.slice(0, 10) !== dia) return false; // mismo día
      if (tieneHora) return Math.abs(new Date(sw + 'Z').getTime() - new Date(w + 'Z').getTime()) < 90 * 60000; // ±90 min
      return true;
    });
  }

  const borrados = [];
  for (const ev of items) {
    await cal.events.delete({ calendarId: conf.calendarId, eventId: ev.id });
    borrados.push({ titulo: ev.summary || '(sin título)', inicio: ev.start && (ev.start.dateTime || ev.start.date) });
  }
  return borrados;
}

// Prueba la conexión (devuelve el nombre del calendario)
async function probar() {
  const cal = await cliente();
  const r = await cal.calendars.get({ calendarId: conf.calendarId });
  return { ok: true, nombre: r.data.summary, zona: r.data.timeZone };
}

module.exports = { configurar, disponible, crearEvento, listarEventos, borrarEvento, cancelarCita, probar, get conf() { return conf; } };
