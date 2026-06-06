# 🚀 Manual de Despliegue — Chatbot de WhatsApp + OpenAI

Esta guía explica cómo dejar el chatbot corriendo en un servidor, usando **Docker**
(todo automatizado). El chatbot incluye su propia base de datos PostgreSQL.

> 📌 **Importante:** el **openwa-api** (tu gateway de WhatsApp) es un servicio
> **aparte** que ya tienes corriendo (`wapi.pronetsys.com.co`). Este despliegue
> es **solo del chatbot**, que se conecta a ese openwa-api por internet.

---

## 1) Qué debe tener la máquina base

| Recurso | Mínimo | Recomendado |
|---------|--------|-------------|
| Sistema | Ubuntu 22.04 / 24.04 (o Debian) | Ubuntu 24.04 |
| CPU | 1 núcleo | 2 núcleos |
| RAM | 1 GB | 2 GB |
| Disco | 5 GB libres | 10 GB |
| Red | Salida a internet | + un dominio (opcional) |

**Software:** solo necesitas **Docker** (el script lo instala si falta). No hace
falta instalar Node, PostgreSQL ni nada más a mano: todo va dentro de Docker.

---

## 2) Antes de empezar (lo que necesitas a la mano)
- Tu **API key de OpenAI** (con saldo).
- La **URL y API key de tu openwa-api** y el **ID de sesión** de WhatsApp.
- El proyecto del chatbot (esta carpeta) copiada al servidor.

---

## 3) Despliegue paso a paso (automático)

### a) Copiar el proyecto al servidor
Desde tu PC (PowerShell), o con `git clone` si lo tienes en un repo:
```powershell
scp -r . USUARIO@IP-SERVIDOR:/home/USUARIO/chatbot
```

### b) Entrar al servidor y a la carpeta
```bash
ssh USUARIO@IP-SERVIDOR
cd ~/chatbot
```

### c) Crear y completar el archivo .env
```bash
cp .env.example .env
nano .env
```
Rellena al menos: `OPENAI_API_KEY`, `OPENWA_API_URL`, `OPENWA_API_KEY`,
`OPENWA_SESSION_ID`, `ADMIN_PASSWORD` y `PG_PASSWORD` (pon una contraseña tuya).

> En Docker **no** cambies `PG_HOST`: el sistema lo ajusta solo a `postgres`.

### d) Ejecutar el script de despliegue
```bash
bash deploy.sh
```
Esto instala Docker (si falta), construye la imagen y levanta **2 contenedores**:
`chatbot-app` y `chatbot-postgres`. La primera vez tarda unos minutos.

> 🔌 **Puerto automático:** el script revisa si el puerto configurado (`PORT` del
> `.env`, por defecto 3000) está ocupado. Si lo está, **elige solo el primer puerto
> libre entre 3000 y 3500** y lo actualiza en el `.env`. Al final te muestra en qué
> puerto quedó.

### e) Abrir el panel
```
http://IP-DEL-SERVIDOR:3000/admin
```
(usuario y contraseña de tu `.env`)

✅ El bot ya está conectado a tu openwa-api y respondiendo. El túnel de Cloudflare
se abre solo y registra el webhook automáticamente.

---

## 4) Comandos útiles (gestión)
```bash
sudo docker compose ps                 # ver estado
sudo docker compose logs -f chatbot    # ver logs en vivo
sudo docker compose restart chatbot    # reiniciar el bot
sudo docker compose down               # DETENER todo
sudo docker compose up -d --build      # actualizar tras cambios
```

## 5) Qué se guarda (persistencia)
- **Memoria/conversaciones:** en el volumen de PostgreSQL (`pgdata`) — sobrevive reinicios y rebuilds.
- **Conocimiento y flujo:** en la carpeta `./data` del servidor — también persisten.

---

## 6) Producción con tu propio dominio (opcional)
Por defecto el bot usa el **túnel de Cloudflare** (`USE_TUNNEL=true`), que funciona
sin abrir puertos ni dominio. Si quieres tu dominio propio:
1. En `.env`: `USE_TUNNEL=false` y `PUBLIC_URL=https://bot.tudominio.com`.
2. Apunta el (sub)dominio a la IP del servidor.
3. Pon un **Nginx + HTTPS** (Let's Encrypt) delante, haciendo `proxy_pass` al puerto 3000.
4. `sudo docker compose up -d --build`.

## 7) Varios números (varias instancias)
Para cada número adicional, copia el proyecto a otra carpeta (ej. `chatbot-tienda2`),
cambia en su `.env` el `PORT`, `OPENWA_SESSION_ID` y `PG_DATABASE`, y corre `bash deploy.sh`
ahí. Cada uno corre en su propio puerto y con su propia memoria.

## 8) Seguridad
- Cambia `ADMIN_PASSWORD` y `PG_PASSWORD` por valores fuertes.
- No compartas el `.env` (tiene tus claves). No queda dentro de la imagen Docker.
- Si expones el panel a internet, hazlo siempre con HTTPS.
