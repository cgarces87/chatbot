// ============================================================
//  Motor de FLUJO CONVERSACIONAL (editor visual / nodos)
//  Lee/guarda flow.json y resuelve la navegación del usuario.
//
//  Tipos de nodo:
//   - "inicio":    punto de entrada; avanza a "next".
//   - "mensaje":   envía un texto y avanza a "next" (encadenable).
//   - "menu":      muestra mensaje + opciones; rama según la elección.
//   - "condicion": rama según palabras clave que escriba el usuario.
//   - "ia":        chat libre con OpenAI (systemAddon opcional).
//   - "accion":    ejecuta una acción simple (enviar QR, pasar a asesor…).
//   - "fin":       termina (vuelve al inicio en el próximo mensaje).
// ============================================================

const fs = require('fs');
const path = require('path');

const FLOW_PATH = path.resolve(process.env.FLOW_FILE || 'flow.json');

// Tipos que ESPERAN entrada del usuario (el flujo se detiene en ellos)
const TIPOS_ESPERA = ['menu', 'condicion', 'ia', 'fin'];
// Tipos que se procesan y AVANZAN solos a "next"
const TIPOS_AVANCE = ['inicio', 'mensaje', 'accion'];
const TIPOS = [...TIPOS_ESPERA, ...TIPOS_AVANCE];

const POR_DEFECTO = {
  start: 'inicio',
  triggers: ['menu', 'menú', 'inicio', 'volver'],
  nodes: {
    inicio: { type: 'inicio', next: 'bienvenida' },
    bienvenida: { type: 'mensaje', message: '¡Hola! Bienvenido a Pronetsys.', next: 'menu_main' },
    menu_main: {
      type: 'menu',
      message: '¿En qué le podemos ayudar?',
      options: [{ label: 'Hablar con un asesor virtual', next: 'ia' }],
    },
    ia: { type: 'ia', message: 'Cuénteme en qué le ayudo. (Escriba *menú* para volver)', systemAddon: '' },
  },
};

let cache = null;

function cargar() {
  try {
    if (fs.existsSync(FLOW_PATH)) {
      cache = migrar(JSON.parse(fs.readFileSync(FLOW_PATH, 'utf8')));
      validar(cache);
    } else {
      cache = POR_DEFECTO;
      guardar(cache);
    }
  } catch (e) {
    console.warn('⚠️  flow.json inválido, usando flujo por defecto:', e.message);
    cache = POR_DEFECTO;
  }
  return cache;
}

function obtener() { return cache || cargar(); }

function guardar(obj) {
  const limpio = migrar(obj);
  validar(limpio);
  fs.writeFileSync(FLOW_PATH, JSON.stringify(limpio, null, 2));
  cache = limpio;
  return limpio;
}

// Compatibilidad: el formato viejo solo tenía menu/ai. Se acepta tal cual.
function migrar(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (!obj.triggers) obj.triggers = ['menu', 'menú', 'inicio', 'volver'];
  // El formato viejo usaba "ai"; ahora es "ia".
  for (const n of Object.values(obj.nodes || {})) { if (n && n.type === 'ai') n.type = 'ia'; }
  return obj;
}

function validar(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('El flujo debe ser un objeto');
  if (!obj.nodes || typeof obj.nodes !== 'object') throw new Error('Falta "nodes"');
  if (!obj.start || !obj.nodes[obj.start]) throw new Error('El nodo inicial (start) no existe');
  for (const [id, n] of Object.entries(obj.nodes)) {
    if (!n.type || !TIPOS.includes(n.type)) throw new Error(`Nodo "${id}": type inválido (${n.type})`);
    const checkNext = (next, ctx) => { if (next && !obj.nodes[next]) throw new Error(`${ctx} apunta a un nodo inexistente: ${next}`); };
    if (n.type === 'menu' || n.type === 'condicion') {
      for (const o of n.options || []) checkNext(o.next, `Opción "${o.label || o.patrones || ''}" del nodo "${id}"`);
      checkNext(n.elseNext, `"si no coincide" del nodo "${id}"`);
    } else {
      checkNext(n.next, `El nodo "${id}"`);
    }
  }
}

function nodo(id) { return obtener().nodes[id] || null; }
function esEspera(n) { return n && TIPOS_ESPERA.includes(n.type); }

function esTrigger(texto) {
  const t = (texto || '').trim().toLowerCase();
  return (obtener().triggers || ['menu']).map((x) => x.toLowerCase()).includes(t);
}

const EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

function renderMenu(n) {
  let txt = n.message || '';
  (n.options || []).forEach((o, i) => { txt += `\n${EMOJIS[i] || (i + 1) + '.'} ${o.label}`; });
  txt += '\n\n_Responda con el número de la opción._';
  return txt;
}

// Empareja la entrada del usuario con una opción de MENÚ (por número o texto)
function matchOpcion(n, input) {
  const t = (input || '').trim().toLowerCase();
  const opts = n.options || [];
  const num = parseInt(t, 10);
  if (!isNaN(num) && num >= 1 && num <= opts.length) return opts[num - 1];
  let o = opts.find((o) => (o.label || '').toLowerCase() === t);
  if (o) return o;
  o = opts.find((o) => t && ((o.label || '').toLowerCase().includes(t) || t.includes((o.label || '').toLowerCase())));
  return o || null;
}

// Empareja la entrada con una rama de CONDICIÓN (por palabras clave); si nada, elseNext
function matchCondicion(n, input) {
  const t = (input || '').trim().toLowerCase();
  for (const o of n.options || []) {
    const patrones = (o.patrones || o.label || '').toString().toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
    if (patrones.some((p) => t.includes(p))) return o.next;
  }
  return n.elseNext || null;
}

module.exports = {
  FLOW_PATH, TIPOS, cargar, obtener, guardar, validar, migrar,
  nodo, esEspera, esTrigger, renderMenu, matchOpcion, matchCondicion,
};
