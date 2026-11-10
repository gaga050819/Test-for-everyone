#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$SCRIPT_DIR"

ARCH="$(uname -m)"
IS_ARM=0
if [ "$ARCH" = "arm64" ] || [ "$ARCH" = "aarch64" ]; then
  IS_ARM=1
fi
if [ "$IS_ARM" -eq 0 ]; then
  if sysctl -n machdep.cpu.brand_string 2>/dev/null | grep -iq "Apple"; then
    IS_ARM=1
  elif [ "$(sysctl -in sysctl.proc_translated 2>/dev/null)" = "1" ]; then
    IS_ARM=1
  fi
fi

if [ "$IS_ARM" -eq 1 ]; then
  NODE_ARCH="arm64"
  NGROK_ARCH="darwin-arm64"
else
  NODE_ARCH="x64"
  NGROK_ARCH="darwin-amd64"
fi

SERVER_DIR="$SCRIPT_DIR/server"
ENV_FILE="$SERVER_DIR/.env"
ENV_FLASH="$SERVER_DIR/.env.flash"
if [ ! -f "$ENV_FILE" ]; then
  if [ -f "$SCRIPT_DIR/.env" ]; then
    ENV_FILE="$SCRIPT_DIR/.env"
  elif [ -f "$ENV_FLASH" ]; then
    cp "$ENV_FLASH" "$ENV_FILE"
    echo "[+] Файл .env скопійовано автоматично."
  fi
fi

ENV_TOKEN=""
if [ -f "$ENV_FILE" ]; then
  while IFS='=' read -r key val || [ -n "$key" ]; do
    key=$(echo "$key" | tr -d ' \r\n')
    val=$(echo "$val" | tr -d '\r\n' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
    if [ "$key" = "NGROK_AUTHTOKEN" ] || [ "$key" = "NGROK_TOKEN" ]; then
      ENV_TOKEN="$val"
    fi
  done < "$ENV_FILE"
fi

for p in "/opt/homebrew/bin" "/usr/local/bin" "$SCRIPT_DIR/bin/runtime/node/bin" "$SCRIPT_DIR/.runtime/node/bin"; do
  if [ -d "$p" ]; then
    case ":$PATH:" in
      *":$p:"*) ;;
      *) export PATH="$p:$PATH" ;;
    esac
  fi
done

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "=========================================================="
  echo "[ВСТАНОВЛЕННЯ] Node.js не знайдено. Автоматичне завантаження для macOS ($NODE_ARCH)..."
  echo "=========================================================="
  NODE_VER="v20.18.0"
  NODE_TAR="node-${NODE_VER}-darwin-${NODE_ARCH}.tar.gz"
  NODE_URL="https://nodejs.org/dist/${NODE_VER}/${NODE_TAR}"
  TMP_TAR="/tmp/${NODE_TAR}"

  mkdir -p "$SCRIPT_DIR/bin/runtime/node"
  curl -fSL --retry 2 --connect-timeout 15 -o "$TMP_TAR" "$NODE_URL"
  if [ $? -eq 0 ] && [ -f "$TMP_TAR" ]; then
    tar -xzf "$TMP_TAR" -C "$SCRIPT_DIR/bin/runtime/node" --strip-components=1
    rm -f "$TMP_TAR"
    export PATH="$SCRIPT_DIR/bin/runtime/node/bin:$PATH"
  fi
fi

if ! command -v node >/dev/null 2>&1; then
  echo "[ПОМИЛКА] Не вдалося автоматично налаштувати Node.js."
  echo "Встановіть Node.js вручну з https://nodejs.org"
  exit 1
fi

lsof -ti:3500 | xargs kill -9 2>/dev/null || true
pkill -f "ngrok http 3500" 2>/dev/null || true
pkill -f "node server/index.js" 2>/dev/null || true
sleep 1

NGROK_BIN=""
if [ -x "$SCRIPT_DIR/bin/ngrok" ]; then
  NGROK_BIN="$SCRIPT_DIR/bin/ngrok"
