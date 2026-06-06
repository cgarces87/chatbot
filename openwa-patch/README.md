# Habilitar `message.sent` en tu openwa-api (vía SSH)

Esta carpeta tiene 2 scripts que **modifican automáticamente** el código de tu
openwa-api para que emita el evento `message.sent` (necesario para el handoff):

- `apply-patch.js` — aplica el parche (con respaldos `.bak`, idempotente).
- `revert-patch.js` — revierte (restaura los `.bak`) por si quieres deshacer.

---

## Paso a paso (tienes acceso SSH ✅)

Reemplaza `USUARIO` y `SERVIDOR` por los tuyos en los comandos.

### 1) Copiar esta carpeta al servidor
Desde tu PC (PowerShell, en `c:\xampp\htdocs\chatbot`):
```powershell
scp -r openwa-patch USUARIO@SERVIDOR:/tmp/openwa-patch
```

### 2) Entrar al servidor
```powershell
ssh USUARIO@SERVIDOR
```

### 3) Encontrar la carpeta del proyecto openwa-api
```bash
find / -path "*src/engine/adapters/whatsapp-web-js.adapter.ts" 2>/dev/null
```
Eso te dará algo como:
`/home/USUARIO/openwa-api/src/engine/adapters/whatsapp-web-js.adapter.ts`
La **carpeta del proyecto** es lo que va antes de `/src/...`
(en el ejemplo: `/home/USUARIO/openwa-api`).

### 4) Previsualizar el parche (no cambia nada todavía)
```bash
node /tmp/openwa-patch/apply-patch.js /home/USUARIO/openwa-api --dry
```
Debe decir "3 ok". Si dice "con aviso", avísame antes de seguir.

### 5) Aplicar el parche de verdad
```bash
node /tmp/openwa-patch/apply-patch.js /home/USUARIO/openwa-api
```

### 6) Recompilar y reiniciar
Primero entra a la carpeta del proyecto:
```bash
cd /home/USUARIO/openwa-api
npm run build
```
Luego reinícialo **según como esté desplegado**:

- Si usa **PM2**:
  ```bash
  pm2 list           # mira el nombre del proceso
  pm2 restart all    # o: pm2 restart <nombre>
  ```
- Si usa **Docker**:
  ```bash
  docker ps                      # mira el nombre/imagen del contenedor
  docker compose up -d --build   # si hay docker-compose.yml en la carpeta
  # o: docker restart <nombre-del-contenedor>
  ```
- Si lo corres a mano con node: deténlo y vuelve a iniciarlo.

> 💡 Si no sabes cómo está desplegado, ejecuta `pm2 list` y `docker ps` y
> pásame el resultado; te digo el comando exacto.

---

## ¿Algo salió mal? Revertir
```bash
node /tmp/openwa-patch/revert-patch.js /home/USUARIO/openwa-api
cd /home/USUARIO/openwa-api && npm run build && pm2 restart all
```

---

## Cómo saber que quedó funcionando
1. Avísame cuando hayas reiniciado: yo vuelvo a suscribir el chatbot a `message.sent`.
2. Enviarás un WhatsApp **a mano** desde el teléfono del bot a un contacto.
3. En los logs del chatbot deberá aparecer ese mensaje saliente → ahí sé que ya
   funciona y termino el handoff automático.
