#!/bin/bash
# 公网穿透：给手机用流量也能打开
# 用法：./tunnel.sh   （保持这个窗口开着，或者用 nohup ./tunnel.sh &）
cd "$(dirname "$0")" || exit 1
PORT="${PORT:-8080}"
LOG="tunnel.log"
: > "$LOG"

echo "正在建立公网隧道（localhost.run）…"

while true; do
  ssh -o StrictHostKeyChecking=no \
      -o ServerAliveInterval=25 \
      -o ServerAliveCountMax=3 \
      -o ExitOnForwardFailure=yes \
      -R 80:localhost:$PORT nokey@localhost.run > "$LOG" 2>&1 &
  SSH_PID=$!

  # 等待地址出现
  URL=""
  for i in $(seq 1 20); do
    sleep 1
    URL=$(grep -aoE 'https://[a-z0-9]+\.(lhr\.life|localhost\.run)' "$LOG" | grep -v admin | head -1)
    [ -n "$URL" ] && break
  done

  if [ -n "$URL" ]; then
    echo "$URL" > tunnel.url
    echo "公网地址：$URL"
    echo "投票页：  $URL/vote"
    echo "大屏：    $URL/screen"
    echo "（地址已写入 tunnel.url，大屏二维码会自动更新）"
  else
    echo "没拿到地址，10 秒后重试…"
  fi

  wait $SSH_PID
  echo "隧道断开，5 秒后自动重连…"
  sleep 5
done