elif [ -x "$SCRIPT_DIR/ngrok" ]; then
  NGROK_BIN="$SCRIPT_DIR/ngrok"
elif command -v ngrok >/dev/null 2>&1; then
  NGROK_BIN="$(command -v ngrok)"
fi

if [ -z "$NGROK_BIN" ]; then
  echo "=========================================================="
  echo "[ВСТАНОВЛЕННЯ] Ngrok не знайдено. Автоматичне завантаження для macOS ($NGROK_ARCH)..."
  echo "=========================================================="
  NGROK_URL1="https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-${NGROK_ARCH}.zip"
  NGROK_URL2="https://bin.ngrok.com/c/bNyj1mQVY4c/ngrok-v3-stable-${NGROK_ARCH}.zip"
  TMP_ZIP="/tmp/ngrok_mac.zip"

  mkdir -p "$SCRIPT_DIR/bin"
  curl -fSL --retry 2 --connect-timeout 15 -o "$TMP_ZIP" "$NGROK_URL1" || curl -fSL --retry 2 --connect-timeout 15 -o "$TMP_ZIP" "$NGROK_URL2"
  if [ -f "$TMP_ZIP" ]; then
    unzip -q -o "$TMP_ZIP" -d "$SCRIPT_DIR/bin"
    rm -f "$TMP_ZIP"
    chmod +x "$SCRIPT_DIR/bin/ngrok"
    xattr -d com.apple.quarantine "$SCRIPT_DIR/bin/ngrok" 2>/dev/null || true
    NGROK_BIN="$SCRIPT_DIR/bin/ngrok"
    echo "[УСПІХ] Ngrok успішно завантажено та встановлено!"
  fi
fi

if [ -n "$NGROK_BIN" ] && [ -n "$ENV_TOKEN" ]; then
  "$NGROK_BIN" config add-authtoken "$ENV_TOKEN" >/dev/null 2>&1 || true
fi

if [ ! -d "$SERVER_DIR/node_modules" ]; then
  echo "=========================================================="
  echo "[ІНІЦІАЛІЗАЦІЯ] Встановлення залежностей пакетів (npm install)..."
  echo "=========================================================="
  cd "$SERVER_DIR" && npm install && cd "$SCRIPT_DIR"
  if [ $? -ne 0 ]; then
    echo "[ПОМИЛКА] Не вдалося встановити бібліотеки через npm install."
    exit 1
  fi
fi

NGROK_PID=""
cleanup() {
  if [ -n "$NGROK_PID" ]; then
    kill "$NGROK_PID" 2>/dev/null || true
  fi
  pkill -f "ngrok http 3500" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

if [ -n "$NGROK_BIN" ]; then
  "$NGROK_BIN" http 3500 --log=stdout > /dev/null 2>&1 &
  NGROK_PID=$!
  sleep 1
  if ! kill -0 "$NGROK_PID" 2>/dev/null; then
    echo "[УВАГА] Ngrok не зміг підключитися."
    echo "         Для глобального доступу через інтернет потрібен безкоштовний токен:"
    echo "         1. Отримайте токен на https://dashboard.ngrok.com"
    echo "         2. Додайте у файл .env рядок: NGROK_AUTHTOKEN=ваш_токен"
    echo "         Локальний доступ: Wi-Fi та локальна мережа без обмежень."
    NGROK_PID=""
  else
    echo "[+] Фоновий процес ngrok активний."
  fi
else
  echo "[УВАГА] Ngrok не знайдено. Сервер буде доступний лише по локальній мережі (Wi-Fi)."
fi

if command -v open >/dev/null 2>&1; then
  open "http://localhost:3500/admin.html"
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "http://localhost:3500/admin.html"
fi

while true; do
  node "server/index.js"
  SERVER_EXIT=$?
  if [ $SERVER_EXIT -eq 100 ]; then
    echo "=========================================================="
    echo "[ОНОВЛЕННЯ] Сервер перезапускається після оновлення..."
    echo "=========================================================="
    sleep 1
    continue
  fi
  break
done

