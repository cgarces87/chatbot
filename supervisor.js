// ============================================================
//  SUPERVISOR: ejecuta el bot y lo REINICIA automáticamente
//  cuando se pide un reinicio desde el panel.
//
//  - Si el bot termina con código 75 -> lo vuelve a arrancar.
//  - Si termina normal (0) o con Ctrl+C -> el supervisor también termina.
// ============================================================

const { spawn } = require('child_process');
const path = require('path');

let child = null;
let parando = false;

function arrancar() {
  child = spawn(process.execPath, [path.join(__dirname, 'index.js')], { stdio: 'inherit' });
  child.on('exit', (code) => {
    if (parando) return;
    if (code === 75) {
      console.log('\n♻️  Reiniciando el bot...\n');
      setTimeout(arrancar, 800); // pequeña pausa para liberar el puerto/tunel
    } else {
      process.exit(code || 0);
    }
  });
}

function parar() {
  parando = true;
  if (child) try { child.kill(); } catch {}
  process.exit(0);
}
process.on('SIGINT', parar);
process.on('SIGTERM', parar);

console.log('🛡️  Supervisor activo (reinicios automáticos habilitados)');
arrancar();
