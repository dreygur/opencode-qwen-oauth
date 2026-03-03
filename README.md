# opencode-qwen-oauth

[![npm version](https://img.shields.io/npm/v/opencode-qwen-oauth.svg)](https://www.npmjs.com/package/opencode-qwen-oauth)
[![npm downloads](https://img.shields.io/npm/dm/opencode-qwen-oauth.svg)](https://www.npmjs.com/package/opencode-qwen-oauth)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Qwen OAuth authentication plugin for [OpenCode](https://opencode.ai) - authenticate with Qwen.ai using OAuth device flow (PKCE).

## Features

- 🔐 **OAuth Device Flow** - PKCE-secured authentication, works in headless/CI environments
- 🔄 **Automatic Token Refresh** - Tokens are refreshed before expiry
- 🌐 **Auto Browser Open** - Automatically opens browser for authentication
- 📝 **File Logging** - All OAuth activity logged to `~/.config/opencode/logs/qwen-oauth.log`
- 🐛 **Debug Mode** - Enable verbose output with `QWEN_OAUTH_DEBUG=true`
- 🚀 **Easy Install** - One-command installation with CLI tool

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

## Troubleshooting

### "Device code expired"
Complete the browser login within 5 minutes of starting `/connect`.

### "invalid_grant" error
Your refresh token has expired. Run `/connect` to re-authenticate.

### Provider not showing in /connect
Use the CLI directly:
```bash
opencode auth login qwen
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

## Security

- Uses PKCE (RFC 7636) for enhanced security
- No client secret required
- Tokens stored in OpenCode's secure auth storage
- All OAuth activity logged for auditing

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

## Project Structure

```
opencode-qwen-oauth/
├── src/                  # TypeScript source files
│   └── index.ts          # Main plugin implementation
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
