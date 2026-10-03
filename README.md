# 🐙 gitbuddy

**Git, but human.** Plain-English commands on top of real git. You can't lose work, everything can be undone, and you can juggle several tasks without ever touching a branch.

```bash
gitbuddy work "dark mode"        # start a task
gitbuddy done "Add dark theme"   # save it for good
gitbuddy send                    # share it with your team
gitbuddy undo                    # changed your mind? undo anything
```

New to git? You never have to learn it. Been using git for years? gitbuddy is faster, safer, and still plain git underneath (`--explain` shows every real command).

## Install

Pick one:

```bash
# With Bun
bun install -g github:muhammad-junaid-iftikhar/git-speak-human

# macOS / Linux, no Bun needed
curl -fsSL https://raw.githubusercontent.com/muhammad-junaid-iftikhar/git-speak-human/main/install.sh | sh

# Windows PowerShell
irm https://raw.githubusercontent.com/muhammad-junaid-iftikhar/git-speak-human/main/install.ps1 | iex
```

Then type `gitbuddy` on its own to get a friendly menu, or `gitbuddy learn` for a 5-minute hands-on tutorial.

## The 10 commands you'll actually use

| You want to… | Type |
|---|---|
| See what's going on | `gitbuddy show` |
| Save your changes for good | `gitbuddy done "what you did"` |
| Send them to your team | `gitbuddy send` |
| Get your team's latest work | `gitbuddy get` |
| Do both at once | `gitbuddy sync` |
| Start a new task (current one is kept safe) | `gitbuddy work "name"` |
| Jump to another task | `gitbuddy switch "name"` |
| See all your tasks | `gitbuddy list` |
| Undo whatever you just did | `gitbuddy undo` |
| Fix clashing changes | `gitbuddy conflicts` |
| Check you're exactly in sync with GitHub | `gitbuddy compare` |

## Juggle tasks without branches

```bash
gitbuddy work "dark mode"      # make some changes…
gitbuddy work "fix login"      # dark mode is put away safely, fresh start
gitbuddy get                   # pull the team's latest any time
gitbuddy list                  # ▶ fix login · dark mode (2 changed files, 3 min ago)
gitbuddy switch "dark mode"    # exactly where you left it
```

Each workspace remembers its own changes, including new files. Everything stays on `main`. When you're ready, `gitbuddy done` saves it and `gitbuddy share` opens a pull request.

## Branches when you want them

```bash
gitbuddy done "Fix login" --pick         # choose which files go into this save
gitbuddy send --branch feature/login     # send your saves to a branch (you stay on main)
gitbuddy share --branch feature/login    # …or send and open a pull request in one go
gitbuddy compare                         # what's only here, what's only on GitHub
gitbuddy catch-up                        # bring the latest main into your branch
gitbuddy match-remote                    # make your copy exactly GitHub's (extra work kept aside)
gitbuddy view a1b2c3d                    # look inside a save, then revert/unsave it
```

## You can't break it

- **Snapshot before every change.** `gitbuddy undo` reverses any gitbuddy action; `gitbuddy undo --list` shows them all; `gitbuddy redo` puts it back.
- **`gitbuddy rescue`** finds work you thought was lost: dropped stashes, rewritten saves, old snapshots.
- **Secrets guard.** `.env` files, private keys and API tokens are blocked before they're saved or sent.
- **Sent saves are protected.** gitbuddy won't rewrite history your team already has; it offers `gitbuddy revert` instead.
- **`gitbuddy doctor`** checks git, your login, the remote and big files.

## Everything else

| Area | Commands |
|---|---|
| Start | `new` · `copy <url>` · `connect <url>` · `connect --github` |
| Everyday | `show` · `diff` · `done` (`--pick`, `--only`) · `send` (`--branch`) · `get` · `sync` · `compare` · `catch-up` · `match-remote` · `fix-last` |
| Workspaces | `work` · `switch` · `list` · `save` · `peek` · `rename` · `drop` |
| Safety | `undo` · `redo` · `rescue` · `trash` · `restore` · `doctor` |
| History | `history` · `view <save>` · `who file:42` · `find "text"` · `go-back file to yesterday` · `time-travel "last week"` · `back` · `when-broke` |
| Fixing | `throw-away` · `unsave` · `revert` (`--pr 42`) · `ignore` · `forget-file` |
| Teamwork | `conflicts` · `keep mine/theirs/both` · `continue` · `abort` · `share` (`--branch`) · `review 42` · `combine` · `grab` · `tidy` · `branches` |
| Releases | `release 1.2.0` · `versions` · `clean-up` · `git <anything>` |
| You | `me` · `setup` · `config` · `learn` · `completion` · `prompt` · `update` |

`gitbuddy help <command>` explains any of them. Every command takes `--explain`, `--dry-run`, `--json`, `--yes`, `--quiet` and `--no-fun`.

**Coming from git?** See [CHEATSHEET.md](CHEATSHEET.md).

## Fun included

Type `gitbuddy` alone for a menu that adapts to your project. You get a profile with an avatar, levels, day streaks and 18 achievements (`gitbuddy me`), plus random tips and themes (`gitbuddy config set theme neon|pastel|pirate|mono`). Prefer it quiet? `gitbuddy config set fun false`.

## Terminal themes

Bored of your terminal? One command restyles everything: Terminal.app colors, font, transparency, your Starship prompt, zsh suggestion and syntax colors, history settings, and gitbuddy's own colors.

```bash
gitbuddy theme                 # pick from the list (with color previews)
gitbuddy theme tokyo-night     # apply one
gitbuddy theme random          # surprise me
gitbuddy theme daily on        # a new look every day
gitbuddy theme save my-setup   # turn your current setup into a theme you can share
gitbuddy theme my-original     # back to how it was before gitbuddy
```

Built in: dracula, nord, tokyo-night, catppuccin-mocha, gruvbox, solarized-dark, rose-pine, synthwave, pirate, juni. Anyone can add more: a theme is one JSON file (see [CONTRIBUTING.md](CONTRIBUTING.md#adding-a-terminal-theme)), and `gitbuddy theme --online` lists the newest from GitHub. Terminal colors currently support macOS Terminal.app; the prompt and shell parts work in any terminal running zsh.

## For AI agents

gitbuddy is built to be driven by agents too:

```bash
claude mcp add gitbuddy -- gitbuddy mcp     # MCP server with safety annotations
gitbuddy state --json                       # everything about the repo in one call
gitbuddy commands --json                    # every command, its args and side effects
```

Every changing command returns a `snapshot_id` you can pass to `gitbuddy undo`. gitbuddy never prompts without a terminal. See [AGENTS.md](AGENTS.md).

## AI commit messages (optional)

`gitbuddy done` with no message suggests one from your changes. To use an AI model, point gitbuddy at any command that reads a diff on stdin and prints a message:

```bash
gitbuddy config set ai_command "claude -p"
```

## How it works

A gitbuddy project is a normal git repo. Workspaces and snapshots are stored as hidden git refs under `refs/gitbuddy/`, and settings live in `.git/gitbuddy/`. Nothing is ever committed for you, and you can stop using gitbuddy at any time without losing anything.

## Contributing

Bug reports and ideas are very welcome; see [CONTRIBUTING.md](CONTRIBUTING.md) and the roadmap in [task.md](task.md).

MIT licensed.
