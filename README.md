# 🎤 buddy

Git for humans. Work on multiple things at once. No branches. Just work.

## Install

```bash
bun install -g git-speak-human
```

## Use It

```bash
buddy work "dark-mode"              # Start work 1
buddy save                          # Save progress
buddy work "fix-button"             # Switch to work 2 (auto-saves work 1)
buddy my-work                       # See all your work with dates
buddy switch "dark-mode"            # Go back to work 1
buddy done "ready to go"            # Commit to main
buddy send                          # Push to team
buddy get                           # Get latest changes
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
buddy work "dark-mode feature"
# Make changes...
buddy save          # Save progress

# Switch to work 2 (automatically saves work 1)
buddy work "fix-login-button"
# Make changes...
buddy save

# See all your work with timestamps
buddy my-work
# Output:
#   stash@{0}: WORK: fix-login-button [Oct 3 2:45pm]
#   stash@{1}: WORK: dark-mode feature [Oct 3 2:30pm]

# Go back to work 1
buddy switch "dark-mode"
# Continue where you left off...
buddy save

# Ready to commit? Send to team
buddy done "dark-mode feature complete"
buddy send

# Get latest changes from team
buddy get

# See what changed
buddy show

# Made a mistake? Undo it
buddy oops
```

**The magic:** Everything stays on `main`. No branches. No confusion. Just work on multiple things, save progress, switch between them.

---

That's it. No git knowledge needed. Just speak what you want to do.
