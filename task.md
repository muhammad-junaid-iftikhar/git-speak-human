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

- [x] **`gitbuddy save` commits instead of saving progress.** `done` has `save` as an alias and comes first in the list, so `save` runs `done`. Remove the duplicate alias, and fail at startup if two commands share a name or alias.
- [x] **`work "new thing"` stores your *current* work under the *new* name.** Start "dark-mode", then run `work "fix-button"`, and the dark-mode changes are saved as "fix-button". Track the active workspace and save under the right name.
- [x] **`save` (checkpoint) removes your changes from your files.** `git stash push` takes the changes out of the working folder. A checkpoint has to leave the files alone (use `git stash create` + `git stash store`, or a hidden commit ref).
- [x] **Shell injection and quote bugs.** Commit messages and work names are pasted into a shell string, so `gitbuddy done "it's fixed"` breaks and `$(...)` would run. Replace `execSync(string)` with `Bun.spawnSync([...args])` everywhere.
- [x] **`run()` calls `process.exit` on any error**, so no command can recover, explain the failure, or try again. Return `{ ok, stdout, stderr, code }` instead.
- [x] **`oops` breaks in several cases:** it fails on the first commit, rewrites commits that were already pushed, and does nothing for uncommitted changes. Replace it with the real undo system (Phase 3).
- [x] **`switch` matches by substring.** `switch "fix"` picks whichever item matches first. Use exact names, and on a near match ask "did you mean…?".
- [x] **The `stash@{N}` index changes after an auto-save**, so the index computed earlier can point at the wrong item. Look items up by a stable id, not a list position.
- [x] `git add .` only covers the current folder. Use `git add -A` and `stash -u` so new files are included.
- [x] `get` runs `git pull origin` with no branch and no upstream check. Handle missing upstream, diverged history and conflicts in plain English.
- [x] Remove the unused `parseArgs` import. Delete the `dist`/`build` script or make it work.
- [x] Startup checks: is git installed? Are we inside a repo? (If not, offer to make one.) Is git `user.name`/`user.email` set? (If not, ask once.)

## Phase 1 — Foundation (P1)

- [x] Split `cli.ts` into `src/commands/*`, `src/git.ts` (the only place that runs git), `src/ui.ts` (all output), `src/state.ts`.
- [x] Typed git layer: `git(args, opts)` → result. Parse porcelain v2 output (`status --porcelain=v2 -z`, `log --format`) instead of scraping human output.
- [x] One command registry that drives help, completion, `--json` schemas, docs and the agent manifest.
- [x] gitbuddy state lives in `.git/gitbuddy/` (never committed): active workspace, snapshot journal, settings.
- [x] Global config at `~/.config/gitbuddy/config.json`: profile, theme, emoji on/off, language.
- [x] Global flags: `--explain` (show the real git commands), `--dry-run`, `--json`, `--quiet`, `--yes`, `--no-fun`, `--no-color`.
- [x] Exit codes: 0 ok · 1 user error · 2 conflict, needs a human · 3 git missing or not a repo · 4 network/auth.
- [x] Tests: `bun test` against throwaway repos in a temp folder, plus a fake remote (bare repo) for send/get.
- [x] CI on GitHub Actions: macOS, Linux and Windows; git 2.30 and the latest git.

## Phase 2 — Workspaces: many tasks at once, no branches (P1)

The main idea: users see **workspaces**, not branches or stashes.

