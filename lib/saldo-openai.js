// ============================================================
//  Monitor de saldo de OpenAI con alertas (correo + WhatsApp).
//
//  OpenAI ya NO expone el saldo restante por API (los endpoints de
//  billing exigen "session key" del navegador). Lo que SÍ se puede leer,
//  con una ADMIN key, es el GASTO acumulado (API de costos). Por eso:
//
//     saldo restante ≈ SALDO_ANCLA_USD − (gasto desde SALDO_ANCLA_FECHA)
//
//  Dos niveles de alerta:
//   🟡 bajo    : saldo restante <= umbral (por defecto 1.5 USD)
//   🔴 agotado : saldo <= 0  o  la API responde insufficient_quota
//
//  Se evita el spam: cada nivel se avisa al entrar y, si persiste, se
//  re-avisa como mucho 1 vez al día. Al recargar (vuelve a 'ok') se
//  manda un aviso de recuperación y se re-arma.
// ============================================================

const fs = require('fs');
const path = require('path');

let cfg = {};
let deps = {};
let timer = null;
const ESTADO_FILE = path.resolve(process.env.MONITOR_SALDO_FILE || 'data/saldo-estado.json');

function configurar(opciones = {}, dependencias = {}) {
  cfg = {
    adminKey: process.env.OPENAI_ADMIN_KEY || '',
    apiKey: process.env.OPENAI_API_KEY || '',
    anclaUsd: parseFloat(process.env.SALDO_ANCLA_USD || '0') || 0,
    anclaFecha: (process.env.SALDO_ANCLA_FECHA || '').slice(0, 10), // YYYY-MM-DD
    umbral: parseFloat(process.env.ALERTA_SALDO_UMBRAL || '1.5') || 1.5,
    email: process.env.ALERTA_SALDO_EMAIL || 'soporte@pronetsys.com.co',
    whatsapp: (process.env.ALERTA_SALDO_WHATSAPP || '573014665399').replace(/\D/g, ''),
    intervaloMin: parseInt(process.env.MONITOR_SALDO_INTERVALO_MIN || '60', 10) || 60,
    ...opciones,
  };
  deps = dependencias; // { enviarCorreo, correoDisponible, enviarWhatsApp }
}

function leerEstado() {
  try { return JSON.parse(fs.readFileSync(ESTADO_FILE, 'utf8')); }
  catch { return { nivel: 'ok', ultimaAlerta: 0, remaining: null }; }
}
function guardarEstado(e) {
  try { fs.mkdirSync(path.dirname(ESTADO_FILE), { recursive: true }); fs.writeFileSync(ESTADO_FILE, JSON.stringify(e)); }
  catch (err) { console.warn('💳 No se pudo guardar estado de saldo:', err.message); }
}

// Gasto (USD) desde la fecha ancla, vía API de costos (requiere ADMIN key).
// Devuelve null si no se puede consultar (sin admin key o error).
async function gastoDesdeAncla() {
  if (!cfg.adminKey || !cfg.anclaFecha) return null;
  const start = Math.floor(new Date(cfg.anclaFecha + 'T00:00:00Z').getTime() / 1000);
  if (!start || isNaN(start)) return null;
  try {
    const r = await fetch(`https://api.openai.com/v1/organization/costs?start_time=${start}&bucket_width=1d&limit=180`,
      { headers: { Authorization: 'Bearer ' + cfg.adminKey } });
    if (!r.ok) { console.warn('💳 API de costos respondió', r.status, (await r.text()).slice(0, 120)); return null; }
    const j = await r.json();
    let gasto = 0;
    for (const b of (j.data || [])) for (const res of (b.results || [])) {
      const v = res && res.amount && typeof res.amount.value === 'number' ? res.amount.value : 0;
      gasto += v;
    }
    return gasto;
  } catch (e) { console.warn('💳 Error consultando costos:', e.message); return null; }
}

// ¿La API está agotada? (prueba de 1 token). Devuelve true/false/null(indeterminado).
async function estaAgotada() {
  if (!cfg.apiKey) return null;
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + cfg.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-4o-mini', messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }),
    });
    if (r.ok) return false;
    const t = await r.text();
    if (r.status === 429 && /insufficient_quota|credit|quota/i.test(t)) return true;
    return null; // otro error (rate limit normal, 401, etc.): no concluir agotado
  } catch { return null; }
}

function usd(n) { return '$' + (Number(n) || 0).toFixed(2); }

