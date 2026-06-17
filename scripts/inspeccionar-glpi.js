#!/usr/bin/env node
/* ============================================================
 *  Inspección de GLPI (diagnóstico, NO modifica nada).
 *  Muestra: conexión, entidad por NIT (y sus campos crudos para
 *  ver DÓNDE está el NIT), ubicaciones y tickets abiertos.
 *
 *  USO (dentro del contenedor):
 *    docker compose exec chatbot node scripts/inspeccionar-glpi.js <NIT>
 * ============================================================ */

try { require('dotenv').config(); } catch { /* el env ya puede venir del contenedor */ }
const glpi = require('../lib/glpi');

glpi.configurar({
  url: process.env.GLPI_URL || '',
  appToken: process.env.GLPI_APP_TOKEN || '',
  userToken: process.env.GLPI_USER_TOKEN || '',
});

const nit = process.argv[2];

(async () => {
  if (!glpi.disponible()) {
    console.log('❌ GLPI no está configurado (faltan URL/tokens en el .env). Configúralo en el panel primero.');
    return;
  }
  console.log('== 1) Conexión ==');
  console.log(JSON.stringify(await glpi.probar()));

  if (!nit) {
    console.log('\n⚠️  Pásame un NIT de prueba:  node scripts/inspeccionar-glpi.js <NIT>');
    return;
  }

  console.log('\n== 2) Buscar entidad por NIT:', nit, '==');
  const ent = await glpi.buscarEntidadPorNit(nit);
  if (!ent) {
    console.log('❌ No se encontró una entidad cuyo texto contenga ese NIT.');
    console.log('   (Revisa que el NIT esté escrito en algún campo de la entidad y que la cuenta del bot vea esa entidad.)');
    return;
  }
  console.log('✅ Entidad encontrada -> id:', ent.id, '| nombre:', ent.nombre);

  console.log('\n== 3) Campos de la entidad (para ver DÓNDE está el NIT) ==');
  const raw = await glpi.getEntidad(ent.id) || {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'string' && v.trim() && v.length < 300) console.log('   ' + k + ': ' + v.replace(/\s+/g, ' ').slice(0, 120));
  }

  console.log('\n== 4) Ubicaciones de la entidad ==');
  const ubis = await glpi.listarUbicaciones(ent.id);
  console.log(ubis.length ? JSON.stringify(ubis, null, 2) : '   (sin ubicaciones)');

  console.log('\n== 5) Tickets ABIERTOS de la entidad ==');
  const tickets = await glpi.listarTicketsAbiertos(ent.id);
  console.log(tickets.length ? JSON.stringify(tickets, null, 2) : '   (sin tickets abiertos)');
  if (tickets.length) {
    console.log('\n== 6) Último comentario del ticket #' + tickets[0].id + ' ==');
    console.log(JSON.stringify(await glpi.ultimoComentario(tickets[0].id)));
  }
  console.log('\n✅ Inspección lista.');
})().catch((e) => console.error('ERROR:', e.message));