- [x] Store each workspace as a real hidden ref, `refs/gitbuddy/work/<name>`, not in the stash list. Refs don't shift index, they show up in reflog, and they survive `git stash clear`.
- [x] `gitbuddy work "name"`: save the current workspace, then start a new one from the latest main.
- [x] `gitbuddy switch "name"`: save the current workspace, restore the target exactly (staged, unstaged and new files).
- [x] `gitbuddy list` / `my-work`: table with name, last touched ("2 hours ago" plus the date), number of changed files, a short summary, and which one is active.
- [x] `gitbuddy rename`, `gitbuddy drop` (asks first; dropped items go to the trash for 30 days), `gitbuddy peek "name"` (see a workspace's diff without switching).
- [x] `gitbuddy get` while you have unsaved work: snapshot → pull → reapply. Conflicts are explained, never silently lost.
- [x] `gitbuddy done` inside a workspace: commit to main, then archive the workspace.
- [ ] Optional mode, `gitbuddy config workspaces=branches`: back workspaces with real branches for teams that use PRs. Same commands for the user.
- [x] Auto-save (optional): `gitbuddy config set autosave_minutes 10` snapshots the active workspace on any gitbuddy command once N minutes have passed.

## Phase 3 — Safety net: you can't break it (P1)

- [x] **Snapshot journal:** before any command that changes history or files, record HEAD, the index, the working tree (`stash create`) and refs in `.git/gitbuddy/journal`.
- [x] `gitbuddy undo`: reverse the last gitbuddy action, whatever it was. `gitbuddy undo 3` or `gitbuddy undo --list` to pick one.
- [x] `gitbuddy redo`.
- [x] `gitbuddy rescue`: find lost work from reflog, dangling commits and old stashes, and show it in plain English ("a save from Tuesday 3pm with 4 files").
- [x] `gitbuddy trash` / `restore`: deleted files and dropped workspaces stay recoverable.
- [x] Pushed-commit guard: never rewrite pushed history without a clear warning. Offer a safe "reverse it" commit instead.
- [x] Before sending: block secrets (.env, keys, tokens) and huge files, and offer to add them to `.gitignore`.
- [x] `gitbuddy doctor`: check git version, identity, SSH/HTTPS auth, remote reachability, line endings and large files, and fix what it can.

## Phase 4 — All of git, in human words (P1/P2)

Each row gets a command, plain-English output, `--explain` and `--json`.

**Starting**
- [x] `gitbuddy new` (init plus a sensible .gitignore picked by detecting the project type) · `gitbuddy copy <url>` (clone) · `gitbuddy connect <url>` (add remote, or create a GitHub repo with `gh`)

**Everyday**
- [x] `gitbuddy show` (status grouped as new / changed / deleted / ready-to-save, with tips)
- [x] `gitbuddy diff` / `what-changed [file]`: pretty diff, word-level when useful
- [x] `gitbuddy done "msg"`: commit. Pick files with `--only <files>`, or interactively.
- [x] `gitbuddy done` with no message: suggest one from the diff (optional local or LLM provider; works without AI too)
- [x] `gitbuddy fix-last "new msg"` / `--add file`: amend, only if not pushed
- [x] `gitbuddy send` (push; set upstream automatically) · `gitbuddy get` (pull, rebase by default, explained)
- [x] `gitbuddy sync`: get plus send in one step

**History and finding things**
- [x] `gitbuddy history`: readable timeline with relative dates and authors, filter by file, person or date
- [x] `gitbuddy who <file>[:line]`: blame in plain English
- [x] `gitbuddy find "text"`: search code across history (`log -S`, `grep`)
- [x] `gitbuddy when-broke`: guided bisect ("does it work now? y/n")
- [x] `gitbuddy go-back <file> [to <when>]`: restore a file from the past ("yesterday", "3 saves ago")
- [x] `gitbuddy time-travel <when>`: look at the whole project in the past without breaking anything, and come back safely

**Fixing mistakes**
- [x] `gitbuddy throw-away [file]`: discard changes, with a snapshot first
- [x] `gitbuddy unsave`: uncommit and keep the changes
- [x] `gitbuddy reverse <save>`: revert a pushed commit safely
- [x] `gitbuddy ignore <file|pattern>`: add to .gitignore and untrack if already tracked
- [x] `gitbuddy forget-file`: remove a secret from history (guided `filter-repo`, with big warnings)

- [x] `gitbuddy done --pick`: choose files for a save (save commit by commit)
- [x] `gitbuddy view <save>`: look inside one save (files, sent or not, how to revert)
- [x] `gitbuddy compare`: fetch, then show saves only local / only on remote, "100% in sync" check; `show` lists unsent saves
- [x] `gitbuddy catch-up`: bring the latest origin/main into the current branch
- [x] `gitbuddy match-remote`: make the branch exactly like the remote, keeping extra work aside
- [x] `gitbuddy send --branch <name>` / `gitbuddy share --branch <name>`

**Teamwork**
- [x] Conflict helper: list conflicted files, show "yours vs theirs" side by side, choose per file or open the editor, then continue
- [x] `gitbuddy share`: open a PR/MR (GitHub `gh`, GitLab `glab`) with a title and body made from the commits
- [x] `gitbuddy review <pr>`: check out someone's PR into a temporary workspace
- [x] `gitbuddy combine` (merge/squash) · `gitbuddy tidy` (interactive rebase as a simple "reorder / squash / reword" list)
- [x] `gitbuddy grab <save>`: cherry-pick

**Releases and extras**
- [x] `gitbuddy release v1.2.0`: tag, changelog from commits, push tags
- [x] `gitbuddy versions` (aliases: tags, releases)
- [ ] Submodules, worktrees, LFS, sparse checkout: wrapped later (P3), clearly labelled as advanced. For now: `gitbuddy git submodule …` etc.
- [x] `gitbuddy clean-up`: prune merged branches, stale remotes, gc
- [x] `gitbuddy git <anything>`: pass straight through to git as an escape hatch

## Phase 5 — Fun, personality and profile (P2)

- [x] **Interactive mode:** running `gitbuddy` alone opens a friendly prompt (`🐙 gitbuddy ›`) with a menu of what you can do *right now*, based on repo state. Numbered picker plus type-any-command (arrow keys: later).
- [x] Random greetings, tips and ASCII mascots on start. Changes daily. Never more than 2 lines. Off with `--no-fun` or when not a TTY.
- [x] **Profile** in `~/.config/gitbuddy/profile.json`: name, avatar emoji, favourite theme. First run asks 2 questions, max 15 seconds.
- [x] **Stats and streaks:** saves today, day streak, lines added this week, "most productive hour". `gitbuddy me` shows a profile card.
- [x] **Achievements:** first save, first send, 7-day streak, "survived a conflict", "used undo like a pro", 100 saves… shown as small toasts.
- [x] Themes: `classic`, `neon`, `pastel`, `mono`, `pirate` 🏴‍☠️. Respect `NO_COLOR`.
- [x] Spinners and progress bars for network operations. Celebrate a send with a short confetti line.
- [x] Friendly error personality: "Uh-oh, your teammate changed the same line 🤝. Let's sort it out together →", followed by the exact next step.
- [x] Shell completions for zsh, bash, fish and PowerShell, including workspace names.
- [x] Optional prompt segment (starship/p10k) showing the active workspace and unsaved count.

## Phase 6 — Built for AI agents and LLMs (P1)

- [x] `--json` on every command: stable, versioned schema (`{ ok, command, data, warnings, next_steps }`). Never mixed with emoji or colour.
- [x] Auto-detect non-TTY or `CI` / `GITBUDDY_AGENT=1`: no prompts, no fun, no spinners. Fail with a clear code instead of hanging.
- [x] `gitbuddy commands --json`: machine-readable manifest of every command, its args, flags, side effects and whether it's destructive or undoable.
- [x] `gitbuddy state --json`: one call that returns everything an agent needs (branch, workspace, changes, ahead/behind, conflicts, last snapshot id).
- [x] **MCP server**: `gitbuddy mcp` exposes the commands as tools for Claude, Cursor and similar. Destructive tools are marked, and all of them return snapshot ids for undo.
- [x] `AGENTS.md` / `llms.txt` in the repo: short guide for agents ("always call `state` first; use `undo <id>` to roll back").
- [x] Every mutating command returns a `snapshot_id`, so an agent can always roll back its own action.
- [x] Deterministic output: no random text in `--json` mode; times in ISO 8601.

## Phase 7 — Distribution: install once, it just works (P1)

- [ ] **Needs you:** create an npm token, add it as the `NPM_TOKEN` secret and set the repo variable `PUBLISH_NPM=true`; the release workflow then publishes on every tag. Publish to npm under a free name (check whether `gitbuddy` is taken; fallback `@<scope>/gitbuddy` or `gitbuddy-cli`). Install with `bun add -g` or `npm i -g`.
- [x] Single-file binaries with `bun build --compile` for macOS (arm64/x64), Linux (x64/arm64) and Windows, attached to GitHub Releases.
- [x] One-line installer: `curl -fsSL https://…/install.sh | sh` (and a PowerShell version).
- [ ] Homebrew tap, Scoop bucket, AUR (P2).
- [x] `gitbuddy update`: self-update, with a gentle "new version available" notice at most once a day.
- [x] Release automation: tag → CI builds binaries → GitHub Release → npm publish.

## Phase 8 — Docs, community, world (P2)

- [x] README rewrite: install line, top commands, "for git pros" cheatsheet. (10-second GIF still to record.)
- [x] `gitbuddy learn`: optional 5-minute interactive tutorial in a sandbox repo.
- [x] Cheatsheet page (git ↔ gitbuddy) in CHEATSHEET.md. (Docs site: later.)
- [ ] Translations of all messages (start with en, es, de, ur, hi, ar, pt, zh). Strings go in `src/i18n/`.
- [x] LICENSE file (MIT), CONTRIBUTING.md, issue templates, CODE_OF_CONDUCT.
- [ ] Opt-in, anonymous usage stats only if ever needed. Off by default.

## Phase 9 — Everyday pain points from real use (P0)

**1. Push/pull clashes and protected main**
- [x] `send` first checks the remote. If teammates pushed to the same branch, it gets their saves, puts yours on top (snapshot first), then sends. No more "rejected, fetch first".
- [x] If the push is still rejected because someone pushed in between, retry automatically once.
- [x] Protected branches: if the remote refuses a push to `main` (protected branch), move your saves to a new branch, send it, open a PR, and reset local `main` to match the remote, all in one go.
- [x] `gitbuddy protect main`: treat a branch as protected up front, so `send` goes straight to the PR flow (also learned automatically after a refusal).

**2. Try someone else's branch without touching your work**
- [x] `gitbuddy try <branch>`: fetch it, make a local copy, tuck your unsaved work away and switch to the copy. `gitbuddy back` returns you exactly where you were.
- [x] `gitbuddy try <branch> --folder`: put the copy in a separate folder (git worktree), so you can run its tests side by side without switching at all.
- [x] `gitbuddy try` with no name: pick from remote branches sorted by latest activity, with author.
- [x] `gitbuddy try --refresh`: pull new saves on the branch you're trying.
- [x] `gitbuddy try --clean-up`: remove try-folders and copies.

**3. Revert made easy, including a revert PR**
- [ ] Rename `reverse` to `revert` (keep `reverse` as an alias).
- [ ] `gitbuddy revert` with no argument: pick from recent saves and merged PRs.
- [ ] `gitbuddy revert --pr 42`: find what PR #42 merged and revert all of it.
- [ ] `gitbuddy revert <a>..<b>` / several ids: revert multiple saves as one.
- [ ] On a protected/default branch with a remote, revert opens a revert PR automatically: branch from the latest `origin/main`, revert there, send, open the PR, then bring you back. `--here` reverts locally instead.
- [ ] Explain before doing it: which saves and files will be reverted.

**4. Proper versions**
- [ ] `gitbuddy --version` / `-v` work, and `gitbuddy version` shows git, Bun, install method and whether an update is available.
- [ ] Bump to 0.2.0, write CHANGELOG.md, tag `v0.2.0` and publish a GitHub Release with binaries via the release workflow, so the one-line installers work.

**5. Terminal themes: a whole look in one pick**
- [ ] A theme is one JSON file (`themes/<name>.json`): Terminal.app colors (background, text, cursor, selection, 16 ANSI colors), font and size, opacity/blur, Starship prompt, zsh extras (autosuggestion and syntax-highlighting colors, history settings), recommended tools, and the gitbuddy palette.
- [ ] `gitbuddy theme`: list themes with a colour preview. `gitbuddy theme <name>` applies everything: creates the Terminal.app profile and makes it the default, updates open windows, installs the prompt and zsh extras through one managed line in `~/.zshrc`, and offers to install missing fonts/tools with brew.
- [ ] Before the first apply, save your current setup as a theme (`my-original`), so `gitbuddy theme my-original` always takes you back.
- [ ] `gitbuddy theme save <name>`: capture your current Terminal.app profile, Starship config and zsh extras into a theme file you can share.
- [ ] `gitbuddy theme random` and `gitbuddy theme daily on`: a new look every day for people who get bored.
- [ ] Built-in themes: `juni` (your current setup), dracula, nord, tokyo-night, catppuccin-mocha, gruvbox, solarized-dark, synthwave, rose-pine, pirate.
- [ ] Community themes: anyone adds `themes/<name>.json` by PR (guide in CONTRIBUTING.md, validated in CI). `gitbuddy theme --online` lists the latest from GitHub.
- [ ] Later: iTerm2, Ghostty, Warp, Windows Terminal, GNOME Terminal backends.

---

## Suggested order

1. Phase 0 (bugs) → 2. Phase 1 (foundation and tests) → 3. Phase 3 (safety net) → 4. Phase 2 (workspaces on safe refs) → 5. Phase 6 (`--json`, agent mode) → 6. Phase 7 (ship binaries) → 7. Phase 4 commands, one group at a time → 8. Phase 5 fun → 9. Phase 8.
