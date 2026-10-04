---
name: gitbuddy
description: Use gitbuddy for any git task in a project: saving work, sending or getting changes, branches and pull requests, undoing or reverting, finding who changed what, testing a teammate's branch, syncing with GitHub, and switching between tasks. gitbuddy is a safe, plain-English layer over git that snapshots before every change.
---

# gitbuddy

gitbuddy wraps git with plain-English commands. Prefer it over raw git when it has a command for the job, because every change it makes can be undone.

## Ground rules

1. **Start with state.** Run `gitbuddy state --json` before acting. It returns branch, workspace, changes, conflicts, unfinished operations, remote, and whether undo is available.
2. **Use JSON.** Add `--json` to every command. Read `ok`, `exit_code`, `data`, `next_steps`, `snapshot_id`, and `error` (with `code` and `hint`).
3. **Never bypass safety without asking.** Do not add `--allow-secrets`, `--force`, or `--yes` unless the user has confirmed. `needs_confirmation` means the user must say yes; `secrets_found` means something looks like a key or password.
4. **Keep the snapshot id.** Every changing command returns `snapshot_id`. Report it so the user or you can roll back with `gitbuddy undo <snapshot_id>`.
5. **Preview first when unsure.** `--dry-run` prints the real git commands without running them. `--explain` shows them while running.
6. **Check for new commands.** If a task needs something not listed here, run `gitbuddy commands --json` and use what it reports, since newer versions may add commands.
7. **No prompts.** Without a terminal gitbuddy never asks questions. If a command needs a choice, it fails with `needs_choice` and lists options.

Exit codes: `0` ok · `1` user error · `2` conflict needs a human · `3` setup (git missing, not a repo) · `4` network or login.

## Recipes

**See the situation**
- `gitbuddy state --json`: everything at once.
- `gitbuddy show --json`: changed files, saves not sent yet, sync status.
- `gitbuddy diff [file]`: the exact changed lines.
- `gitbuddy compare --json`: what's only here, only on GitHub, or whether you're 100% in sync.

**Save work**
- `gitbuddy done "message" --json`: save everything as one save.
- `gitbuddy done "message" --only path/a --only path/b --json`: save only some files (use this for one-commit-at-a-time work).
- `gitbuddy fix-last "new message"` or `--add file`: fix the last save if it hasn't been sent.
- `gitbuddy unsave`: take back the last save, keep the changes in files.

**Send and get**
- `gitbuddy send --json`: send saves. Handles teammates' new saves and protected branches automatically.
- `gitbuddy send --branch feature/x --json`: send to a named branch, stay on the current one.
- `gitbuddy get --json`: bring in the team's latest work.
- `gitbuddy sync --json`: get, then send.
- `gitbuddy catch-up --json`: bring the latest main into the current branch.
- `gitbuddy match-remote --yes --json`: make the local branch exactly match GitHub. Unsaved work goes to a workspace and unsent saves to a `backup/...` branch. Destructive, so confirm first.

**Pull requests**
- `gitbuddy share "title" --json`: move saves onto a branch and open a pull request (`--branch name`, `--draft`, `--base`).
- `gitbuddy review <number> --json`: check out someone's pull request locally. Return with `gitbuddy back`.
- `gitbuddy try <branch> --json`: test a teammate's branch as a copy. `--folder` uses a separate folder. `--refresh` gets their newest saves. `--clean-up` removes copies.

**Workspaces (many tasks, no branches)**
- `gitbuddy work "name" --json`: start a task; current work is kept safe.
- `gitbuddy switch "name" --json`: jump to another task.
- `gitbuddy list --json`: all tasks with dates and changed-file counts.
- `gitbuddy save --json`: checkpoint without making it permanent.
- `gitbuddy peek "name" --json`: see another task's changes without switching.
- `gitbuddy drop "name" --yes` / `gitbuddy restore "name"`: throw away or restore a task.

**Undo and revert**
- `gitbuddy undo --json`: undo the last gitbuddy action. `gitbuddy undo --list` shows them. `gitbuddy redo` reverses an undo.
- `gitbuddy throw-away [files] --yes`: discard unsaved changes (undoable).
- `gitbuddy revert <id|last|a..b> --json`: cancel one or more saves. On `main` or a protected branch this opens a revert pull request. Add `--here` to revert locally.
- `gitbuddy revert --pr <number> --json`: revert everything a merged pull request brought in.
- `gitbuddy rescue --json`: find and recover lost work (dropped stashes, old saves).
- `gitbuddy tidy drop|reword|squash <id> ...`: tidy saves that haven't been sent.

**History and investigation**
- `gitbuddy history [file] --json`: timeline of saves (`--by`, `--since`, `--grep`).
- `gitbuddy view <id|last> --json`: one save's message, files, and whether it was sent.
- `gitbuddy who <file>[:line] --json`: who wrote a file or line.
- `gitbuddy find "text" --json`: search current code and history.
- `gitbuddy go-back <file> to "yesterday" --json`: restore a file from the past (undoable).
- `gitbuddy time-travel "last week"` then `gitbuddy back`: look at the past safely.
- `gitbuddy when-broke --good <rev> --run "test command" --json`: find the save that broke a test.

**Conflicts**
- `gitbuddy conflicts --json`: list clashing files and both sides.
- `gitbuddy keep mine|theirs|both <file>`: settle one file. Use `--all` for every file.
- `gitbuddy continue --json`: finish the merge, rebase, or cherry-pick.
- `gitbuddy abort`: cancel and return to before.

**Other**
- `gitbuddy ignore <pattern>`: stop tracking files (for secrets and build output).
- `gitbuddy branches --json`, `gitbuddy protect <branch>`: list branches, mark protected ones.
- `gitbuddy release X.Y.Z --json`: changelog, version tag, and push.
- `gitbuddy doctor --json`: check git, login, remote, and setup.
- `gitbuddy git <args>`: run any raw git command with no safety net. Use only when no gitbuddy command fits.
- `gitbuddy commands --json`: the full list of commands with their side effects.

## Typical flows

**Finish and share a change on a protected main**
```
gitbuddy state --json
gitbuddy done "Add login rate limit" --json
gitbuddy send --json          # opens a pull request automatically on protected main
```

**Something went wrong after sending**
```
gitbuddy view last --json     # check the save
gitbuddy revert last --json   # opens a revert pull request on main
```

**Test a teammate's branch without touching your work**
```
gitbuddy try feature/their-work --folder --json
# run the tests in the folder it prints
gitbuddy try --clean-up --json
```

**Conflict during get or send**
```
gitbuddy conflicts --json
gitbuddy keep mine src/app.ts --json      # or theirs / both; ask the user which side if unclear
gitbuddy continue --json
```

## What not to do

- Don't use `git reset --hard`, `git push --force`, or `git clean` directly. Use `throw-away`, `match-remote` (confirmed), or `send --force` (confirmed).
- Don't skip the secrets check. If it blocks a save, add the file to `.gitignore` with `gitbuddy ignore <file>`.
- Don't rewrite saves that were already sent. Use `revert`.
- When a choice belongs to the user (which side of a conflict, which branch name, whether to overwrite), ask them.
