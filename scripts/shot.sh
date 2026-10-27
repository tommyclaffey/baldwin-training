#!/bin/zsh
# Usage: scripts/shot.sh <path> <width> <height> <out.png>
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars \
  --window-size=$2,$3 --virtual-time-budget=6000 --screenshot=$4 "http://127.0.0.1:8090$1" >/dev/null 2>&1; exit 0
