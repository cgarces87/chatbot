# ============================================================
#  Imagen del Chatbot de WhatsApp + OpenAI
# ============================================================
FROM node:22-slim

# Certificados (para HTTPS y el binario de cloudflared)
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 1) Instalar dependencias (capa cacheable)
COPY package*.json ./
RUN npm install --omit=dev

# 2) Descargar el binario de cloudflared (para el túnel automático)
RUN node -e "require('cloudflared').install(require('cloudflared').bin).then(()=>console.log('cloudflared listo'))"

# 3) Copiar el código de la app
COPY . .

# Carpeta de datos persistente (memoria json / conocimiento / flujo)
RUN mkdir -p /app/data

EXPOSE 3000
CMD ["node", "supervisor.js"]
