#!/usr/bin/env bash
# ============================================================
#  Despliegue automático del Chatbot (Ubuntu/Debian)
#  - Instala Docker si falta
#  - Elige un puerto LIBRE entre 3000 y 3500 si el configurado está ocupado
#  - Levanta el bot + PostgreSQL
#  Uso:   bash deploy.sh
# ============================================================
set -e

VERDE='\033[0;32m'; AMAR='\033[1;33m'; ROJO='\033[0;31m'; NC='\033[0m'
ok(){ echo -e "${VERDE}✅ $1${NC}"; }
info(){ echo -e "${AMAR}➜ $1${NC}"; }
err(){ echo -e "${ROJO}❌ $1${NC}"; }

cd "$(dirname "$0")"

echo "============================================"
echo "   Despliegue del Chatbot de WhatsApp"
echo "============================================"

# 1) Verificar .env
if [ ! -f .env ]; then
  err "No existe el archivo .env"
  echo "   Copia el ejemplo y complétalo:  cp .env.example .env  &&  nano .env"
  exit 1
fi
ok "Archivo .env encontrado"

# 2) Instalar Docker si no está
if ! command -v docker >/dev/null 2>&1; then
  info "Docker no está instalado. Instalando (requiere sudo)..."
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER" || true
  ok "Docker instalado"
else
  ok "Docker ya está instalado"
fi

# 3) Comando de compose
if docker compose version >/dev/null 2>&1; then COMPOSE="sudo docker compose";
elif command -v docker-compose >/dev/null 2>&1; then COMPOSE="sudo docker-compose";
else err "No se encontró 'docker compose'."; exit 1; fi
ok "Usando: $COMPOSE"

# 4) Bajar la pila previa (libera su propio puerto; inofensivo la 1ª vez)
$COMPOSE down >/dev/null 2>&1 || true

# 5) Elegir un puerto LIBRE entre 3000 y 3500
ocupado() {
  if command -v ss >/dev/null 2>&1; then
    ss -ltnH 2>/dev/null | awk '{print $4}' | grep -qE "[:.]$1\$"
  else
    (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null && { exec 3>&- 3<&-; return 0; } || return 1
  fi
}
PORT_CFG=$(grep -E '^PORT=' .env | cut -d= -f2 | tr -d '[:space:]'); PORT_CFG=${PORT_CFG:-3000}
PUERTO="$PORT_CFG"
if ocupado "$PUERTO"; then
  info "El puerto $PUERTO está ocupado. Buscando uno libre entre 3000 y 3500..."
  PUERTO=""
  for p in $(seq 3000 3500); do
    if ! ocupado "$p"; then PUERTO="$p"; break; fi
  done
  if [ -z "$PUERTO" ]; then err "No hay puertos libres entre 3000 y 3500."; exit 1; fi
  sed -i "s/^PORT=.*/PORT=$PUERTO/" .env
  ok "Puerto libre elegido: $PUERTO (actualizado en .env)"
else
  ok "Puerto $PUERTO libre"
fi

# 6) Construir y levantar
info "Construyendo y levantando (puede tardar unos minutos la 1ª vez)..."
$COMPOSE up -d --build

echo ""
ok "¡Listo! El chatbot está corriendo en el puerto $PUERTO."
echo ""
info "Estado:"; $COMPOSE ps
echo ""
echo "   Panel:        http://IP-DEL-SERVIDOR:${PUERTO}/admin"
echo "   Ver logs:     $COMPOSE logs -f chatbot"
echo "   Detener:      $COMPOSE down"
echo "   Reiniciar:    $COMPOSE restart chatbot"
echo "   Actualizar:   git pull && bash deploy.sh"
