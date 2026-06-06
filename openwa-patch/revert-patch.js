#!/usr/bin/env node
/* ============================================================
 *  REVERTIR el parche message.sent: restaura los archivos .bak
 *  USO:  node revert-patch.js /ruta/a/openwa-api
 * ============================================================ */

const fs = require('fs');
const path = require('path');

const root = process.argv.slice(2).find((a) => !a.startsWith('--')) || process.cwd();
const C = { g: '\x1b[32m', y: '\x1b[33m', r: '\x1b[31m', c: '\x1b[36m', x: '\x1b[0m', b: '\x1b[1m' };

const archivos = [
  'src/engine/interfaces/whatsapp-engine.interface.ts',
  'src/engine/adapters/whatsapp-web-js.adapter.ts',
  'src/modules/session/session.service.ts',
];

console.log(`\n${C.b}== Revertir parche message.sent ==${C.x}`);
console.log(`Carpeta: ${C.c}${root}${C.x}\n`);

let n = 0;
for (const rel of archivos) {
  const file = path.join(root, rel);
  const bak = file + '.bak';
  if (fs.existsSync(bak)) {
    fs.copyFileSync(bak, file);
    fs.unlinkSync(bak);
    console.log(`${C.g}↩️  Restaurado:${C.x} ${rel}`);
    n++;
  } else {
    console.log(`${C.y}—  Sin respaldo (no se tocó):${C.x} ${rel}`);
  }
}
console.log(`\n${C.b}${n} archivo(s) restaurado(s).${C.x}`);
console.log('Recuerda recompilar y reiniciar: npm run build && pm2 restart all\n');
