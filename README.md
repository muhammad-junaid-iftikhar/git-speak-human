# 🎤 gitbuddy

Git for humans. Work on multiple things at once. No branches. Just work.

## Install

```bash
bun install -g github:muhammad-junaid-iftikhar/git-speak-human
```

## Use It

```bash
gitbuddy work "dark-mode"              # Start work 1
gitbuddy save                          # Save progress
gitbuddy work "fix-button"             # Switch to work 2 (auto-saves work 1)
gitbuddy my-work                       # See all your work with dates
gitbuddy switch "dark-mode"            # Go back to work 1
gitbuddy done "ready to go"            # Commit to main
gitbuddy send                          # Push to team
gitbuddy get                           # Get latest changes
```

## Commands

| Command | Aliases | What it does |
|---------|---------|--------------|
| `work` | `start-work`, `create` | Start a new piece of work (auto-saves current) |
| `save` | `checkpoint`, `progress` | Save your progress (without committing) |
| `my-work` | `work-list`, `list-work`, `tasks` | See all your work items with timestamps |
| `switch` | `switch-to`, `go` | Switch to another piece of work |
| `done` | `commit` | Commit your work to main |
| `send` | `push`, `p` | Send your work to the team |
| `get` | `pull`, `update` | Get the latest work from the team |
| `show` | `status`, `st`, `check` | Show what you changed |
| `oops` | `undo`, `revert` | Undo your last action |
| `what-happened` | `history`, `log`, `timeline` | See what everyone did recently |

## Workflow Example

**Work on multiple things at once (all on main):**

```bash
# Start work 1
gitbuddy work "dark-mode feature"
# Make changes...
gitbuddy save          # Save progress

# Switch to work 2 (automatically saves work 1)
gitbuddy work "fix-login-button"
# Make changes...
gitbuddy save

# See all your work with timestamps
gitbuddy my-work
# Output:
#   stash@{0}: WORK: fix-login-button [Oct 3 2:45pm]
#   stash@{1}: WORK: dark-mode feature [Oct 3 2:30pm]

# Go back to work 1
gitbuddy switch "dark-mode"
# Continue where you left off...
gitbuddy save

# Ready to commit? Send to team
gitbuddy done "dark-mode feature complete"
gitbuddy send

# Get latest changes from team
gitbuddy get

# See what changed
gitbuddy show

# Made a mistake? Undo it
gitbuddy oops
```

**The magic:** Everything stays on `main`. No branches. No confusion. Just work on multiple things, save progress, switch between them.

---

That's it. No git knowledge needed. Just speak what you want to do.
