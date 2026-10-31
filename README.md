English | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

# My Oasis

A non-profit, open-source platform for AI-driven adventure stories. **Story authors define all the rules**: there are no built-in dice or stats. Authors decide exactly what is fixed and what the AI handles, and for each AI slot they set its task, discretion level and rules. Players can never go beyond a story's rules.

- 🌐 Story site: <https://muoushikoma.github.io/my-oasis/>
- ⬇️ Download the app (Windows / Android): [Releases](https://github.com/muoushikoma/my-oasis/releases/latest)

This repo holds both the **client source code** and the **public story library** (`stories/`).

## Play
1. Install the app and connect your own AI in the setup wizard (or a local model). Rules-only stories need no AI.
2. Open **Play → Online library**. **No sign-in needed** to browse, download and play. The app reads `index.json` and `stories/` from `main`.
3. Slow connection? Switch the source: GitHub, jsDelivr, GitHub Pages, or your own mirror.

## Submit a story
- **In the app (recommended):** Create → Submit, sign in with GitHub (device code), pick a package or draft. The app validates it, forks the repo, creates a branch, opens a PR and shows its review status.
- **On the web:** fork, put your story in `stories/<id>/` (folder name = `meta.id`), open a PR against `main`.

PRs from forks may **only change `stories/`**. After the maintainer reviews and merges, the index and the story site update automatically. Unmerged submissions never show up in the app.

Content rules: no sexual content (ratings `all-ages` and `teen` only), no gore, hate, illegal content or private data; only material you own or may use; never include API keys.

## License & copyright
- **Code:** [MIT](LICENSE).
- **Stories:** each story in `stories/` remains the **copyright of its author** and is *not* MIT-licensed. By submitting, you grant this project a free, non-exclusive, worldwide, revocable (by takedown) license to store, display and distribute your story in this repo, the story site and the app. See [stories/LICENSE.md](stories/LICENSE.md).

## Development
```bash
pnpm install && pnpm typecheck && pnpm test
cargo test -p oasis-native
npm ci --prefix tools/stories && node tools/stories/validate.mjs
```
API keys and GitHub tokens live only in the OS secure store (Windows Credential Manager / Android Keystore); requests are made from Rust. Never commit keys.

## Docs (Simplified Chinese)
[Overview](docs/overview.md) · [Architecture](docs/architecture.md) · [Story format](docs/ruleset-spec.md) · [JSON Schema](docs/schema/story.schema.json) · [AI authoring guide](docs/ai-authoring-guide.md)
