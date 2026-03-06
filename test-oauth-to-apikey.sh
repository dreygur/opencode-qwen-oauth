#!/bin/bash
# Test if we can get API key from OAuth token

echo "Testing OAuth token to API key exchange..."
echo ""

if [ -z "$QWEN_OAUTH_TOKEN" ]; then
  echo "❌ No OAuth token provided"
  echo ""
  echo "To test:"
  echo "1. Get your OAuth access token from:"
  echo "   cat ~/.config/opencode/auth.json | jq '.qwen'"
  echo "2. Run:"
  echo "   QWEN_OAUTH_TOKEN='your_token' bash test-oauth-to-apikey.sh"
  exit 1
fi

echo "📡 Testing potential API key endpoints..."
echo ""

ENDPOINTS=(
  "https://chat.qwen.ai/api/v1/user/api-key"
  "https://chat.qwen.ai/api/v1/user/info"
  "https://chat.qwen.ai/api/v1/user/me"
  "https://chat.qwen.ai/api/v1/oauth2/api-key"
  "https://chat.qwen.ai/api/v1/account/api-key"
  "https://portal.qwen.ai/v1/user/me"
  "https://portal.qwen.ai/v1/api-keys"
)

for endpoint in "${ENDPOINTS[@]}"; do
  echo "🔍 Trying: $endpoint"
  
  response=$(curl -s -w "\n%{http_code}" \
    "$endpoint" \
    -H "Authorization: Bearer $QWEN_OAUTH_TOKEN" \
    -H "Content-Type: application/json")
  
  http_code=$(echo "$response" | tail -n1)
  body=$(echo "$response" | head -n-1)
  
  echo "   Status: $http_code"
  
  if [ "$http_code" = "200" ]; then
    echo "   ✅ Success!"
    echo "   Response:"
    echo "$body" | jq '.' 2>/dev/null || echo "$body"
    echo ""
    break
  elif [ "$http_code" != "404" ] && [ "$http_code" != "405" ]; then
    echo "   Response: $body"
  fi
  
  echo ""
done

echo ""
echo "💡 If none worked, you may need to:"
echo "   1. Get an API key manually from https://chat.qwen.ai"
echo "   2. Use a different authentication method"
