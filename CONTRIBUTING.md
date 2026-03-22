# Contributing to turn-mcp-web

Thank you for your interest in contributing! This guide covers setup, testing, and the PR process.

## Development Setup

```bash
git clone https://github.com/anthropic/turn-mcp-web-universal
cd turn-mcp-web-universal
npm install
npm run build
npm start
```

The web console is at `http://127.0.0.1:3737/` and the MCP endpoint at `http://127.0.0.1:3737/mcp`.

Watch mode for TypeScript:

```bash
npm run dev   # tsc -w
```

## Project Structure

```
src/           TypeScript source (compiles to dist/)
public/        Browser console frontend (vanilla JS, no build step)
tests/         Test files
python-client/ Python client package
examples/      Integration examples
```

## Testing

```bash
npm test              # unit tests + integration tests
npm run test:unit     # WaitStore unit tests only (fast, no server needed)
npm run test:ui       # UI integration tests (starts a real server)
```

The unit tests in `tests/wait-store.test.js` test the core state machine directly against the compiled output. They're the fastest feedback loop — run these first.

## Code Style

- TypeScript: strict mode, no `any`, prefer `const`
- Frontend JS: ES2019+, vanilla JS (no bundler, no framework)
- No new runtime dependencies — the project intentionally has zero npm runtime deps

## Submitting a PR

1. Fork and create a branch: `git checkout -b feat/my-feature`
2. Make your changes and add tests if adding new behavior
3. Run `npm test` and ensure all tests pass
4. Run `npm run build` and ensure TypeScript compiles without errors
5. Open a PR with a clear description of what the change does and why

### PR Checklist

- `npm run build` passes with no TypeScript errors
- `npm run test:unit` passes (all WaitStore unit tests green)
- New behavior has corresponding test coverage
- Environment variable changes are documented in `README.md`
- Frontend changes work in the latest Chrome/Firefox/Safari

## Reporting Bugs

Use the GitHub issue tracker. Include:
- Steps to reproduce
- Expected vs actual behavior
- Node.js version (`node --version`)
- Server logs if relevant

## Feature Requests

Open an issue with the `enhancement` label. Describe:
- The use case / problem you're trying to solve
- Your proposed solution (if you have one)
- Any alternatives you've considered

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
