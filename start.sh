#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# Shift From Hell — пуск сервера + cloudflared тоннель
# ═══════════════════════════════════════════════════════════════════
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── Установка зависимостей ──────────────────────────────────────────
if [ ! -d "node_modules" ]; then
  echo "[setup] Устанавливаю зависимости…"
  npm install
fi

# ── Запуск Node-сервера ─────────────────────────────────────────────
echo "[server] Запускаю Shift From Hell на http://localhost:3000 …"
node server.js &
SERVER_PID=$!
echo "[server] PID=$SERVER_PID"

# Ждём, пока сервер поднимется
sleep 2

echo ""
echo "  ⚙  SHIFT FROM HELL  ⚙"
echo "  Локальная игра: http://localhost:3000"
echo ""

# ── Cloudflared тоннель ─────────────────────────────────────────────
echo "[tunnel] Запускаю cloudflared tunnel run irgri-tunnel …"
cloudflared tunnel run irgri-tunnel

# ── Завершение ──────────────────────────────────────────────────────
echo "[shutdown] Тоннель завершён. Останавливаю сервер…"
kill "$SERVER_PID" 2>/dev/null || true
