# Especificación — API de detalle de producto para la tienda

**Para:** equipo de desarrollo de `store.pronetsys.com.co`
**Objetivo:** que el chatbot de WhatsApp pueda leer las características de un producto directamente de la tienda (sin scrapear HTML y sin inventar datos).

El bot ya consume el buscador existente:

```
GET /api/buscar?q=<término>
→ { "total": 123, "items": [ { "nombre": "...", "url": "...", "precio": "$4.760", "img": "..." }, ... ] }
```

Falta **un solo endpoint nuevo**: el detalle de un producto en JSON (el mismo dato que ya renderiza la ficha `/producto/{slug}`, pero servido como JSON).

---

## Endpoint a desarrollar

```
GET /api/producto/{slug}
```

- **Método:** `GET`. **Slug:** el identificador que ya aparece en el campo `url` del buscador. En
  `https://store.pronetsys.com.co/producto/mouse-logitech-inalambrico-m170-blanco`
  el slug es `mouse-logitech-inalambrico-m170-blanco`.
- **Respuesta OK:** `200` con `Content-Type: application/json; charset=utf-8`.
- **Si el producto no existe:** `404` (idealmente con cuerpo `{ "error": "no encontrado" }`, pero el bot acepta cualquier 404 y entonces comparte el enlace sin inventar).
- **Autenticación:** ninguna, igual que `/api/buscar`. Es solo lectura.
- **CORS:** no hace falta. El bot llama **servidor a servidor** (Node `fetch` desde el backend del bot), no desde un navegador; no se necesitan cabeceras CORS.
- **Volumen / caché:** muy bajo (≈1–2 llamadas por conversación). Pueden cachear la respuesta unos minutos sin problema.
- **Nunca exponer el nombre del proveedor** (el bot no lo pide ni lo usa).

### Esquema JSON de la respuesta

Los nombres de campo están alineados con lo que la tienda ya maneja por producto. **Obligatorios:** `nombre`, `url`, `precio`. El resto son opcionales (si no hay dato, omitir el campo o enviarlo vacío).

```jsonc
{
  "nombre": "Mouse Logitech Inalámbrico M170 Blanco",          // obligatorio
  "url": "https://store.pronetsys.com.co/producto/mouse-logitech-inalambrico-m170-blanco", // obligatorio
  "estado": "publicado",              // "publicado" | "descontinuado" (si no es publicado, el bot NO lo ofrece)
  "condicion": "nuevo",               // "nuevo" | "reacondicionado" | "digital"
  "disponibilidad": "Disponible",     // TEXTO, no cantidad. Ej. "Disponible" / "Agotado" / "Bajo pedido"

  "precio": "$4.760",                 // obligatorio. STRING ya formateado = el precio que MUESTRA la ficha
  "iva": "IVA incluido",              // texto literal tal como aparece en la ficha; o "Excluido de IVA (Art. 424 E.T.)"
  "precioSinIva": "$4.000",           // opcional, string
  "ivaPorcentaje": 19,                // opcional, número (0, 5, 19…)

  "marca": "Logitech",                // opcional
  "categoria": "Periféricos y accesorios", // opcional
  "sku": "097855...",                 // opcional = referencia / EAN
  "descripcion": "Mouse inalámbrico de 2.4 GHz...", // opcional, ficha corta en texto plano (sin HTML)

  "caracteristicas": [                // opcional. Lista "Etiqueta: valor" (tal como la manejan) …
    "Conexión: Inalámbrico 2.4 GHz",
    "Alcance: 10 m",
    "Batería: 1 pila AA (incluida)",
    "Compatibilidad: Windows, macOS, Chrome OS"
  ],
  // … o como objeto { "Conexión": "Inalámbrico 2.4 GHz", "Alcance": "10 m" }. El bot acepta ambas formas.

  "incluye": "Mouse, receptor USB nano, 1 pila AA",   // opcional (lo que trae la caja)
  "garantia": "Garantía del fabricante; se tramita en el centro de servicio autorizado de la marca…", // opcional, TEXTO según política (ver abajo)
  "envio": "Desde Medellín a toda Colombia; no incluido en el precio, se paga contra entrega.", // opcional, texto
  "opciones": [ { "nombre": "Monitor de 22\" en lugar de 19\"", "precio": "+$178.500" } ], // opcional (upgrades, p.ej. escritorios reacondicionados)
  "imagenes": [ "https://store.pronetsys.com.co/media/p/...-1200.webp" ] // opcional (no se usa en WhatsApp por ahora)
}
```

### Reglas de datos importantes

- **`precio` SIEMPRE como STRING ya formateado** (ej. `"$4.760"`), igual que en `/api/buscar`. El bot lo **repite tal cual** y **no** calcula IVA. Si quieren, `precioSinIva` e `ivaPorcentaje` van aparte como extras.
- **`iva`**: el **texto literal** que muestra la ficha (`"IVA incluido"` o `"Excluido de IVA (Art. 424 E.T.)"`). Es clave para que el bot no asuma el régimen tributario.
- **`caracteristicas`** puede ser **arreglo** de strings `"Etiqueta: valor"` (lo que ya tienen) **o** un objeto `{clave: valor}`; el bot soporta las dos.
- **`descripcion` / `caracteristicas` en texto plano**, sin etiquetas HTML.
- **`disponibilidad`** y **`estado`** como texto; no hace falta exponer inventario exacto. Si `estado` = `"descontinuado"`, `disponibilidad` = `"Ya no disponible"` y el bot no lo ofrece. Si está publicado: `"Disponible"` / `"Agotado"` / `"Bajo pedido"`.
- **`sku`** = la **referencia** del producto, no la clave interna.
- **`garantia`** (texto según la política vigente; el bot repite lo que llegue en este campo):
  - **Nuevos:** garantía del fabricante, se tramita en el centro de servicio autorizado de la marca; si llega con defecto de fábrica, cambio por la misma referencia dentro de 7 días hábiles. (La tienda **no** gestiona la garantía de los nuevos.)
  - **Reacondicionados:** 6 meses con Pronetsys.
  - **Licencias:** soporte de activación.
- Un **slug viejo renombrado** redirige a la ficha vigente y devuelve la `url` nueva en el campo `url`. Un slug inexistente → `404 {"error":"no encontrado"}`.

### Ejemplo de llamada

```
GET https://store.pronetsys.com.co/api/producto/mouse-logitech-inalambrico-m170-blanco
Accept: application/json
→ 200  { ...el objeto de arriba... }

GET .../api/producto/no-existe-123
→ 404  { "error": "no encontrado" }
```

---

## Lado del bot (ya implementado)

- Herramientas: `buscar_en_tienda` (usa `/api/buscar`) y `ver_producto_tienda` (usa `/api/producto/{slug}`).
- Config: `ENABLE_TIENDA=true`, `STORE_URL=https://store.pronetsys.com.co` (ya activo en producción).
- **Mientras el endpoint no exista**, `ver_producto_tienda` recibe el 404 y el bot comparte el enlace del producto sin inventar especificaciones. La **búsqueda con precios ya funciona**.
- El bot repite el precio (con su nota de IVA) tal cual y tiene instrucción estricta de **no inventar** nada que no venga de la tienda.

Cuando desplieguen `GET /api/producto/{slug}` no hay que tocar el bot: empieza a dar características automáticamente.
