[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

# My Oasis (internal)

> **Private, closed-source project. Internal use only — do not redistribute.**

My Oasis is a platform for AI-driven adventure stories. Players download and play stories in a **desktop client**. Creators make story packages outside the client, then import, test and upload them with it.

## Components
- **Desktop client** (Tauri 2, Windows first): local rules engine, author-defined AI entry points (one AI model per story), story import, validation with plain-language errors, playtest and upload. **No built-in editor** — authors create story packages outside the client, by hand or by giving the [AI authoring guide](docs/ai-authoring-guide.md) to any chat AI. Authors define the UI; a minimal template is used otherwise.
- **Server** (self-hosted on an Alibaba Cloud ECS instance, mainland China): accounts, story upload/review/download, user data (works, download history, cloud saves).
- **Bring your own AI**: players use their own API key or a local model. Keys are stored only in the OS keychain and are never sent to our server.

## Key design points
- Authors define all rules, UI layout and where AI is used; the platform has no built-in game mechanics (dice etc. are optional templates). The engine enforces the rules, and each AI entry point can only act within the permissions its author grants.
- Server address is not hard-coded: it comes from a signed, remotely updatable bootstrap config.
- During the IP-only test phase, TLS uses a self-signed certificate with public-key pinning in the client. Passwords are never sent in plain text and are stored with argon2id.
- Content must comply with mainland China regulations (real-name registration, ICP filing, content review). Adult content is not accepted.

## Status
M1 (engine, validator, CLI) done; M2 (standalone Windows client) in progress. Server features are **paused** — we ship a standalone client first to test the waters.

## Development
```bash
pnpm install
pnpm test                                  # unit tests
pnpm oasis validate examples/lighthouse-mini
pnpm oasis play tests/fixtures/guess-the-box     # text playtest
# with AI (OpenAI-compatible): set OASIS_API_KEY, OASIS_BASE_URL, OASIS_MODEL
```
Never commit API keys; they are read from environment variables only.

## Documents (Simplified Chinese)
- [Overview](docs/overview.md)
- [Architecture](docs/architecture.md)
- [Server API & data design](docs/server-api.md)
- [Story package format specification](docs/ruleset-spec.md)
- [JSON Schema](docs/schema/story.schema.json)
- [AI authoring guide](docs/ai-authoring-guide.md)
- [MVP & milestones](docs/mvp.md)
