#!/usr/bin/env node
/* ============================================================
 *  PARCHE AUTOMÁTICO: agregar endpoint "typing" (escribiendo…)
 *  a openwa-api (whatsapp-web.js: sendStateTyping / clearState)
 *
 *  Crea el endpoint:  POST /api/sessions/:sessionId/messages/typing
 *      body: { "chatId": "...", "state": true|false }
 *
 *  USO:
 *    node apply-typing-patch.js /ruta/a/openwa-api
 *    node apply-typing-patch.js /ruta/a/openwa-api --dry
 * ============================================================ */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const root = args.find((a) => !a.startsWith('--')) || process.cwd();
const MARK = 'PATCH:typing';

const C = { g: '\x1b[32m', y: '\x1b[33m', r: '\x1b[31m', c: '\x1b[36m', x: '\x1b[0m', b: '\x1b[1m' };
const log = (s) => console.log(s);

log(`\n${C.b}== Parche "escribiendo…" (typing) para openwa-api ==${C.x}`);
log(`Carpeta del proyecto: ${C.c}${root}${C.x}`);
if (DRY) log(`${C.y}(modo previsualización: no se escribirá nada)${C.x}`);
log('');

function insertarAntes(src, anchor, lineas) {
  const idx = src.indexOf(anchor);
  if (idx === -1) return null;
  const inicioLinea = src.lastIndexOf('\n', idx) + 1;
  const indent = (src.slice(inicioLinea, idx).match(/^\s*/) || [''])[0];
  const bloque = lineas.map((l) => (l ? indent + l : '')).join('\n') + '\n';
  return src.slice(0, inicioLinea) + bloque + src.slice(inicioLinea);
}
function insertarDespues(src, anchor, texto) {
  const idx = src.indexOf(anchor);
  if (idx === -1) return null;
  return src.slice(0, idx + anchor.length) + texto + src.slice(idx + anchor.length);
}

let okCount = 0, failCount = 0;
function aplicar(rel, fn, descripcion) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) { log(`${C.r}❌ No existe:${C.x} ${rel}`); failCount++; return; }
  const original = fs.readFileSync(file, 'utf8');
  if (original.includes(MARK)) { log(`${C.y}⏭️  Ya estaba parcheado:${C.x} ${rel}`); okCount++; return; }
  const modificado = fn(original);
  if (modificado === null) {
    log(`${C.r}⚠️  No encontré dónde insertar en:${C.x} ${rel}\n   ${descripcion}`);
    failCount++; return;
  }
  if (DRY) { log(`${C.g}✓ (previsualización) se modificaría:${C.x} ${rel}`); okCount++; return; }
  fs.writeFileSync(file + '.bak-typing', original);
  fs.writeFileSync(file, modificado);
  log(`${C.g}✅ Parcheado:${C.x} ${rel}  ${C.c}(respaldo: ${rel}.bak-typing)${C.x}`);
  okCount++;
}

// ---- 1) Interfaz IWhatsAppEngine: declarar el método ----
aplicar(
  'src/engine/interfaces/whatsapp-engine.interface.ts',
  (src) => insertarDespues(
    src,
    'sendTextMessage(chatId: string, text: string): Promise<MessageResult>;',
    `\n  sendTyping(chatId: string, state: boolean): Promise<void>; /* ${MARK} */`
  ),
  'Ancla: "sendTextMessage(chatId: string, text: string): Promise<MessageResult>;"'
);

// ---- 2) Adaptador whatsapp-web.js: implementar sendTyping ----
aplicar(
  'src/engine/adapters/whatsapp-web-js.adapter.ts',
  (src) => insertarAntes(src, 'async sendTextMessage(chatId: string, text: string): Promise<MessageResult> {', [
    `/* ${MARK} */`,
    'async sendTyping(chatId: string, state: boolean): Promise<void> {',
    '  this.ensureReady();',
    '  const chat = await this.client!.getChatById(chatId);',
    '  if (state) await chat.sendStateTyping();',
    '  else await chat.clearState();',
    '}',
    '',
  ]),
  'Ancla: "async sendTextMessage(chatId: string, text: string): Promise<MessageResult> {"'
);

// ---- 3) Servicio: método sendTyping ----
aplicar(
  'src/modules/message/message.service.ts',
  (src) => insertarAntes(src, 'async sendText(sessionId: string, dto: SendTextMessageDto): Promise<MessageResponseDto> {', [
    `/* ${MARK} */`,
    'async sendTyping(sessionId: string, chatId: string, state: boolean): Promise<void> {',
    '  const engine = this.getEngine(sessionId);',
    '  await engine.sendTyping(chatId, state);',
    '}',
    '',
  ]),
  'Ancla: "async sendText(sessionId: string, dto: SendTextMessageDto): Promise<MessageResponseDto> {"'
);

// ---- 4) Controlador: endpoint POST typing ----
aplicar(
  'src/modules/message/message.controller.ts',
  (src) => insertarAntes(src, "@Post('send-text')", [
    `/* ${MARK} */`,
    "@Post('typing')",
    '@RequireRole(ApiKeyRole.OPERATOR)',
    "async sendTyping(@Param('sessionId') sessionId: string, @Body() body: { chatId: string; state?: boolean }): Promise<{ ok: boolean }> {",
    '  await this.messageService.sendTyping(sessionId, body.chatId, body.state !== false);',
    '  return { ok: true };',
    '}',
    '',
  ]),
  'Ancla: "@Post(\'send-text\')"'
);

log('');
log(`${C.b}Resumen:${C.x} ${C.g}${okCount} ok${C.x}, ${failCount ? C.r : ''}${failCount} con aviso${C.x}`);
if (!DRY && okCount > 0) {
  log(`\n${C.b}Siguientes pasos:${C.x}`);
  log('  1) cd a la carpeta del proyecto');
  log('  2) docker compose up -d --build   (recompila y reinicia)');
  log('  3) Avísale a tu asistente para activar el "escribiendo…" en el chatbot.');
}
log('');
if (failCount > 0) process.exitCode = 1;
