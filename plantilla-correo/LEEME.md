# Imágenes de la plantilla de confirmación de citas

El correo de confirmación usa la plantilla `templates/cita.html`, que referencia 3 imágenes
por URL (para que el correo pese poco y Gmail no lo recorte).

## ⚠️ Debes subir estas 3 imágenes a tu servidor posfac.com

Sube estos archivos a la carpeta **`/pago/`** de posfac.com, con EXACTAMENTE estos nombres:

| Archivo | Va a esta URL |
|---|---|
| `cita-1.jpg` | https://posfac.com/pago/cita-1.jpg  (fondo del encabezado) |
| `cita-2.png` | https://posfac.com/pago/cita-2.png  (logo POSFAC del encabezado) |
| `cita-3.png` | https://posfac.com/pago/cita-3.png  (logo Pronetsys del pie) |

Una vez subidas, verifica que abran en el navegador. Si cambias la ruta, ajusta las URLs
dentro de `templates/cita.html`.
