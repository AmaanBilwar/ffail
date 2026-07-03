# ffail — agents context

## Stack
- Bun runtime, TypeScript
- `@opentui/core` — TUI framework (construct API: Box, Text, ASCIIFont; classes: SelectRenderable, TabSelectRenderable, ScrollBoxRenderable, BoxRenderable)
- `mailparser` — MIME parsing
- `mbsync` 1.5.0 at `~/.local/bin/mbsync` (installed from source)

## Project structure
- `cli/index.ts` — main TUI app
- `cli/maildir.ts` — listEnvelopes(), getEmail(), listFolders(), cleanFolderName()
- `cli/mbsync.ts` — syncNow() (spawns mbsync -a)
- `cli/config.ts` — loads ~/.ffail/config.json
- `cli/types.ts` — EmailEnvelope, SyncResult types

## Vendored repositories
- External repositories are vendored under `repos/` as read-only reference material.
- When writing Effect code, inspect `repos/effect/` for idiomatic usage, tests, module structure, and API design.
- Prefer examples and patterns from vendored source code over generated guesses or web search results.
- Do not edit files under `repos/` unless explicitly asked.
- Do not import from `repos/`; application code should continue importing from normal package dependencies.

## Config
- `~/.mbsyncrc` — Gmail IMAP + MaildirStore + Channels for all folders
- `~/.ffail/config.json` — { maildir, defaultAccount }
- `~/.ffail/mail/` — Maildir store (INBOX, [Gmail]/All Mail, Sent Mail, Drafts, Important, Starred, CampusOS, cold-outreach)

## Known bugs & fixes
- **Tab bar blank**: TabSelectRenderable needs `width: "100%"` — defaults to 0 when in flex layout
- **Sidebar shrinks when email opened**: caused by email body containing long lines that expand Yoga layout. Fix is to wrap email body in ScrollBoxRenderable to constrain dimensions.  Do NOT use `minWidth: 0` on sidebar — that allows collapse, doesn't prevent it.
- **mbsync exits with 1**: mbsync uses exit code 1 for non-fatal warnings. Treat both 0 and 1 as success.

## Key learnings
- TabSelectRenderable auto-calculates `maxVisibleTabs` from its width — 0 width means no tabs render
- Yoga flex layout: long unwrapped text in a Text node will expand its parent container
- ScrollBoxRenderable (scrollY, scrollX, viewportCulling) constrains child content to its box
- Folder names from Gmail use `/` separator: `[Gmail]/Sent Mail`, `[Gmail]/All Mail`
- cleanFolderName() strips `[Gmail]/` prefix for display
- mbsync SubFolders Verbatim is required for [Gmail] hierarchy folders
