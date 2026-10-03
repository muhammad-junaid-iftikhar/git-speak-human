# Contributing to gitbuddy

Thanks for helping make git friendlier for everyone!

## Setup

```bash
git clone https://github.com/muhammad-junaid-iftikhar/git-speak-human.git
cd git-speak-human
bun install
bun src/cli.ts help        # run from source
bun test                   # end-to-end tests in throwaway repos
```

## How the code is organised

| Path | What's there |
|---|---|
| `src/cli.ts` | entry point |
| `src/main.ts` | argument handling, running a command, JSON result |
| `src/registry.ts` | command definitions (`define({...})`) and option parsing |
| `src/git.ts` | the only place that runs git; turns git errors into plain English |
| `src/repo.ts` | repo facts: status, branches, upstream, "when" parsing |
| `src/snapshot.ts` | snapshots and the undo journal |
| `src/workspaces.ts` | workspaces (hidden refs under `refs/gitbuddy/work/`) |
| `src/guard.ts` | secrets and big-file checks |
| `src/ui.ts`, `src/theme.ts`, `src/fun.ts` | output, colours, themes, profile, achievements |
| `src/commands/*.ts` | one file per group of commands |
| `tests/` | `bun test` suites using `tests/helpers.ts` sandboxes |

## Adding a command

1. Pick the right file in `src/commands/` and call `define({...})`.
2. Fill in `summary`, `args`, `options`, `examples` and the flags `mutates`, `destructive`, `undoable` and `network`. Agents, help, completion and MCP all read these.
3. Call `record("name", "before …")` before changing anything, so `gitbuddy undo` works.
4. Run every git call through `git()` from `src/git.ts` with `{ mutates: true }` when it changes something (this is what makes `--dry-run` and `--explain` work).
5. Put machine-readable results in `ctx.data` and human output through `ui`.
6. Add a test in `tests/`.

## Writing style

- Plain English. No "HEAD", "detached", "refspec" in normal output.
- Every error says what happened **and** what to do next (`hint`).
- Fun is welcome, but never slow and never shown to agents.

## Adding a terminal theme

Anyone can add a theme. A theme is one JSON file in `themes/` and covers Terminal.app colors and font, the Starship prompt, zsh suggestion and syntax colors, history settings, recommended tools, and gitbuddy's own colors.

1. Easiest: set up your terminal the way you like it, then run `gitbuddy theme save my-theme`. That writes `~/.config/gitbuddy/themes/my-theme.json`.
2. Or copy `themes/dracula.json` and change the colors.
3. Put the file in `themes/` (file name = `name`), run `bun scripts/themes-index.ts` to validate it and update `themes/index.json`, and open a pull request.

Fields:

| Field | What |
|---|---|
| `name`, `title`, `author`, `description` | lowercase-dash name, display name, you, one line |
| `terminal.background/foreground/cursor/selection/bold` | `#rrggbb` |
| `terminal.ansi` | 16 colors: black, red, green, yellow, blue, magenta, cyan, white, then the bright versions |
| `terminal.font` | `{ "name": PostScript name, "size": 13, "fallback": "SFMono-Regular", "brew": "font-…-nerd-font" }` |
| `terminal.opacity/blur/cursorShape/blink/spacing/columns/rows` | optional window details |
| `terminal.baseProfile` | use a built-in Terminal profile (e.g. `"Basic"`) instead of colors |
| `prompt.starship` | a full `starship.toml`, or `"auto"` to generate one from your colors; `null` keeps the user's prompt |
| `shell` | `autosuggestColor`, `syntax` (zsh-syntax-highlighting styles), `history`, `aliases` (only set if the tool is installed), `extra` |
| `tools` | e.g. `["starship", "eza", "zsh-autosuggestions"]`; gitbuddy offers to `brew install` missing ones |
| `gitbuddy` | `accent/ok/warn/err/dim` as `#rrggbb`, plus an optional `mascot` emoji |

## Releasing

Run `gitbuddy release X.Y.Z`. Pushing the tag triggers `.github/workflows/release.yml`, which builds the binaries.
