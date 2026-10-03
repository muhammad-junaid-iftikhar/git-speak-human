# gitbuddy for AI agents

gitbuddy wraps git with safe, plain-English commands. Every changing command takes a snapshot first, so you can always roll back your own actions.

## Connect

MCP (Claude Code, Claude Desktop, Cursor, …):

```bash
claude mcp add gitbuddy -- gitbuddy mcp
```

Or call the CLI with `--json`.

## Rules of thumb

1. Start with `gitbuddy state --json`. It returns branch, workspace, changes, conflicts, any operation in progress, and whether undo/redo is available.
2. Every changing command returns `snapshot_id`. Roll back with `gitbuddy undo <snapshot_id> --json`.
3. gitbuddy never prompts when there is no terminal. If it needs a decision it fails with `needs_confirmation` (re-run with `--yes`) or `needs_choice` (pass the choice as an argument).
4. Add `--dry-run` to see the exact git commands without running them, and `--explain` to log them while running.

## Output shape

```json
{
  "schema": 1,
  "ok": true,
  "command": "done",
  "exit_code": 0,
  "data": { "commit": "…", "message": "…", "files": ["…"] },
  "warnings": [],
  "next_steps": ["gitbuddy send"],
  "snapshot_id": "mus…",
  "error": { "code": "conflict", "message": "…", "hint": "…" }
}
```

`error` is present only when `ok` is false.

## Exit codes

| code | meaning | what to do |
|---|---|---|
| 0 | ok | |
| 1 | user error | read `error.code` / `error.hint` |
| 2 | conflict | `gitbuddy conflicts --json`, then `gitbuddy keep mine\|theirs\|both <file>`, then `gitbuddy continue` (or `gitbuddy abort`) |
| 3 | setup | git missing, not a repo (`gitbuddy new`), or no identity |
| 4 | network / login | `gitbuddy doctor --json` |

## Common error codes

`not_a_repo`, `no_remote`, `auth_failed`, `offline`, `rejected` (run `gitbuddy sync`), `conflict`, `dirty`, `secrets_found` (do not bypass with `--allow-secrets` unless the user confirms it's a false alarm), `already_pushed`, `needs_confirmation`, `needs_choice`, `no_such_workspace`, `nothing_to_undo`.

## Useful commands

| Goal | Command |
|---|---|
| What's going on | `gitbuddy state --json` |
| Save everything | `gitbuddy done "message" --json` |
| Save some files | `gitbuddy done "message" --only path/a --only path/b --json` |
| Share | `gitbuddy send --json` / `gitbuddy sync --json` |
| Juggle tasks | `gitbuddy work "name"`, `gitbuddy switch "name"`, `gitbuddy list --json` |
| Roll back | `gitbuddy undo [snapshot_id]` |
| All commands | `gitbuddy commands --json` |
| Raw git | `gitbuddy git <args>` (no safety net) |
