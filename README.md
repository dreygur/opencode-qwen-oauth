# opencode-qwen-oauth

[![npm version](https://img.shields.io/npm/v/opencode-qwen-oauth.svg?style=flat-square)](https://www.npmjs.com/package/opencode-qwen-oauth)
[![npm downloads](https://img.shields.io/npm/dm/opencode-qwen-oauth.svg?style=flat-square)](https://www.npmjs.com/package/opencode-qwen-oauth)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![CI Status](https://img.shields.io/github/actions/workflow/status/dreygur/opencode-qwen-oauth/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/dreygur/opencode-qwen-oauth/actions)
[![Security Audit](https://img.shields.io/badge/security-audited-success?style=flat-square)](AUDIT.md)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![OpenCode](https://img.shields.io/badge/OpenCode-Plugin-purple?style=flat-square)](https://opencode.ai)
[![Qwen](https://img.shields.io/badge/Qwen.ai-OAuth-red?style=flat-square)](https://qwen.ai)

Qwen OAuth authentication plugin for [OpenCode](https://opencode.ai) - authenticate with Qwen.ai using OAuth device flow (PKCE).

## Features

- 🔐 **OAuth Device Flow** - PKCE-secured authentication, works in headless/CI environments
- 🔄 **Automatic Token Refresh** - Tokens are refreshed before expiry
- 🌐 **Auto Browser Open** - Automatically opens browser for authentication
- 📝 **File Logging** - All OAuth activity logged to `~/.config/opencode/logs/qwen-oauth.log`
- 🐛 **Debug Mode** - Enable verbose output with `QWEN_OAUTH_DEBUG=true`
- 🚀 **Easy Install** - One-command installation with CLI tool
- 🎯 **Custom Headers** - Automatically adds Qwen-specific headers to API requests
- ⚙️ **Optimized Parameters** - Pre-configured temperature and topP settings for Qwen models
- 🌍 **Environment Variables** - Exposes Qwen credentials to shell environments
- 📊 **Event Monitoring** - Tracks authentication and session events for debugging

## Quick Start

### Install

```bash
# Using npx (recommended)
npx opencode-qwen-oauth install

# Or using bunx
bunx opencode-qwen-oauth install

# Or install manually
npm install opencode-qwen-oauth
```

The installer will:
- Add `opencode-qwen-oauth` to your `.opencode/opencode.json` plugins
- Configure the Qwen provider with models

### Authenticate

```bash
# Start OpenCode
opencode

# Connect to Qwen
/connect
```

Select **"Qwen Code (qwen.ai OAuth)"** and follow the device flow instructions.

### Use Qwen Models

```
/model qwen/qwen3-coder-plus
```

## Models

| Model | Context | Features |
|-------|---------|----------|
| `qwen3-coder-plus` | 1M tokens | Optimized for coding |
| `qwen3-vl-plus` | 256K tokens | Vision + language |

## Configuration

### Debug Mode

Enable verbose logging to console:

```bash
QWEN_OAUTH_DEBUG=true opencode
```

### Log Files

All OAuth activity is logged to:
```
~/.config/opencode/logs/qwen-oauth.log
```

View logs in real-time:
```bash
tail -f ~/.config/opencode/logs/qwen-oauth.log
```

### Manual Configuration

If you prefer manual setup, add to `.opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-qwen-oauth"],
  "provider": {
    "qwen": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Qwen Code",
      "options": {
        "baseURL": "https://portal.qwen.ai/v1"
      },
      "models": {
        "qwen3-coder-plus": {
          "id": "qwen3-coder-plus",
          "name": "Qwen3 Coder Plus"
        },
        "qwen3-vl-plus": {
          "id": "qwen3-vl-plus",
          "name": "Qwen3 VL Plus",
          "attachment": true
        }
      }
    }
  }
}
```

## CLI Commands

```bash
# Install (default)
npx opencode-qwen-oauth install

# Uninstall
npx opencode-qwen-oauth uninstall

# Help
npx opencode-qwen-oauth --help
```

## Diagnostics

Test if the Qwen OAuth endpoints are accessible:

```bash
npm run diagnose
```

This will check:
- ✓ OAuth base URL accessibility
- ✓ Device code endpoint functionality
- ✓ API endpoint availability

Example output:
```
[Base URL] https://chat.qwen.ai
  Status: ✓ 200

[Device Code] https://chat.qwen.ai/api/v1/oauth2/device/code
  Status: ✓ 200

[API Endpoints] Testing /chat/completions...
  ⚠ https://portal.qwen.ai/v1
    Status: 401 (endpoint exists, requires auth)
```

## Troubleshooting

### "Device code expired"
Complete the browser login within 15 minutes of starting `/connect`.

### "invalid_grant" error
Your refresh token has expired. Run `/connect` to re-authenticate.

### "Quota exceeded" error
Your free tier limit has been reached. Wait for quota reset or upgrade your account at https://chat.qwen.ai

### Provider not showing in /connect
Use the CLI directly:
```bash
opencode auth login qwen
```

### Browser doesn't open automatically (Linux)
The plugin tries multiple methods to open your browser:
1. First tries `xdg-open` (standard Linux)
2. Falls back to: `google-chrome`, `firefox`, `chromium`, `brave-browser`, `microsoft-edge`

If none work, manually copy the URL shown in the terminal and open it in your browser.

To ensure browser opening works, install `xdg-utils`:
```bash
# Ubuntu/Debian
sudo apt install xdg-utils

# Fedora/RHEL
sudo dnf install xdg-utils

# Arch Linux
sudo pacman -S xdg-utils
```

### Check logs
```bash
cat ~/.config/opencode/logs/qwen-oauth.log
```

## How It Works

This plugin implements OAuth 2.0 Device Flow (RFC 8628) with PKCE:

1. **Device Code Request** - Plugin requests a device code from Qwen OAuth server
2. **User Authorization** - User visits the verification URL and enters the user code
3. **Token Polling** - Plugin polls for the access token until user authorizes
4. **Token Storage** - Tokens are stored in OpenCode's auth system
5. **Auto Refresh** - Access tokens are refreshed before expiry

## Security & Important Notes

### Security Features
- ✅ Uses PKCE (RFC 7636) for enhanced security
- ✅ No client secret required (safer for public clients)
- ✅ Tokens stored in OpenCode's secure auth storage
- ✅ All OAuth activity logged for auditing
- ✅ Sensitive data sanitized in logs

### Implementation Notes

⚠️ **Important**: This plugin uses OAuth endpoints that appear to be part of Qwen's web interface (`chat.qwen.ai`). While the implementation follows standard OAuth 2.0 specifications (RFC 8628 Device Flow + RFC 7636 PKCE), these endpoints are not officially documented in Qwen's public API documentation.

**What this means:**
- The OAuth flow works correctly and follows industry standards
- Endpoints are actively maintained and functional
- Future changes to Qwen's authentication system may require plugin updates

**Verified Working:**
- ✅ OAuth Device Flow: `https://chat.qwen.ai/api/v1/oauth2/*`
- ✅ API Endpoint: `https://portal.qwen.ai/v1/chat/completions`
- ✅ Token Refresh: Automatic refresh before expiration
- ✅ OpenAI-Compatible: Uses standard OpenAI API format

Run `npm run diagnose` to verify endpoint availability at any time.

## Development

```bash
# Clone and install
git clone https://github.com/yourusername/opencode-qwen-oauth.git
cd opencode-qwen-oauth
npm install

# Build
npm run build

# Watch mode
npm run dev

# Test locally
npm link
cd /path/to/project
opencode-qwen-oauth install
```

## Plugin Architecture

This plugin implements multiple OpenCode plugin hooks:

### Hooks Implemented

#### `auth` Hook
Provides OAuth device flow authentication with automatic browser opening and token polling.

#### `config` Hook  
Dynamically registers the Qwen provider and available models with OpenCode.

#### `event` Hook
Monitors session events (creation, errors) for debugging and logging.

#### `chat.headers` Hook
Injects custom headers for Qwen API requests:
- `X-Qwen-Client: OpenCode`
- `X-Qwen-Plugin-Version: 1.1.0`

#### `chat.params` Hook
Optimizes model parameters for Qwen:
- Temperature: `0.7` (default)
- Top P: `0.95` (default)

#### `shell.env` Hook
Exposes environment variables to shell commands:
- `QWEN_API_BASE_URL` - Qwen API endpoint
- `QWEN_PROVIDER` - Provider identifier

## Project Structure

```
opencode-qwen-oauth/
├── src/                  # TypeScript source files
│   ├── index.ts          # Main plugin with hooks
│   ├── oauth.ts          # OAuth device flow logic
│   ├── pkce.ts           # PKCE implementation
│   ├── browser.ts        # Browser opening utility
│   ├── logger.ts         # Logging utilities
│   └── constants.ts      # API constants
├── bin/                  # CLI scripts
│   └── install.js        # Installer script
├── dist/                 # Compiled JavaScript (generated)
├── package.json          # Package manifest
├── tsconfig.json         # TypeScript config
├── LICENSE               # MIT license
└── README.md             # This file
```

**Note:** `.opencode/` directory is for local testing only and is not included in the npm package.

## License

MIT

## Contributing

Contributions welcome! Please open an issue or submit a PR.

## Related

- [OpenCode Documentation](https://opencode.ai/docs)
- [OpenCode Plugin API](https://opencode.ai/docs/plugins)
- [Qwen.ai](https://chat.qwen.ai)
