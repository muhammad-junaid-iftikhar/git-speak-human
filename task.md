# gitbuddy — Task List

**Goal:** A free, fun, human wrapper over *all* of git. Beginners never need to learn git. Long-time git users switch because it's faster and safer. AI agents can drive it reliably.

**Rules we build by**
1. **Never lose work.** Every command that could destroy something takes a snapshot first. Everything can be undone.
2. **Plain English in, plain English out.** No "HEAD", "detached", "rebase", "refspec" in normal output. Power users can still see the real git command with `--explain`.
3. **Fun but fast.** Personality never slows down a command or gets in an agent's way.
4. **Real git underneath.** A gitbuddy repo is a normal git repo. Anyone can stop using gitbuddy at any time and nothing breaks.

Priority: **P0** = must fix now · **P1** = needed for v1 · **P2** = makes it great · **P3** = later

---

## Phase 0 — Fix what's broken today (P0)

Bugs in the current `src/cli.ts`:

- [ ] **`gitbuddy save` commits instead of saving progress.** `done` has `save` as an alias and comes first in the list, so `save` runs `done`. Remove the duplicate alias, and fail at startup if two commands share a name or alias.
- [ ] **`work "new thing"` stores your *current* work under the *new* name.** Start "dark-mode", then run `work "fix-button"`, and the dark-mode changes are saved as "fix-button". Track the active workspace and save under the right name.
- [ ] **`save` (checkpoint) removes your changes from your files.** `git stash push` takes the changes out of the working folder. A checkpoint has to leave the files alone (use `git stash create` + `git stash store`, or a hidden commit ref).
- [ ] **Shell injection and quote bugs.** Commit messages and work names are pasted into a shell string, so `gitbuddy done "it's fixed"` breaks and `$(...)` would run. Replace `execSync(string)` with `Bun.spawnSync([...args])` everywhere.
- [ ] **`run()` calls `process.exit` on any error**, so no command can recover, explain the failure, or try again. Return `{ ok, stdout, stderr, code }` instead.
- [ ] **`oops` breaks in several cases:** it fails on the first commit, rewrites commits that were already pushed, and does nothing for uncommitted changes. Replace it with the real undo system (Phase 3).
- [ ] **`switch` matches by substring.** `switch "fix"` picks whichever item matches first. Use exact names, and on a near match ask "did you mean…?".
- [ ] **The `stash@{N}` index changes after an auto-save**, so the index computed earlier can point at the wrong item. Look items up by a stable id, not a list position.
- [ ] `git add .` only covers the current folder. Use `git add -A` and `stash -u` so new files are included.
- [ ] `get` runs `git pull origin` with no branch and no upstream check. Handle missing upstream, diverged history and conflicts in plain English.
- [ ] Remove the unused `parseArgs` import. Delete the `dist`/`build` script or make it work.
- [ ] Startup checks: is git installed? Are we inside a repo? (If not, offer to make one.) Is git `user.name`/`user.email` set? (If not, ask once.)

## Phase 1 — Foundation (P1)

- [ ] Split `cli.ts` into `src/commands/*`, `src/git.ts` (the only place that runs git), `src/ui.ts` (all output), `src/state.ts`.
- [ ] Typed git layer: `git(args, opts)` → result. Parse porcelain v2 output (`status --porcelain=v2 -z`, `log --format`) instead of scraping human output.
- [ ] One command registry that drives help, completion, `--json` schemas, docs and the agent manifest.
- [ ] gitbuddy state lives in `.git/gitbuddy/` (never committed): active workspace, snapshot journal, settings.
- [ ] Global config at `~/.config/gitbuddy/config.json`: profile, theme, emoji on/off, language.
- [ ] Global flags: `--explain` (show the real git commands), `--dry-run`, `--json`, `--quiet`, `--yes`, `--no-fun`, `--no-color`.
- [ ] Exit codes: 0 ok · 1 user error · 2 conflict, needs a human · 3 git missing or not a repo · 4 network/auth.
- [ ] Tests: `bun test` against throwaway repos in a temp folder, plus a fake remote (bare repo) for send/get.
- [ ] CI on GitHub Actions: macOS, Linux and Windows; git 2.30 and the latest git.

## Phase 2 — Workspaces: many tasks at once, no branches (P1)

The main idea: users see **workspaces**, not branches or stashes.

