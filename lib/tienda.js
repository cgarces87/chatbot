// ============================================================
//  Integración con la tienda virtual (store.pronetsys.com.co)
//  - Búsqueda:  GET /api/buscar?q=<término>
//      -> { total, todos, items:[{ nombre, url, precio, img }] }   (YA EXISTE)
//  - Detalle:   GET /api/producto/<slug>
//      -> JSON con el detalle del producto (ver docs/api-tienda-spec.md).
//        Lo desarrolla el equipo de la tienda; mientras no exista, devuelve 404
//        y el bot degrada con elegancia (comparte el enlace, no inventa).
//  Regla de oro: el bot SOLO da información que devuelva la tienda; nunca inventa
//  productos, precios, especificaciones ni disponibilidad.
// ============================================================

let conf = { url: '' };

function configurar(opciones) { conf = { ...conf, ...opciones }; }
function disponible() { return !!conf.url; }
function base() { return (conf.url || '').replace(/\/+$/, ''); }

// Extrae el slug de una URL de producto (…/producto/<slug>) o lo deja tal cual
function slugDeUrl(u) {
  if (!u) return '';
  const m = String(u).match(/\/producto\/([^/?#]+)/i);
  return m ? m[1] : String(u).replace(/^\/+|\/+$/g, '');
}

// fetch con timeout (la tienda es externa; no bloquear la conversación)
async function pedir(path, ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(base() + path, { headers: { Accept: 'application/json' }, signal: ctrl.signal });
  } finally { clearTimeout(t); }
}

// Busca productos por palabra clave. -> { total, items:[{nombre,url,precio,img}] }
async function buscar(q, limite = 6) {
  const r = await pedir('/api/buscar?q=' + encodeURIComponent(q));
  if (!r.ok) throw new Error('tienda buscar: HTTP ' + r.status);
  const d = await r.json().catch(() => null);
  const items = (d && Array.isArray(d.items)) ? d.items : [];
  return { total: (d && d.total != null) ? d.total : items.length, items: items.slice(0, limite) };
}

// Detalle de UN producto por url/slug. Si el endpoint aún no existe -> { noDisponible:true }.
async function detalle(slugOrUrl) {
  const slug = slugDeUrl(slugOrUrl);
  if (!slug) return { noDisponible: true };
  const r = await pedir('/api/producto/' + encodeURIComponent(slug));
  if (r.status === 404) return { noDisponible: true, slug };
  if (!r.ok) throw new Error('tienda detalle: HTTP ' + r.status);
  const d = await r.json().catch(() => null);
  if (!d || typeof d !== 'object') return { noDisponible: true, slug };
  return d;
}

module.exports = {
  configurar, disponible, buscar, detalle, slugDeUrl,
  get conf() { return conf; },
};
