# Resumen de Plantillas POSFAC

Guía de referencia de las plantillas de comunicación de **POSFAC** (un producto de **Pronetsys S.A.S.**), pensada para que un asistente/chatbot sepa **qué plantilla usar en cada situación** y con **qué datos completarla**.

- **Empresa:** Pronetsys S.A.S. — NIT **901.386.859-4** — Medellín, Colombia
- **Producto:** POSFAC — Plataforma de Gestión y Facturación Electrónica
- **Soporte:** soporte@posfac.com · 📞 3503950538 · 🌐 www.posfac.com
- **Ventas:** ventas@posfac.com (solo en la citación a demo)

> **Nota sobre SAAS:** POSFAC es software en la nube (SAAS). **Los precios NO manejan IVA.** No mencionar IVA en ninguna comunicación.

---

## 1. Datos de pago (comunes)

Todas las plantillas que solicitan pago usan estos mismos medios:

### Transferencia / QR / Bre-b (precio base, sin recargo)
- 🏦 **Bancolombia – Cuenta de Ahorros:** `253-000030-70`
- 👤 **Titular:** Pronetsys S.A.S.
- ⚡ **Llave Bre-b:** `@pronetsys`
- 📲 **Código QR:** `https://posfac.com/pago/qr-breb-recortado.png`

### Pago en línea con tarjeta (Wompi) — precio con recargo de pasarela
Pago con **tarjeta de crédito, tarjeta de débito o PSE** a través de la pasarela de pagos **Wompi de Bancolombia**.

| Plan | Precio base (transf./QR/Bre-b) | Precio con Wompi | Link de pago Wompi |
|------|-------------------------------|------------------|--------------------|
| 📅 Mensual | $286.000/mes | $295.852 | https://checkout.wompi.co/l/OQcKjJ |
| 📆 Trimestral | $792.000/trimestre *(ahorra $66.000)* | $817.809 | https://checkout.wompi.co/l/P2MKjt |
| 🗓️ Anual | $2.629.000/año *(mayor ahorro: $803.000)* | $2.712.739 | https://checkout.wompi.co/l/C0ZUba |

> Los precios base aplican para transferencia, QR y Bre-b. Los precios con Wompi incluyen el recargo de la pasarela.

---

## 2. Documentación requerida (comunes)

Se solicita en la **bienvenida** y en las **3 plantillas de activación**.

**A) Documentos legales**
1. RUT actualizado
2. Certificado de Existencia y Representación Legal (Cámara de Comercio, máx. 30 días) — *no requerido para personas naturales*
3. Cédula del Representante Legal (o del titular si es persona natural)
4. Resolución de Facturación Electrónica en PDF (con prefijo DIAN)
5. Comprobante de pago

**B) Datos para configurar el sistema**
6. Logo en PNG o JPG (fondo transparente preferible)
7. NIT, Dirección, Correo y Teléfono que aparecerán en las facturas

---

## 3. Inventario de plantillas

Cada comunicación tiene **dos formatos**:
- `.txt` → mensaje para **WhatsApp** (usa `*negritas*` y `_cursivas_` estilo WhatsApp)
- `.html` → **correo electrónico** (diseño con logo, listo para enviar)

| # | Situación / Uso | WhatsApp (.txt) | Correo (.html) |
|---|-----------------|-----------------|----------------|
| 1 | **Bienvenida** — cliente nuevo: pasos para activar (pago + documentación) | `mensaje_bienvenida_posfac.txt` | `correo_bienvenida_posfac.html` |
| 2 | **Citación a demostración** — agendar demo del producto | `citacion_demo_posfac.txt` | `correo_citacion_demo_posfac.html` |
| 3 | **Activación Plan Mensual** — confirma pago y activación | `activacion_mensual_posfac.txt` | `correo_activacion_mensual_posfac.html` |
| 4 | **Activación Plan Trimestral** | `activacion_trimestral_posfac.txt` | `correo_activacion_trimestral_posfac.html` |
| 5 | **Activación Plan Anual** | `activacion_anual_posfac.txt` | `correo_activacion_anual_posfac.html` |
| 6 | **Pago exitoso (Wompi)** — confirmación de transacción aprobada | — | `pago_exitoso_posfac.html` |
| 7 | **Pago fallido (Wompi)** — transacción rechazada, opciones de reintento | — | `pago_fallido_posfac.html` |

---

## 4. Detalle por plantilla

### 4.1 Bienvenida — `mensaje_bienvenida_posfac.txt` / `correo_bienvenida_posfac.html`
**Cuándo usarla:** al dar la bienvenida a un cliente nuevo que va a contratar.
**Contenido:**
- Saludo y bienvenida.
- **PASO 1 – Pago:** lista de planes con **precios base**, datos de cuenta Bancolombia + QR + Bre-b, y opción **Wompi** (tarjeta/PSE) con precios con recargo y links por periodo.
- **PASO 2 – Documentación:** lista completa (ver sección 2).
- Tiempo de activación: **3 días hábiles** desde el pago + documentación completa.
- Firma de Soporte Técnico.

