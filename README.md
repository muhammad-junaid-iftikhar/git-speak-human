# 🎤 buddy

Git for humans. Just talk to your buddy.

## Install

```bash
bun install -g git-speak-human
```

## Use It

```bash
buddy done "I added a button"      # Save your work
buddy send                          # Send to team
buddy get                           # Get latest
buddy show                          # See what changed
buddy start my-feature              # Start new work
buddy switch main                   # Switch branches
buddy oops                          # Undo last action
buddy what-happened                 # See recent changes
```

## Commands

| Command | Aliases | What it does |
|---------|---------|--------------|
| `done` | `save`, `s`, `commit` | Save your work with a message |
| `send` | `push`, `p` | Send your work to the team |
| `get` | `pull`, `update` | Get the latest work from the team |
| `show` | `status`, `st`, `check` | Show what you changed |
| `start` | `begin`, `new`, `branch` | Start a new piece of work |
| `switch` | `go`, `move`, `checkout` | Switch to another piece of work |
| `oops` | `undo`, `revert` | Undo your last action |
| `what-happened` | `history`, `log`, `timeline` | See what everyone did recently |
| `stash` | `save-for-later`, `pause` | Save work temporarily without committing |
| `my-stashes` | `stashes`, `saved`, `list-stash` | See all your saved work |
| `get-back` | `restore-stash`, `pop` | Get back your most recent saved work |

## Examples

**Save and send your work:**
```bash
buddy done "Fixed the login bug"
buddy send
```

**Get latest changes:**
```bash
buddy get
```

**Start a new feature:**
```bash
buddy start dark-mode
# Now you're on the dark-mode branch
buddy done "Added dark theme"
buddy send
```

**See what you changed:**
```bash
buddy show
```

**Undo a mistake:**
```bash
buddy oops
```

**Save work for later (without committing):**
```bash
buddy stash "still working on this feature"
# Switch to another branch, do other work
buddy get
buddy switch my-feature
buddy get-back              # Get your saved work back
```

**See all your saved work:**
```bash
buddy my-stashes
```

---

That's it. No git knowledge needed. Just speak what you want to do.
