#!/usr/bin/env bash
# ============================================================
#  sync-plantillas-taty.sh
#  Copia las plantillas de demo de Taty desde el proyecto taty_web
#  al repo del bot, hace commit/push y redespliega en el VPS (.35)
#  para que TODO quede sincronizado con un solo comando.
#
#  Uso:
#    npm run sync-taty
#    # o directamente:
#    bash scripts/sync-plantillas-taty.sh
#
#  Config (opcional) en scripts/deploy.env (NO se sube a git):
#    VPS_HOST=10.0.0.35
#    VPS_USER=pronetsys
#    VPS_PASS=********
#    VPS_DIR=/home/pronetsys/chatbot
#    TATY_PLANTILLAS_DIR=/c/xampp/htdocs/taty_web/plantillas_taty
# ============================================================
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

# --- Configuración (valores por defecto, sobre-escribibles por scripts/deploy.env o entorno) ---
[ -f "$REPO/scripts/deploy.env" ] && . "$REPO/scripts/deploy.env"
SRC="${TATY_PLANTILLAS_DIR:-/c/xampp/htdocs/taty_web/plantillas_taty}"
VPS_HOST="${VPS_HOST:-10.0.0.35}"
VPS_USER="${VPS_USER:-pronetsys}"
VPS_DIR="${VPS_DIR:-/home/pronetsys/chatbot}"
VPS_PASS="${VPS_PASS:-}"

# Plantillas que usa el bot:  <archivo en taty_web>  ->  <archivo en templates/>
PARES=(
  "citacion_demo_taty.txt|templates/taty-citacion-demo.txt"
  "correo_citacion_demo_taty.html|templates/taty-citacion-demo.html"
)

echo "📁 Origen:  $SRC"
[ -d "$SRC" ] || { echo "❌ No existe la carpeta de plantillas: $SRC"; echo "   Ajusta TATY_PLANTILLAS_DIR en scripts/deploy.env"; exit 1; }

# --- 1) Copiar ---
DEST_FILES=()
for par in "${PARES[@]}"; do
  origen="${par%%|*}"; destino="${par##*|}"
  [ -f "$SRC/$origen" ] || { echo "❌ Falta el archivo de origen: $SRC/$origen"; exit 1; }
  cp -f "$SRC/$origen" "$REPO/$destino"
  DEST_FILES+=("$destino")
  echo "   ✓ $origen → $destino"
done

# --- 2) ¿Cambió algo? ---
if git diff --quiet -- "${DEST_FILES[@]}"; then
  echo "✅ Las plantillas de Taty ya estaban sincronizadas. Nada que desplegar."
  exit 0
fi

# --- 3) Commit + push ---
echo "📝 Hay cambios; haciendo commit y push..."
git add "${DEST_FILES[@]}"
git commit -q -m "Sync plantillas de demo de Taty desde taty_web"
git push -q
echo "   ✓ Subido a GitHub"

# --- 4) Desplegar en el VPS ---
if [ -z "$VPS_PASS" ]; then
  echo "⚠️  No hay VPS_PASS configurada (scripts/deploy.env)."
  echo "   El repo ya quedó actualizado. Para desplegar manualmente en $VPS_HOST:"
  echo "     cd $VPS_DIR && sudo git pull && sudo docker compose up -d --build chatbot"
  exit 0
fi

command -v plink >/dev/null || { echo "❌ No encuentro 'plink' (PuTTY) en el PATH."; exit 1; }
echo "🚀 Desplegando en $VPS_HOST (esto puede tardar ~2-3 min por el build)..."
plink -ssh "$VPS_USER@$VPS_HOST" -pw "$VPS_PASS" -batch \
  "cd $VPS_DIR; echo '$VPS_PASS' | sudo -S sh -c 'git pull -q && docker compose up -d --build chatbot' 2>&1 | tail -3"

echo "🔎 Verificando arranque..."
plink -ssh "$VPS_USER@$VPS_HOST" -pw "$VPS_PASS" -batch \
  "echo '$VPS_PASS' | sudo -S sh -c 'docker logs --tail 4 chatbot-app' 2>&1" | tail -4

echo "✅ Listo. Plantillas de Taty sincronizadas y desplegadas."
