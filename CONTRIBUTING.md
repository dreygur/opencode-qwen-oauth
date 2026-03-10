# Contributing to opencode-qwen-oauth

Thank you for considering contributing! This document provides guidelines for contributing to the project.

## Quick Start

```bash
# Fork and clone
git clone https://github.com/your-username/opencode-qwen-oauth.git
cd opencode-qwen-oauth

# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test
```

## Development

```bash
# Watch mode for development
npm run dev

# Run tests in watch mode
npm run test:watch

# Test OAuth endpoints
npm run diagnose
```

## Code Style

- TypeScript strict mode enabled
- No semicolons (following project convention)
- Use existing patterns from the codebase
- Keep functions focused and single-purpose

## Pull Request Process

1. Create a feature branch from `main`
2. Make your changes
3. Ensure tests pass (`npm test`)
4. Build succeeds (`npm run build`)
5. Submit PR with clear description

## PR Guidelines

- **Bug fixes**: Include steps to reproduce the issue
- **Features**: Explain the use case and implementation
- **Performance**: Include benchmarks if applicable
- **Breaking changes**: Clearly mark in title and description

## Testing

All PRs must:
- Pass existing tests
- Add tests for new functionality
- Maintain test coverage

## Commit Messages

Follow conventional commits:
- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation
- `chore:` Maintenance
- `refactor:` Code refactoring
- `test:` Test changes

Example: `feat: add token caching with TTL`

## Questions?

- Open an issue for discussions
- Check existing issues before creating new ones
- Read the [README](README.md) for setup help

## Code of Conduct

This project follows standard open source community guidelines. Be respectful and constructive in all interactions.
