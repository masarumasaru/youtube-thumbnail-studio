#!/bin/zsh
cd "$(dirname "$0")"

echo "Starting YouTube Thumbnail Studio..."
echo "URL: http://localhost:4173/"
echo ""

NODE_BIN=""
if command -v node >/dev/null 2>&1; then
  NODE_BIN="$(command -v node)"
elif [ -x "/Applications/Codex.app/Contents/Resources/node" ]; then
  NODE_BIN="/Applications/Codex.app/Contents/Resources/node"
elif [ -x "/opt/homebrew/bin/node" ]; then
  NODE_BIN="/opt/homebrew/bin/node"
elif [ -x "/usr/local/bin/node" ]; then
  NODE_BIN="/usr/local/bin/node"
fi

if [ -z "$NODE_BIN" ]; then
  echo "Node.jsが見つかりません。Node.jsをインストールしてからもう一度起動してください。"
  echo "ダウンロードページを開きます: https://nodejs.org/"
  open "https://nodejs.org/"
  echo ""
  echo "Press any key to close."
  read -k 1
  exit 1
fi

if curl -fsS "http://localhost:4173/" >/dev/null 2>&1; then
  echo "Already running. Opening browser..."
  open "http://localhost:4173/"
  exit 0
fi

"$NODE_BIN" server.mjs &
SERVER_PID=$!

echo "Waiting for local server..."
for i in {1..30}; do
  if curl -fsS "http://localhost:4173/" >/dev/null 2>&1; then
    echo "Ready. Opening browser..."
    open "http://localhost:4173/"
    wait "$SERVER_PID"
    exit $?
  fi
  sleep 0.3
done

echo "サーバーを起動できませんでした。表示されているエラーを確認してください。"
echo ""
wait "$SERVER_PID"
echo ""
echo "Press any key to close."
read -k 1
