#!/usr/bin/env node
/* ============================================================
 *  Crea una NUEVA INSTANCIA del chatbot (Opción B: 1 por número)
 *
 *  USO:
 *    node crear-instancia.js <nombre> <puerto> [sessionId]
 *
 *  Ejemplo:
 *    node crear-instancia.js caprichitos 3001 82b6e83a-...-308ed
 *
 *  - Copia el proyecto a ../chatbot-<nombre> (incluye node_modules,
 *    así no hay que reinstalar).
 *  - Genera su .env con PORT y PG_DATABASE propios (memoria separada).
 *  - No copia la memoria (data/) ni el .env original.
 * ============================================================ */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const [nombre, puerto, sessionId] = process.argv.slice(2);
if (!nombre || !puerto) {
  console.error('Uso: node crear-instancia.js <nombre> <puerto> [sessionId]');
  process.exit(1);
}
if (!/^[a-z0-9_]+$/i.test(nombre)) { console.error('El nombre solo puede tener letras, números y _'); process.exit(1); }

const origen = __dirname;
const destino = path.resolve(origen, '..', 'chatbot-' + nombre);
if (fs.existsSync(destino)) { console.error('❌ Ya existe la carpeta:', destino); process.exit(1); }

console.log('📁 Creando instancia en:', destino);
fs.mkdirSync(destino, { recursive: true });

// Copia rápida de carpetas (robocopy en Windows, cpSync en otros)
function copiarDir(src, dest) {
  if (!fs.existsSync(src)) return;
  if (process.platform === 'win32') {
    try {
      execSync(`robocopy "${src}" "${dest}" /E /NFL /NDL /NJH /NJS /NP /MT:16`, { stdio: 'ignore' });
    } catch (e) {
      if ((e.status || 0) >= 8) throw e; // robocopy: 0-7 = éxito
    }
  } else {
    fs.cpSync(src, dest, { recursive: true });
  }
}

// Carpetas a copiar
for (const dir of ['lib', 'public', 'node_modules', 'openwa-patch']) {
  process.stdout.write('  copiando ' + dir + '… ');
  copiarDir(path.join(origen, dir), path.join(destino, dir));
  console.log('ok');
}
// Archivos sueltos a copiar
for (const f of ['index.js', 'supervisor.js', 'package.json', 'package-lock.json', 'flow.json', '.gitignore', 'README.md']) {
  const s = path.join(origen, f);
  if (fs.existsSync(s)) fs.copyFileSync(s, path.join(destino, f));
}
console.log('  archivos copiados');

// Generar el .env de la nueva instancia a partir del actual
function setVar(env, key, val) {
  const re = new RegExp('^' + key + '=.*$', 'm');
  return re.test(env) ? env.replace(re, key + '=' + val) : env + '\n' + key + '=' + val;
}
let env = fs.readFileSync(path.join(origen, '.env'), 'utf8');
env = setVar(env, 'PORT', puerto);
env = setVar(env, 'PG_DATABASE', 'chatbot_' + nombre.toLowerCase());
env = setVar(env, 'BOT_PAUSED', 'false');
if (sessionId) env = setVar(env, 'OPENWA_SESSION_ID', sessionId);
fs.writeFileSync(path.join(destino, '.env'), env);
console.log('  .env generado → PORT=' + puerto + ', PG_DATABASE=chatbot_' + nombre.toLowerCase());

console.log('\n✅ Instancia "' + nombre + '" creada.');
console.log('\nPara arrancarla:');
console.log('   cd ..\\chatbot-' + nombre);
console.log('   npm start');
console.log('\nLuego abre el panel:  http://localhost:' + puerto + '/admin');
console.log('(Si no pusiste sessionId, elige el número en el panel → Conexiones → Sesión de WhatsApp)');
