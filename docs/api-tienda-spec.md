# Especificación — API de detalle de producto para la tienda

**Para:** equipo de desarrollo de `store.pronetsys.com.co`
**Objetivo:** que el chatbot de WhatsApp pueda leer las características de un producto directamente de la tienda (sin scrapear HTML y sin inventar datos).

El bot ya consume el buscador que ustedes tienen:

```
GET /api/buscar?q=<término>
→ { "total": 123, "items": [ { "nombre": "...", "url": "...", "precio": "$4.760", "img": "..." }, ... ] }
```

Falta **un solo endpoint nuevo**: el detalle de un producto en JSON. Es el mismo dato que ya renderiza la página `/producto/{slug}`, pero servido como JSON.

---

## Endpoint a desarrollar

```
GET /api/producto/{slug}
```

- `{slug}` es el identificador que ya aparece en `url` del buscador: en
  `https://store.pronetsys.com.co/producto/mouse-logitech-inalambrico-m170-blanco`
  el slug es `mouse-logitech-inalambrico-m170-blanco`.
- **Respuesta:** `200 OK` con `Content-Type: application/json; charset=utf-8`.
- **Si el producto no existe:** `404` (el bot lo maneja y comparte el enlace).
- **Sin autenticación** (igual que `/api/buscar`). Es solo lectura.
- Idealmente permitirlo en `robots.txt` o no — da igual para el bot (lo consume el servidor, no un crawler); pero **no** exponer stock exacto si no quieren (ver `disponibilidad`).

### Esquema JSON de la respuesta

```jsonc
{
  "nombre": "Celular Xiaomi Redmi A7 Pro (4GB/64GB) Azul",   // obligatorio
  "url": "https://store.pronetsys.com.co/producto/xiaomi-redmi-a7-pro-4gb-64gb", // obligatorio
  "precio": "$432.000",                 // obligatorio, STRING ya formateado en COP
  "iva": "Excluido de IVA (Art. 424 E.T.)", // texto tal como se muestra en la página; o "IVA incluido". Si no aplica, omitir o ""
  "sku": "6932554493479",               // opcional (EAN/SKU)
  "marca": "Xiaomi",                     // opcional
  "categoria": "Celulares y tabletas",   // opcional
  "disponibilidad": "Disponible",        // opcional: texto, NO cantidad exacta. Ej. "Disponible" / "Agotado" / "Bajo pedido"
  "descripcion": "Smartphone con pantalla de 6.9\"...", // opcional, texto plano (sin HTML)
  "caracteristicas": {                   // opcional: objeto clave→valor (preferido)
    "Procesador": "UNISOC T7250 de 12 nm, ocho núcleos",
    "RAM": "4 GB",
    "Almacenamiento": "64 GB",
    "Pantalla": "LCD 6.9\"",
    "Batería": "6000 mAh",
    "Cámara posterior": "13 MP",
    "Cámara frontal": "8 MP",
    "Sistema operativo": "HyperOS 3"
  },
  "garantia": "Garantía del fabricante; la tienda gestiona el proceso vía garantias@pronetsys.com.co" // opcional
}
```

Notas:
- **`precio` siempre como STRING ya formateado** (ej. `"$432.000"`), igual que en `/api/buscar`. El bot lo repite tal cual; no hace cálculos de IVA.
- **`iva`**: manden el texto literal que muestra la ficha ("IVA incluido" o "Excluido de IVA (Art. 424 E.T.)"). Es importante para que el bot no asuma el régimen.
- **`caracteristicas`** puede ser un objeto `{clave: valor}` (preferido) **o** un arreglo
  `[ { "nombre": "RAM", "valor": "4 GB" }, ... ]`; el bot acepta ambos.
- **`descripcion`/`caracteristicas` en texto plano**, sin etiquetas HTML.
- `disponibilidad` como texto, no número: no hace falta exponer el inventario exacto.

### Ejemplo de llamada

```
GET https://store.pronetsys.com.co/api/producto/xiaomi-redmi-a7-pro-4gb-64gb
Accept: application/json
→ 200  { ...el objeto de arriba... }
```

---

## Lado del bot (ya implementado)

- Nuevas herramientas: `buscar_en_tienda` (usa `/api/buscar`) y `ver_producto_tienda` (usa `/api/producto/{slug}`).
- Config: `ENABLE_TIENDA=true` y `STORE_URL=https://store.pronetsys.com.co` (panel → "Tienda virtual").
- **Mientras el endpoint no exista**, `ver_producto_tienda` recibe el 404 y el bot responde compartiendo el enlace del producto, sin inventar especificaciones. La **búsqueda con precios ya funciona hoy**.
- El bot tiene instrucción estricta de **no inventar** nada que no venga de la tienda y de repetir el precio (con su nota de IVA) tal cual.

Cuando desplieguen `GET /api/producto/{slug}`, no hay que tocar el bot: empieza a dar características automáticamente.
