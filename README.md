# 🎤 git-speak-human

Git for people who don't know git. Just speak what you want to do.

## Install

```bash
bun install -g git-speak-human
```

## Use It

```bash
speak save "I added a button"      # Save your work
speak push                          # Send changes to team
speak pull                          # Get latest changes
speak status                        # See what you changed
speak start my-feature              # Start new work
speak switch main                   # Switch branches
speak undo                          # Undo last save
speak history                       # See recent changes
```

## Commands

| Command | Aliases | What it does |
|---------|---------|--------------|
| `save` | `s`, `commit` | Save your changes with a message |
| `push` | `p`, `send` | Send changes to the team |
| `pull` | `get`, `update` | Get latest changes from team |
| `status` | `st`, `check` | See what you've changed |
| `start` | `branch`, `new` | Start a new piece of work |
| `switch` | `go`, `checkout` | Switch to another branch |
| `undo` | `revert` | Undo your last changes |
| `history` | `log`, `timeline` | See recent changes |

## Examples

**Save and push your work:**
```bash
speak save "Fixed the login bug"
speak push
```

**Get latest changes:**
```bash
speak pull
```

**Start a new feature:**
```bash
speak start dark-mode
# Now you're on the dark-mode branch
speak save "Added dark theme"
speak push
```

**See what you changed:**
```bash
speak status
```

**Undo a mistake:**
```bash
speak undo
```

---

That's it. No git knowledge needed. Just speak what you want to do.
