always use exa-web search for all types of search
always use subagents to parallelize tasks
write minimal code for maximum output basically meaning follow paretto's principal, write less code that does more

## Project Architecture

ffail is a TUI email client using:

- **@opentui/core** — terminal UI framework (Rust binary + TS bindings)
- **mailparser** — RFC 2822/MIME email parsing
- **mbsync** (external) — IMAP→Maildir sync tool
- **Bun** — runtime

### Architecture: mbsync + Maildir

Gmail ──[IMAP]──► mbsync ──[write files]──► ~/.ffail/mail/<account>/INBOX/{new,cur}/
ffail reads these files directly

ffail does NOT speak IMAP. mbsync handles all IMAP work. ffail just reads local Maildir files.

### File layout

```
cli/
  index.ts        — TUI entry: layout, keybinds, wires modules together
  types.ts        — EmailEnvelope, Email, FfailConfig interfaces
  config.ts       — reads/writes ~/.ffail/config.json
  maildir.ts      — listEnvelopes(), getEmail() — read + parse Maildir files
  mbsync.ts       — syncNow() — spawns mbsync -a via Bun.spawn()
  mailparser.d.ts — type declarations for mailparser lib
  package.json
```

### Config (~/.ffail/config.json)

```json
{
  "maildir": "/home/user/.ffail/mail",
  "defaultAccount": "INBOX"
}
```

`maildir` should point to the mbsync MaildirStore path (contains INBOX/new/, INBOX/cur/).

### Keybinds

- `j`/`k` or arrows — navigate email list
- `Enter` — open selected email
- `r` — trigger mbsync sync
- `Esc` — back to splash/list

### Maildir format

Files in `new/` = unread, `cur/` = read.
Filename: `<timestamp>.<pid>.<host>:2,<flags>` where S=seen,R=replied,F=flagged.

### Run

```
bun run index.ts
```
