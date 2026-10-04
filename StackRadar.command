#!/bin/bash
# Double-click me (macOS). Opens StackRadar in your default browser.
cd "$(dirname "$0")"
PORT="${STACKRADAR_PORT:-8765}"
ROOT="${STACKRADAR_ROOT:-$HOME}"
echo "StackRadar starting… scanning $ROOT (port $PORT)"
echo "Then open http://localhost:$PORT  — closing this window stops the app."
python3 stackradar.py --port "$PORT" --root "$ROOT" --open
echo
read -rp "Press Enter to close…"