- [ ] Store each workspace as a real hidden ref, `refs/gitbuddy/work/<name>`, not in the stash list. Refs don't shift index, they show up in reflog, and they survive `git stash clear`.
- [ ] `gitbuddy work "name"`: save the current workspace, then start a new one from the latest main.
- [ ] `gitbuddy switch "name"`: save the current workspace, restore the target exactly (staged, unstaged and new files).
- [ ] `gitbuddy list` / `my-work`: table with name, last touched ("2 hours ago" plus the date), number of changed files, a short summary, and which one is active.
- [ ] `gitbuddy rename`, `gitbuddy drop` (asks first; dropped items go to the trash for 30 days), `gitbuddy peek "name"` (see a workspace's diff without switching).
- [ ] `gitbuddy get` while you have unsaved work: snapshot → pull → reapply. Conflicts are explained, never silently lost.
- [ ] `gitbuddy done` inside a workspace: commit to main, then archive the workspace.
- [ ] Optional mode, `gitbuddy config workspaces=branches`: back workspaces with real branches for teams that use PRs. Same commands for the user.
- [ ] Auto-save timer (optional): quietly snapshot the active workspace every N minutes.

## Phase 3 — Safety net: you can't break it (P1)

- [ ] **Snapshot journal:** before any command that changes history or files, record HEAD, the index, the working tree (`stash create`) and refs in `.git/gitbuddy/journal`.
- [ ] `gitbuddy undo`: reverse the last gitbuddy action, whatever it was. `gitbuddy undo 3` or `gitbuddy undo --list` to pick one.
- [ ] `gitbuddy redo`.
- [ ] `gitbuddy rescue`: find lost work from reflog, dangling commits and old stashes, and show it in plain English ("a save from Tuesday 3pm with 4 files").
- [ ] `gitbuddy trash` / `restore`: deleted files and dropped workspaces stay recoverable.
- [ ] Pushed-commit guard: never rewrite pushed history without a clear warning. Offer a safe "reverse it" commit instead.
- [ ] Before sending: block secrets (.env, keys, tokens) and huge files, and offer to add them to `.gitignore`.
- [ ] `gitbuddy doctor`: check git version, identity, SSH/HTTPS auth, remote reachability, line endings and large files, and fix what it can.

## Phase 4 — All of git, in human words (P1/P2)

Each row gets a command, plain-English output, `--explain` and `--json`.

**Starting**
- [ ] `gitbuddy new` (init plus a sensible .gitignore picked by detecting the project type) · `gitbuddy copy <url>` (clone) · `gitbuddy connect <url>` (add remote, or create a GitHub repo with `gh`)

**Everyday**
- [ ] `gitbuddy show` (status grouped as new / changed / deleted / ready-to-save, with tips)
- [ ] `gitbuddy diff` / `what-changed [file]`: pretty diff, word-level when useful
- [ ] `gitbuddy done "msg"`: commit. Pick files with `--only <files>`, or interactively.
- [ ] `gitbuddy done` with no message: suggest one from the diff (optional local or LLM provider; works without AI too)
- [ ] `gitbuddy fix-last "new msg"` / `--add file`: amend, only if not pushed
- [ ] `gitbuddy send` (push; set upstream automatically) · `gitbuddy get` (pull, rebase by default, explained)
- [ ] `gitbuddy sync`: get plus send in one step

**History and finding things**
- [ ] `gitbuddy history`: readable timeline with relative dates and authors, filter by file, person or date
- [ ] `gitbuddy who <file>[:line]`: blame in plain English
- [ ] `gitbuddy find "text"`: search code across history (`log -S`, `grep`)
- [ ] `gitbuddy when-broke`: guided bisect ("does it work now? y/n")
- [ ] `gitbuddy go-back <file> [to <when>]`: restore a file from the past ("yesterday", "3 saves ago")
- [ ] `gitbuddy time-travel <when>`: look at the whole project in the past without breaking anything, and come back safely

**Fixing mistakes**
- [ ] `gitbuddy throw-away [file]`: discard changes, with a snapshot first
- [ ] `gitbuddy unsave`: uncommit and keep the changes
- [ ] `gitbuddy reverse <save>`: revert a pushed commit safely
- [ ] `gitbuddy ignore <file|pattern>`: add to .gitignore and untrack if already tracked
- [ ] `gitbuddy forget-file`: remove a secret from history (guided `filter-repo`, with big warnings)

**Teamwork**
- [ ] Conflict helper: list conflicted files, show "yours vs theirs" side by side, choose per file or open the editor, then continue
- [ ] `gitbuddy share`: open a PR/MR (GitHub `gh`, GitLab `glab`) with a title and body made from the commits
- [ ] `gitbuddy review <pr>`: check out someone's PR into a temporary workspace
- [ ] `gitbuddy combine` (merge/squash) · `gitbuddy tidy` (interactive rebase as a simple "reorder / squash / reword" list)
- [ ] `gitbuddy grab <save>`: cherry-pick

**Releases and extras**
- [ ] `gitbuddy release v1.2.0`: tag, changelog from commits, push tags
- [ ] `gitbuddy tags`, `gitbuddy versions`
- [ ] Submodules, worktrees, LFS, sparse checkout: wrapped later (P3), clearly labelled as advanced
- [ ] `gitbuddy clean-up`: prune merged branches, stale remotes, gc
- [ ] `gitbuddy git <anything>`: pass straight through to git as an escape hatch

## Phase 5 — Fun, personality and profile (P2)

- [ ] **Interactive mode:** running `gitbuddy` alone opens a friendly prompt (`🐙 gitbuddy ›`) with a menu of what you can do *right now*, based on repo state. Arrow-key picker plus type-to-search.
- [ ] Random greetings, tips and ASCII mascots on start. Changes daily. Never more than 2 lines. Off with `--no-fun` or when not a TTY.
- [ ] **Profile** in `~/.config/gitbuddy/profile.json`: name, avatar emoji, favourite theme. First run asks 2 questions, max 15 seconds.
- [ ] **Stats and streaks:** saves today, day streak, lines added this week, "most productive hour". `gitbuddy me` shows a profile card.
- [ ] **Achievements:** first save, first send, 7-day streak, "survived a conflict", "used undo like a pro", 100 saves… shown as small toasts.
- [ ] Themes: `classic`, `neon`, `pastel`, `mono`, `pirate` 🏴‍☠️. Respect `NO_COLOR`.
- [ ] Spinners and progress bars for network operations. Celebrate a send with a short confetti line.
- [ ] Friendly error personality: "Uh-oh, your teammate changed the same line 🤝. Let's sort it out together →", followed by the exact next step.
- [ ] Shell completions for zsh, bash, fish and PowerShell, including workspace names.
- [ ] Optional prompt segment (starship/p10k) showing the active workspace and unsaved count.

## Phase 6 — Built for AI agents and LLMs (P1)

- [ ] `--json` on every command: stable, versioned schema (`{ ok, command, data, warnings, next_steps }`). Never mixed with emoji or colour.
- [ ] Auto-detect non-TTY or `CI` / `GITBUDDY_AGENT=1`: no prompts, no fun, no spinners. Fail with a clear code instead of hanging.
- [ ] `gitbuddy commands --json`: machine-readable manifest of every command, its args, flags, side effects and whether it's destructive or undoable.
- [ ] `gitbuddy state --json`: one call that returns everything an agent needs (branch, workspace, changes, ahead/behind, conflicts, last snapshot id).
- [ ] **MCP server**: `gitbuddy mcp` exposes the commands as tools for Claude, Cursor and similar. Destructive tools are marked, and all of them return snapshot ids for undo.
- [ ] `AGENTS.md` / `llms.txt` in the repo: short guide for agents ("always call `state` first; use `undo <id>` to roll back").
- [ ] Every mutating command returns a `snapshot_id`, so an agent can always roll back its own action.
- [ ] Deterministic output: no random text in `--json` mode; times in ISO 8601.

## Phase 7 — Distribution: install once, it just works (P1)

- [ ] Publish to npm under a free name (check whether `gitbuddy` is taken; fallback `@<scope>/gitbuddy` or `gitbuddy-cli`). Install with `bun add -g` or `npm i -g`.
- [ ] Single-file binaries with `bun build --compile` for macOS (arm64/x64), Linux (x64/arm64) and Windows, attached to GitHub Releases.
- [ ] One-line installer: `curl -fsSL https://…/install.sh | sh` (and a PowerShell version).
- [ ] Homebrew tap, Scoop bucket, AUR (P2).
- [ ] `gitbuddy update`: self-update, with a gentle "new version available" notice at most once a day.
- [ ] Release automation: tag → CI builds binaries → GitHub Release → npm publish.

## Phase 8 — Docs, community, world (P2)

- [ ] README rewrite: 10-second GIF, install line, 5 commands, "for git pros" section mapping git → gitbuddy.
- [ ] `gitbuddy learn`: optional 5-minute interactive tutorial in a sandbox repo.
- [ ] Cheatsheet page (git ↔ gitbuddy), docs site.
- [ ] Translations of all messages (start with en, es, de, ur, hi, ar, pt, zh). Strings go in `src/i18n/`.
- [ ] LICENSE file (MIT), CONTRIBUTING.md, issue templates, CODE_OF_CONDUCT.
- [ ] Opt-in, anonymous usage stats only if ever needed. Off by default.

---

## Suggested order

1. Phase 0 (bugs) → 2. Phase 1 (foundation and tests) → 3. Phase 3 (safety net) → 4. Phase 2 (workspaces on safe refs) → 5. Phase 6 (`--json`, agent mode) → 6. Phase 7 (ship binaries) → 7. Phase 4 commands, one group at a time → 8. Phase 5 fun → 9. Phase 8.