**Campos a completar:** ninguno obligatorio (es genérica). El comprobante se envía a `soporte@posfac.com` o por el mismo chat.

---

### 4.2 Citación a demo — `citacion_demo_posfac.txt` / `correo_citacion_demo_posfac.html`
**Cuándo usarla:** para agendar una demostración personalizada (Google Meet).
**Campos a completar (placeholders):**
- `[NOMBRE_CLIENTE]`
- `[NOMBRE_EMPRESA]`
- `[FECHA_DEMO]`
- `[HORA_INICIO]` – `[HORA_FIN]` (hora Colombia)
- `[DURACION]`
- `[ENLACE_MEET]`

**Contacto en esta plantilla:** equipo **Comercial** (`ventas@posfac.com`).

---

### 4.3 / 4.4 / 4.5 Activación (Mensual / Trimestral / Anual)
Archivos: `activacion_<periodo>_posfac.txt` y `correo_activacion_<periodo>_posfac.html`
**Cuándo usarla:** cuando el cliente **ya pagó** y se confirma la activación de su plan.
**Son plantillas GENÉRICAS** (no llevan nombre del cliente, ni fechas, ni credenciales).
**Contenido:**
- Confirmación de activación exitosa del plan.
- Detalles del plan: **plan contratado** y **vigencia** (1 mes / 3 meses / 12 meses).
- Aviso: *"Muy pronto el equipo de Pronetsys se pondrá en contacto para realizar los ajustes y la configuración de la plataforma contratada."*
- **Documentación requerida** (ver sección 2).
- **Renovación:** cuenta Bancolombia + Bre-b + QR **y** opción Wompi (tarjeta/PSE) con los links por periodo.
- Firma de Soporte Técnico.

**Variación entre las 3:** solo cambia el nombre del plan y la vigencia.
**Campos a completar:** ninguno (son genéricas).

---

### 4.6 Pago exitoso — `pago_exitoso_posfac.html`
**Cuándo usarla:** confirmar al cliente que su pago por Wompi fue **aprobado**.
**Formato:** solo correo HTML (diseño con animación de confeti).

---

### 4.7 Pago fallido — `pago_fallido_posfac.html`
**Cuándo usarla:** informar que la transacción por Wompi **fue rechazada** (no se realizó ningún cobro).
**Contenido:**
- Posibles causas del rechazo (fondos, banco, datos de tarjeta, conexión).
- **Tres botones de reintento** (uno por periodo) con los links de Wompi:
  - Pagar Plan Mensual → https://checkout.wompi.co/l/OQcKjJ
  - Pagar Plan Trimestral → https://checkout.wompi.co/l/P2MKjt
  - Pagar Plan Anual → https://checkout.wompi.co/l/C0ZUba
- **Pago alternativo:** cuenta Bancolombia + Bre-b + QR.
- Canales de contacto (correo, WhatsApp, teléfono, web).

---

## 5. Placeholders (resumen rápido)

| Placeholder | Aparece en | Qué reemplazar |
|-------------|-----------|----------------|
| `[NOMBRE_CLIENTE]` | Citación a demo | Nombre del contacto |
| `[NOMBRE_EMPRESA]` | Citación a demo | Nombre de la empresa |
| `[FECHA_DEMO]` | Citación a demo | Fecha de la demo |
| `[HORA_INICIO]` / `[HORA_FIN]` | Citación a demo | Horario (hora Colombia) |
| `[DURACION]` | Citación a demo | Duración aproximada |
| `[ENLACE_MEET]` | Citación a demo | Link de Google Meet |

> Las plantillas de **bienvenida** y **activación** no requieren completar campos: son genéricas.

---

## 6. Reglas para el chatbot

1. **No mencionar IVA** — POSFAC es SAAS, los precios no manejan IVA.
2. **NIT correcto:** siempre `901.386.859-4`.
3. **Elegir el formato correcto:** `.txt` para WhatsApp, `.html` para correo.
4. **Distinguir el precio según el medio de pago:** precio base (transferencia/QR/Bre-b) vs. precio con recargo (Wompi/tarjeta/PSE).
5. **QR:** al enviar por WhatsApp, adjuntar la imagen del QR aparte; en correo ya va incrustada.
6. **Activaciones son genéricas:** no inventar nombres, fechas ni credenciales.
7. **Comprobantes de pago:** se reciben en `soporte@posfac.com` o por el chat.
8. **Contacto:** usar `ventas@posfac.com` solo para la demo; para el resto, `soporte@posfac.com`.
