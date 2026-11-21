#!/bin/bash
# 歌手大赛投票系统 · 启动脚本
cd "$(dirname "$0")" || exit 1
export PORT="${PORT:-8080}"
echo "正在启动，端口 $PORT …"
node server.js
