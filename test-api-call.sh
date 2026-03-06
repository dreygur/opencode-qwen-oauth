#!/bin/bash
# Test Qwen API call with OAuth token
# This helps diagnose if the issue is with the token or API endpoint

echo "🔍 Testing Qwen API Authentication"
echo "=================================="
echo ""

# Check if we have a test token
if [ -z "$QWEN_TEST_TOKEN" ]; then
  echo "❌ No test token provided"
  echo ""
  echo "To test with a real token, run:"
  echo "  QWEN_TEST_TOKEN='your_token_here' bash test-api-call.sh"
  echo ""
  echo "💡 To get your token:"
  echo "  1. Run: QWEN_OAUTH_DEBUG=true opencode"
  echo "  2. Run: /connect and authenticate"
  echo "  3. Check logs: tail ~/.config/opencode/logs/qwen-oauth.log"
  echo "  4. Look for the token (it will show token prefix)"
  exit 1
fi

echo "📡 Testing API endpoint: https://portal.qwen.ai/v1/chat/completions"
echo ""

# Test API call
response=$(curl -s -w "\n%{http_code}" \
  -X POST "https://portal.qwen.ai/v1/chat/completions" \
  -H "Authorization: Bearer $QWEN_TEST_TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-Qwen-Client: OpenCode" \
  -d '{
    "model": "qwen3-coder-plus",
    "messages": [{"role": "user", "content": "test"}],
    "max_tokens": 10
  }')

# Split response body and status code
http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | head -n-1)

echo "Status Code: $http_code"
echo ""
echo "Response Body:"
echo "$body" | jq '.' 2>/dev/null || echo "$body"
echo ""

if [ "$http_code" = "200" ]; then
  echo "✅ API call successful!"
elif [ "$http_code" = "401" ]; then
  echo "❌ 401 Unauthorized - Token is invalid or expired"
  echo ""
  echo "This means the OAuth token from chat.qwen.ai is not valid for portal.qwen.ai"
  echo "Possible solutions:"
  echo "  1. Token exchange needed (OAuth token → API token)"
  echo "  2. Different authentication method required"
  echo "  3. Additional API key or scope needed"
elif [ "$http_code" = "429" ]; then
  echo "⚠️  429 Rate Limit - Too many requests"
else
  echo "❓ Unexpected status code: $http_code"
fi
