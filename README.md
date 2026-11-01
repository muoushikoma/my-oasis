English | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

# My Oasis

A non-profit, open-source platform for AI-driven adventure stories. **Story authors define all the rules**: there are no built-in dice or stats. Authors decide exactly what is fixed and what the AI handles, and for each AI slot they set its task, discretion level and rules. Players can never go beyond a story's rules.

- 🌐 Story site: <https://muoushikoma.github.io/my-oasis/>
- ⬇️ Download the app (Windows / Android): [Releases](https://github.com/muoushikoma/my-oasis/releases/latest)

This repo holds both the **client source code** and the **public story library** (`stories/`).

## Play
1. Install the app and connect your own AI in the setup wizard (or a local model). Every story is AI-driven, so an AI connection is required to play.
2. Open **Play → Online library**. **No sign-in needed** to browse, download and play. The story index (`index.json`) is built after each merge and attached to the fixed Release [`story-index`](https://github.com/muoushikoma/my-oasis/releases/tag/story-index); the app reads it, or falls back to listing `stories/` on `main` directly. Story files come from `stories/` on `main`.
   - Only stories playable on the current device are listed (stories declare `meta.platforms`: `desktop`, `mobile` or both).
   - ☆ Favorites are stored only on your device. 👍 Likes are GitHub 👍 reactions on each story's like issue (label `story-likes`); sign in with GitHub (Create → Submit) to like. No server involved.
   - The on-screen joystick is shown on phones only by default (change in Settings).
3. Slow connection? Switch the source: GitHub, jsDelivr, GitHub Pages, or your own mirror.

## Submit a story
- **In the app (recommended):** Create → Submit, sign in with GitHub (device code), pick a package or draft. The app validates it, forks the repo, creates a branch, opens a PR and shows its review status.
- **On the web:** fork, put your story in `stories/<id>/` (folder name = `meta.id`), open a PR against `main`.

PRs from forks may **only change `stories/`**. After the maintainer reviews and merges, the index and the story site update automatically. Unmerged submissions never show up in the app.

Content rules: all-ages stories only (`rating: all-ages`); title, summary, exactly 3 tags and `ai_role` (what the AI does) must be given in both Chinese and English, plus `languages`, `est_minutes` and `est_tokens_per_min` (approx. tokens per minute of play) so players know what to expect; no sexual content, no gore, hate, illegal content or private data; only material you own or may use; never include API keys.

## License & copyright
- **Code:** [MIT](LICENSE).
- **Stories:** each story in `stories/` remains the **copyright of its author** and is *not* MIT-licensed. By submitting, you grant this project a free, non-exclusive, worldwide, revocable (by takedown) license to store, display and distribute your story in this repo, the story site and the app. See [stories/LICENSE.md](stories/LICENSE.md).

## Development
```bash
pnpm install && pnpm typecheck && pnpm test
cargo test -p oasis-native
pnpm install && npm ci --prefix tools/stories && pnpm exec tsx tools/stories/validate.mjs
```
API keys and GitHub tokens live only in the OS secure store (Windows Credential Manager / Android Keystore); requests are made from Rust. Never commit keys.

## Documentation index

| Document | Purpose |
|---|---|
| ⭐ [Story delivery format](docs/story-format.md) | **The only document you need to write a story; you can hand it straight to an AI.** Defines the `.oasis` package structure and field formats (including oasis/0.4 real-time games: loop, timers, keyboard/touch/joystick, canvas, sound, async AI) and story-bundled custom UI components (sandboxed HTML/JS), with no limits on story content |
| [JSON Schema](docs/schema/story.schema.json) | Machine-readable format of the story file, used by the app and the submission check |
| [Story format spec (full)](docs/ruleset-spec.md) | Detailed description of every field and how the engine executes it |
| [AI authoring guide](docs/ai-authoring-guide.md) | Older AI prompt with writing advice; reference only |
| [Overview](docs/overview.md) | What the project is, who it is for, the overall idea |
| [Architecture](docs/architecture.md) | Client, engine, AI integration and security design, plus local AI token-usage tracking |
| [Milestones](docs/mvp.md) | Done and planned features |
| [Server API (on hold)](docs/server-api.md) | Draft API for a future server; no server for now |
| [Story copyright & license](stories/LICENSE.md) | Copyright and license terms for submitted stories |
| [Contributing](CONTRIBUTING.md) | How to contribute code and stories: setup, commands, PR requirements, and hard rules |
| [Code of conduct](CODE_OF_CONDUCT.md) | How we treat each other in this community |
| [Security policy](SECURITY.md) | How to report vulnerabilities privately |

Documents are in Simplified Chinese unless noted.