async function avisar(nivel, remaining, gasto) {
  const esAgotado = nivel === 'agotado';
  const titulo = esAgotado ? '🔴 OpenAI SIN SALDO — el chatbot no responde' : '🟡 OpenAI: saldo bajo';
  const detalle = [
    esAgotado
      ? 'El saldo de OpenAI se AGOTÓ. El chatbot solo manda el saludo y NO puede responder preguntas hasta recargar.'
      : `Queda poco saldo de OpenAI: aproximadamente ${usd(remaining)} (umbral de aviso: ${usd(cfg.umbral)}).`,
    gasto != null ? `Gasto desde la última recarga (${cfg.anclaFecha}): ${usd(gasto)} de un saldo de ${usd(cfg.anclaUsd)}.` : '',
    '',
    'Recarga en: https://platform.openai.com/settings/organization/billing',
    'Tras recargar, actualiza el "saldo actual" en el panel del bot (Monitor de saldo) para re-armar el aviso.',
  ].filter(Boolean).join('\n');

  // Correo
  if (deps.correoDisponible && deps.correoDisponible() && deps.enviarCorreo) {
    try { await deps.enviarCorreo({ to: cfg.email, subject: titulo, text: detalle }); console.log('💳 Alerta de saldo enviada por correo a', cfg.email); }
    catch (e) { console.warn('💳 No se pudo enviar correo de alerta:', e.message); }
  }
  // WhatsApp
  if (deps.enviarWhatsApp && cfg.whatsapp) {
    try { await deps.enviarWhatsApp(cfg.whatsapp + '@c.us', `*${titulo}*\n\n${detalle}`); console.log('💳 Alerta de saldo enviada por WhatsApp a', cfg.whatsapp); }
    catch (e) { console.warn('💳 No se pudo enviar WhatsApp de alerta:', e.message); }
  }
}

async function revisar() {
  try {
    configurar({}, deps); // releer env en vivo (ancla/umbral/keys editables desde el panel)
    const gasto = await gastoDesdeAncla();
    let remaining = (gasto != null && cfg.anclaUsd) ? (cfg.anclaUsd - gasto) : null;

    const agotada = await estaAgotada();
    if (agotada === true) remaining = remaining != null ? Math.min(remaining, 0) : 0;

    // Determinar nivel
    let nivel = 'ok';
    if (agotada === true || (remaining != null && remaining <= 0)) nivel = 'agotado';
    else if (remaining != null && remaining <= cfg.umbral) nivel = 'bajo';

    const est = leerEstado();
    const ahora = Date.now();
    const peor = { ok: 0, bajo: 1, agotado: 2 };
    const empeora = peor[nivel] > peor[est.nivel || 'ok'];
    const reNag = nivel !== 'ok' && (ahora - (est.ultimaAlerta || 0) > 24 * 3600 * 1000);

    if (nivel !== 'ok' && (empeora || reNag)) {
      await avisar(nivel, remaining, gasto);
      guardarEstado({ nivel, ultimaAlerta: ahora, remaining });
    } else if (nivel === 'ok' && est.nivel && est.nivel !== 'ok') {
      // Se recuperó (recargaron): avisar una vez y re-armar
      if (deps.enviarWhatsApp && cfg.whatsapp) {
        try { await deps.enviarWhatsApp(cfg.whatsapp + '@c.us', `✅ *OpenAI recargado.* Saldo estimado: ${remaining != null ? usd(remaining) : 'OK'}. El chatbot vuelve a responder con normalidad.`); } catch {}
      }
      guardarEstado({ nivel: 'ok', ultimaAlerta: 0, remaining });
    } else {
      guardarEstado({ nivel, ultimaAlerta: est.ultimaAlerta || 0, remaining });
    }

    console.log(`💳 Saldo OpenAI: nivel=${nivel}${remaining != null ? ' ~' + usd(remaining) : ' (sin Admin key: solo detecto agotado)'}${gasto != null ? ' · gasto ' + usd(gasto) : ''}`);
    return { nivel, remaining, gasto };
  } catch (e) {
    console.warn('💳 Error en revisión de saldo:', e.message);
    return null;
  }
}

function iniciar(dependencias = {}) {
  configurar({}, { ...deps, ...dependencias });
  if (timer) clearInterval(timer);
  const ms = Math.max(5, cfg.intervaloMin) * 60 * 1000;
  timer = setInterval(() => revisar(), ms);
  if (timer.unref) timer.unref();
  const modo = cfg.adminKey ? `completo (umbral ${usd(cfg.umbral)} + agotado)` : 'solo "agotado" (falta OPENAI_ADMIN_KEY para el aviso de ' + usd(cfg.umbral) + ')';
  console.log(`💳 Monitor de saldo OpenAI activo: ${modo}, cada ${cfg.intervaloMin} min → correo ${cfg.email} / WhatsApp ${cfg.whatsapp}`);
  setTimeout(() => revisar(), 20000); // primera revisión a los 20s
}

module.exports = { configurar, iniciar, revisar };
