# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 2.0.x   | :white_check_mark: |
| 1.x.x   | :x:                |

## Security Features

### Authentication Security
- **PKCE (RFC 7636)**: Proof Key for Code Exchange prevents authorization code interception
- **OAuth 2.0 Device Flow**: Secure authentication without client secrets
- **Token Validation**: All tokens validated for format and content before use
- **URL Validation**: Only HTTPS URLs from `*.qwen.ai` domains accepted

### Data Protection
- **Sensitive Data Sanitization**: All logs automatically redact tokens, secrets, and API keys
- **No Client Secrets**: Device flow doesn't require storing client secrets
- **Secure Token Storage**: Tokens stored in OpenCode's secure auth system
- **Log File Permissions**: Log files created with mode 0o700 (owner-only access)

### Network Security
- **HTTPS Only**: All API requests use HTTPS
- **Request Timeout**: 30-second default timeout prevents hanging requests
- **Retry Logic**: Exponential backoff with jitter prevents thundering herd
- **Rate Limiting**: Built-in protection against rate limit errors

### Concurrency Protection
- **Mutex Locks**: Prevents race conditions in token refresh
- **Operation Tracking**: Prevents duplicate authorization flows
- **Debouncing**: Prevents rapid successive operations

## Reporting a Vulnerability

If you discover a security vulnerability, please email security@example.com with:

1. Description of the vulnerability
2. Steps to reproduce
3. Potential impact
4. Suggested fix (if any)

**Please do not open public GitHub issues for security vulnerabilities.**

We will respond within 48 hours and provide:
- Confirmation of receipt
- Assessment timeline
- Updates on progress
- Credit for responsible disclosure (if desired)

## Security Audit Results

### Latest Audit: $(date +%Y-%m-%d)

```
npm audit
found 0 vulnerabilities
```

### Dependencies

All dependencies are actively maintained and security-patched:

- `@opencode-ai/plugin`: Official OpenCode plugin SDK
- `@types/node`: TypeScript type definitions
- `typescript`: TypeScript compiler

### Security Best Practices

1. **Keep Dependencies Updated**: Run `npm audit` regularly
2. **Review Logs**: Check `~/.config/opencode/logs/qwen-oauth.log` for anomalies
3. **Rotate Tokens**: Re-authenticate periodically using `/connect`
4. **Monitor Activity**: Enable debug mode if suspicious activity detected
5. **Report Issues**: Use GitHub Issues for non-security bugs

## Changelog

### Version 2.0.1 (2024)
- Fixed race conditions in token refresh
- Added mutex protection for concurrent operations
- Enhanced cleanup handling

### Version 2.0.0 (2024)
- Added comprehensive input validation
- Implemented retry logic with exponential backoff
- Enhanced error handling with custom error types
- Added structured logging with sensitive data sanitization
- Implemented proactive token refresh

### Version 1.1.0 (2024)
- Initial release with OAuth device flow
- PKCE implementation
- Basic logging
