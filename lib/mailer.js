// ============================================================
//  Envío de correos por SMTP (nodemailer).
//  Lo usa el bot (desde el chat) y las confirmaciones de citas.
// ============================================================

const nodemailer = require('nodemailer');

let transporter = null;
let conf = {
  host: '',
  port: 587,
  secure: false, // true = SSL (465), false = STARTTLS (587)
  user: '',
  pass: '',
  from: '', // remitente, ej. "Pronetsys <correo@pronetsys.com>"
};

// Configura el módulo (al arrancar y cuando cambian los ajustes)
function configurar(opciones) {
  conf = { ...conf, ...opciones };
  transporter = null; // forzar recreación con la nueva config
}

// ¿Está listo para usarse? (hay host, usuario y clave)
function disponible() {
  return !!(conf.host && conf.user && conf.pass);
}

function cliente() {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: conf.host,
    port: Number(conf.port) || 587,
    secure: !!conf.secure,
    auth: { user: conf.user, pass: conf.pass },
  });
  return transporter;
}

// Envía un correo. { to, subject, text, html, cc }
async function enviar({ to, subject, text, html, cc }) {
  if (!disponible()) throw new Error('SMTP no configurado (faltan host/usuario/clave)');
  const from = conf.from || conf.user;
  // envelope.from fuerza un Return-Path válido (necesario para que SPF valide).
  // Usamos la cuenta autenticada como remitente del "sobre".
  const info = await cliente().sendMail({
    from,
    to,
    cc,
    subject,
    text,
    html: html || undefined,
    envelope: { from: conf.user || from, to, cc },
  });
  return { id: info.messageId, aceptados: info.accepted, rechazados: info.rejected, respuesta: info.response };
}

// Verifica la conexión al servidor SMTP
async function probar() {
  if (!disponible()) throw new Error('SMTP no configurado (faltan host/usuario/clave)');
  await cliente().verify();
  return { ok: true, from: conf.from || conf.user };
}

module.exports = { configurar, disponible, enviar, probar, get conf() { return conf; } };
