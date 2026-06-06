// ============================================================
//  Motor de FLUJO CONVERSACIONAL (menús con opciones)
//  Lee/guarda flow.json y resuelve la navegación del usuario.
//
//  Tipos de nodo:
//   - "menu": muestra un mensaje + opciones; espera que el usuario elija.
//   - "ai":   chat libre con OpenAI (opcional systemAddon para especializar).
// ============================================================

const fs = require('fs');
const path = require('path');

const FLOW_PATH = path.resolve(process.env.FLOW_FILE || 'flow.json');

const POR_DEFECTO = {
  start: 'main',
  triggers: ['menu', 'menú', 'inicio', 'volver'],
  nodes: {
    main: {
      type: 'menu',
      message: '¡Hola! 👋 ¿En qué te ayudo?',
      options: [{ key: '1', label: 'Hablar con la IA', next: 'ia' }],
    },
    ia: { type: 'ai', message: '🤖 Pregúntame lo que quieras. (Escribe *menú* para volver)', systemAddon: '' },
  },
};

let cache = null;

function cargar() {
  try {
    if (fs.existsSync(FLOW_PATH)) {
      cache = JSON.parse(fs.readFileSync(FLOW_PATH, 'utf8'));
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
  validar(obj);
  fs.writeFileSync(FLOW_PATH, JSON.stringify(obj, null, 2));
  cache = obj;
}

function validar(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('El flujo debe ser un objeto');
  if (!obj.nodes || typeof obj.nodes !== 'object') throw new Error('Falta "nodes"');
  if (!obj.start || !obj.nodes[obj.start]) throw new Error('El nodo inicial (start) no existe');
  for (const [id, n] of Object.entries(obj.nodes)) {
    if (!n.type || !['menu', 'ai'].includes(n.type)) throw new Error(`Nodo "${id}": type debe ser menu o ai`);
    if (n.type === 'menu') {
      for (const o of n.options || []) {
        if (!o.next || !obj.nodes[o.next]) throw new Error(`Opción "${o.label}" del nodo "${id}" apunta a un nodo inexistente: ${o.next}`);
      }
    }
  }
}

function nodo(id) { return obtener().nodes[id] || null; }

function esTrigger(texto) {
  const t = (texto || '').trim().toLowerCase();
  return (obtener().triggers || ['menu']).map((x) => x.toLowerCase()).includes(t);
}

const EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

function renderMenu(n) {
  let txt = n.message || '';
  (n.options || []).forEach((o, i) => { txt += `\n${EMOJIS[i] || (i + 1) + '.'} ${o.label}`; });
  txt += '\n\n_Responde con el número de la opción._';
  return txt;
}

// Empareja la entrada del usuario con una opción (por número, key o texto)
function matchOpcion(n, input) {
  const t = (input || '').trim().toLowerCase();
  const opts = n.options || [];
  let o = opts.find((o) => String(o.key).toLowerCase() === t);
  if (o) return o;
  const num = parseInt(t, 10);
  if (!isNaN(num) && num >= 1 && num <= opts.length) return opts[num - 1];
  o = opts.find((o) => (o.label || '').toLowerCase() === t);
  if (o) return o;
  o = opts.find((o) => t && ((o.label || '').toLowerCase().includes(t) || t.includes((o.label || '').toLowerCase())));
  return o || null;
}

module.exports = { FLOW_PATH, cargar, obtener, guardar, validar, nodo, esTrigger, renderMenu, matchOpcion };
