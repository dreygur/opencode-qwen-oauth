#!/bin/bash
# Check current Qwen OAuth authentication state

echo "🔍 Checking Qwen OAuth Authentication State"
echo "=========================================="
echo ""

# Check if OpenCode auth file exists
AUTH_DIR="$HOME/.config/opencode"
LOG_FILE="$AUTH_DIR/logs/qwen-oauth.log"

if [ -f "$LOG_FILE" ]; then
  echo "📋 Last 20 log entries:"
  echo "---"
  tail -20 "$LOG_FILE"
  echo ""
  echo "---"
  echo ""
  
  echo "🔍 Checking for errors:"
  echo "---"
  grep -i "error\|fail\|expired\|invalid" "$LOG_FILE" | tail -10
  echo "---"
  echo ""
  
  echo "🔑 Last token refresh:"
  echo "---"
  grep -i "token refresh" "$LOG_FILE" | tail -5
  echo "---"
  echo ""
else
  echo "❌ Log file not found: $LOG_FILE"
  echo "   This means the plugin hasn't been used yet or logging is disabled."
  echo ""
fi

echo "✅ Check complete!"
echo ""
echo "💡 Troubleshooting tips:"
echo "  1. If you see 'Token is already expired', run: /connect in OpenCode"
echo "  2. If you see 'Token refresh failed', your refresh token may have expired"
echo "  3. Enable debug mode: QWEN_OAUTH_DEBUG=true opencode"
