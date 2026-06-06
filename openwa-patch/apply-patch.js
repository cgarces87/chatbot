#!/usr/bin/env node
/* ============================================================
 *  PARCHE AUTOMÁTICO: habilitar el evento "message.sent"
 *  en openwa-api (rmyndharis/OpenWA, basado en whatsapp-web.js)
 *
 *  USO:
 *    node apply-patch.js /ruta/a/openwa-api
 *    node apply-patch.js /ruta/a/openwa-api --dry   (solo previsualiza)
 *
 *  - Crea respaldos .bak de cada archivo modificado.
 *  - Es idempotente: si ya está aplicado, no lo repite.
 * ============================================================ */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const root = (args.find((a) => !a.startsWith('--'))) || process.cwd();
const MARK = 'PATCH:message.sent';

const C = { g: '\x1b[32m', y: '\x1b[33m', r: '\x1b[31m', c: '\x1b[36m', x: '\x1b[0m', b: '\x1b[1m' };
const log = (s) => console.log(s);

log(`\n${C.b}== Parche message.sent para openwa-api ==${C.x}`);
log(`Carpeta del proyecto: ${C.c}${root}${C.x}`);
if (DRY) log(`${C.y}(modo previsualización: no se escribirá nada)${C.x}`);
log('');

// Inserta un bloque de líneas justo ANTES de la línea que contiene "anchor",
// respetando la indentación de esa línea.
function insertarAntes(src, anchor, lineas) {
  const idx = src.indexOf(anchor);
  if (idx === -1) return null;
  const inicioLinea = src.lastIndexOf('\n', idx) + 1;
  const indent = (src.slice(inicioLinea, idx).match(/^\s*/) || [''])[0];
  const bloque = lineas.map((l) => (l ? indent + l : '')).join('\n') + '\n';
  return src.slice(0, inicioLinea) + bloque + src.slice(inicioLinea);
}

// Inserta un texto justo DESPUÉS del anchor (en la misma línea)
function insertarDespues(src, anchor, texto) {
  const idx = src.indexOf(anchor);
  if (idx === -1) return null;
  const fin = idx + anchor.length;
  return src.slice(0, fin) + texto + src.slice(fin);
}

let okCount = 0, failCount = 0;

function aplicar(rel, fn, descripcion) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) {
    log(`${C.r}❌ No existe:${C.x} ${rel}\n   Revisa la ruta del proyecto.`);
    failCount++;
    return;
  }
  const original = fs.readFileSync(file, 'utf8');
  if (original.includes(MARK)) {
    log(`${C.y}⏭️  Ya estaba parcheado:${C.x} ${rel}`);
    okCount++;
    return;
  }
  const modificado = fn(original);
  if (modificado === null) {
    log(`${C.r}⚠️  No encontré dónde insertar en:${C.x} ${rel}`);
    log(`   ${descripcion}`);
    log(`   → Tendrás que aplicar ese cambio a mano (ver README.md).`);
    failCount++;
    return;
  }
  if (DRY) {
    log(`${C.g}✓ (previsualización) se modificaría:${C.x} ${rel}`);
  } else {
    fs.writeFileSync(file + '.bak', original);
    fs.writeFileSync(file, modificado);
    log(`${C.g}✅ Parcheado:${C.x} ${rel}  ${C.c}(respaldo: ${rel}.bak)${C.x}`);
  }
  okCount++;
}

// ---- 1) Interfaz de callbacks ----
aplicar(
  'src/engine/interfaces/whatsapp-engine.interface.ts',
  (src) => insertarDespues(
    src,
    'onMessage?: (message: IncomingMessage) => void;',
    `\n  onOutgoingMessage?: (message: IncomingMessage) => void; /* ${MARK} */`
  ),
  'Ancla esperada: "onMessage?: (message: IncomingMessage) => void;"'
);

// ---- 2) Adaptador whatsapp-web.js: listener message_create ----
aplicar(
  'src/engine/adapters/whatsapp-web-js.adapter.ts',
  (src) => insertarAntes(src, "this.client.on('message',", [
    `/* ${MARK} */`,
    "this.client.on('message_create', async (msg) => {",
    '  if (!msg.fromMe) return; // solo salientes (este evento también dispara entrantes)',
    '  try {',
    '    const outgoingMessage = {',
    '      id: msg.id._serialized,',
    '      from: msg.from,',
    '      to: msg.to,',
    '      chatId: msg.to,',
    '      body: msg.body,',
    '      type: msg.type,',
    '      timestamp: msg.timestamp,',
    '      fromMe: true,',
    "      isGroup: (msg.to || '').endsWith('@g.us'),",
    '    };',
    '    this.callbacks.onOutgoingMessage?.(outgoingMessage);',
    '  } catch (err) {',
    '    /* noop */',
    '  }',
    '});',
    '',
  ]),
  'Ancla esperada: "this.client.on(\'message\',"'
);

// ---- 3) session.service: emitir webhook message.sent ----
aplicar(
  'src/modules/session/session.service.ts',
  (src) => insertarAntes(src, 'onMessage: (message): void => {', [
    `onOutgoingMessage: (message): void => { /* ${MARK} */`,
    '  void this.sessionRepository.update(id, { lastActiveAt: new Date() });',
    '  const messageData = { ...message };',
    "  void this.webhookService.dispatch(id, 'message.sent', messageData as Record<string, unknown>);",
    '  this.eventsGateway.emitMessage(id, messageData as Record<string, unknown>);',
    '},',
  ]),
  'Ancla esperada: "onMessage: (message): void => {"'
);

log('');
log(`${C.b}Resumen:${C.x} ${C.g}${okCount} ok${C.x}, ${failCount ? C.r : ''}${failCount} con aviso${C.x}`);
if (!DRY && okCount > 0) {
  log('');
  log(`${C.b}Siguientes pasos:${C.x}`);
  log('  1) Recompila el proyecto:   npm run build');
  log('  2) Reinicia el servicio:    pm2 restart all   (o reinicia tu contenedor Docker)');
  log('  3) Avísale a tu asistente para terminar el handoff en el chatbot.');
}
log('');
if (failCount > 0) process.exitCode = 1;
