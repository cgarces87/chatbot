# 🤖 Chatbot de WhatsApp + OpenAI

Chatbot que recibe mensajes por WhatsApp (vía **openwa-api**), los procesa con
**OpenAI** y responde automáticamente. Incluye **memoria persistente** y un
**panel de administración web**.

## ¿Cómo funciona?

```
WhatsApp ──► openwa-api (nube) ──webhook──► ESTE bot ──► OpenAI
                  ▲                            │
                  └────────── send-text ◄──────┘
```

El bot expone un endpoint `/webhook` que openwa-api llama cuando llega un mensaje.
En local, un **túnel de Cloudflare** le da una URL pública temporal (automático).
En producción, usas tu propio dominio.

## Características
- 💬 Respuestas con IA (OpenAI) y **memoria de contexto** por conversación.
- 🖼️ **Imágenes**: el bot "ve" y responde sobre fotos (visión de OpenAI).
- 🎤 **Audios / notas de voz**: los transcribe con Whisper y responde.
- 💾 **Memoria persistente**: las conversaciones se guardan en disco y sobreviven reinicios.
- 🖥️ **Panel web** (`/admin`) para ver el estado y editar la parametrización.
- 🔌 Registro automático del webhook al arrancar.

## Requisitos
- Node.js 18 o superior
- API key de OpenAI con saldo
- openwa-api con una sesión de WhatsApp vinculada (URL + API key)

## Instalación y configuración

```bash
npm install
copy .env.example .env     # luego edita .env con tus datos
npm start
```

Variables del `.env`:

| Variable | Qué es |
|----------|--------|
| `OPENAI_API_KEY` | Clave de OpenAI (`sk-...`) |
| `OPENAI_MODEL` | Modelo (por defecto `gpt-4o-mini`) |
| `SYSTEM_PROMPT` | Personalidad / instrucciones del bot |
| `MAX_HISTORY` | Mensajes recordados por conversación |
| `OPENWA_API_URL` | URL de tu openwa-api |
| `OPENWA_API_KEY` | API key de openwa (header `X-API-Key`) |
| `OPENWA_SESSION_ID` | ID de la sesión de WhatsApp |
| `OPENWA_WEBHOOK_SECRET` | Secreto para firmar/validar los webhooks |
| `PORT` | Puerto local (por defecto 3000) |
| `USE_TUNNEL` | `true` = túnel automático; `false` = usa `PUBLIC_URL` |
| `PUBLIC_URL` | Tu dominio público (si `USE_TUNNEL=false`) |
| `ADMIN_USER` / `ADMIN_PASSWORD` | Acceso al panel web |
| `CONV_STORE_FILE` | Archivo de memoria (por defecto `data/conversations.json`) |

## Panel de administración

Abre **http://localhost:3000/admin**: te llevará a una **página de login**
(usuario y contraseña del `.env`, vía cookie de sesión — responsive en móvil).
Desde ahí ves el estado en vivo (bot, sesión, webhook, conversaciones) y puedes
editar la personalidad, el modelo y la memoria. Los cambios de personalidad/modelo
se aplican **al instante**; los de claves/URL requieren reiniciar.

## Memoria / almacenamiento

El bot puede guardar las conversaciones en dos motores, elegibles con
`STORAGE_DRIVER` (también desde el panel):

- **`json`**: un archivo `data/conversations.json`. Cero instalación, ideal para empezar.
- **`postgres`**: base de datos PostgreSQL con **pool de conexiones**. Recomendado:
  es durable y habilita las **métricas** del panel (mensajes por día, etc.).

En modo Postgres se guarda un registro por mensaje en la tabla `messages`
(la base de datos y la tabla se crean solas al arrancar si no existen). Puedes
configurar host, puerto, **nombre de la base de datos**, usuario, contraseña y
tamaño del pool desde el `.env` o el panel, y usar el botón **"Probar conexión BD"**.

Para **reiniciar la memoria**: en JSON borra `data/conversations.json`; en
Postgres ejecuta `TRUNCATE messages;`.

---

## 🚀 Despliegue en tu VPS (producción 24/7)

### Servidor recomendado
- VPS Linux (Ubuntu 22.04/24.04). **1 vCPU + 1 GB RAM** es suficiente.
- Un (sub)dominio apuntando al VPS, ej. `bot.tudominio.com`.

### Pasos

1. **Instala Node.js y PM2** en el VPS:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
   sudo apt-get install -y nodejs
   sudo npm install -g pm2
   ```

2. **Sube el proyecto** (git o scp) y entra a la carpeta:
   ```bash
   cd chatbot
   npm install
   cp .env.example .env   # edita con tus datos
   ```

3. **Configura para producción** en `.env`:
   ```
   USE_TUNNEL=false
   PUBLIC_URL=https://bot.tudominio.com
   ```

4. **Nginx como reverse proxy + HTTPS** (Let's Encrypt):
   ```bash
   sudo apt-get install -y nginx certbot python3-certbot-nginx
   ```
   Crea `/etc/nginx/sites-available/bot` con:
   ```nginx
   server {
     server_name bot.tudominio.com;
     location / {
       proxy_pass http://localhost:3000;
       proxy_set_header Host $host;
       proxy_set_header X-Real-IP $remote_addr;
     }
   }
   ```
   Actívalo y saca el certificado:
   ```bash
   sudo ln -s /etc/nginx/sites-available/bot /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   sudo certbot --nginx -d bot.tudominio.com
   ```

5. **Arranca el bot con PM2** (se mantiene vivo y arranca al reiniciar el VPS):
   ```bash
   pm2 start index.js --name chatbot
   pm2 save
   pm2 startup    # ejecuta el comando que te muestre
   ```

Listo: el bot queda en `https://bot.tudominio.com`, registra su webhook solo y
responde 24/7. El panel estará en `https://bot.tudominio.com/admin`.

### Base de datos en producción
Si usas `STORAGE_DRIVER=postgres`, en el VPS instala PostgreSQL y crea la BD:
```bash
sudo apt-get install -y postgresql
sudo -u postgres createdb chatbot
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'tu-clave-segura';"
```
Luego pon `PG_HOST=localhost`, `PG_DATABASE=chatbot`, `PG_USER=postgres` y tu
`PG_PASSWORD` en el `.env`. La tabla `messages` se crea sola al arrancar.
(Tu servidor pronetsys ya tiene PostgreSQL; también puedes apuntar a ese.)

## Notas de seguridad
- No compartas tu `.env` (tiene tus claves). Está en `.gitignore`.
- Pon una `ADMIN_PASSWORD` fuerte: el panel muestra y edita configuración sensible.
- En producción, el panel queda protegido por HTTPS + usuario/contraseña.
