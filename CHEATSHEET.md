# git → gitbuddy cheatsheet

For people who already know git. Every gitbuddy command is plain git underneath. Add `--explain` to see the exact commands, or `--dry-run` to only print them.

| git | gitbuddy | what's different |
|---|---|---|
| `git init` | `gitbuddy new` | uses `main`, writes a `.gitignore` for your stack |
| `git clone <url>` | `gitbuddy copy <url>` | `owner/repo` shorthand for GitHub |
| `git remote add origin <url>` | `gitbuddy connect <url>` | `--github` creates the repo via `gh` |
| `git status` | `gitbuddy show` | grouped by new/changed/deleted, ahead/behind, next step |
| `git diff HEAD` | `gitbuddy diff` | includes untracked files; `--words`, `--since yesterday` |
| `git add -A && git commit -m` | `gitbuddy done "msg"` | secrets/large-file guard, message suggestion, undoable |
| `git commit --amend` | `gitbuddy fix-last` | refuses if already pushed (unless `--force`) |
| `git push` | `gitbuddy send` | sets upstream, scans outgoing commits for secrets |
| `git push origin HEAD:feature/x` | `gitbuddy send --branch feature/x` | stays on your current branch |
| `git add -p` / pick files + commit | `gitbuddy done "msg" --pick` | numbered file picker; `--only <file>` for scripts |
| `git fetch && git status -sb` + logs | `gitbuddy compare` | lists saves only local / only remote, "100% in sync" check |
| `git fetch && git rebase origin/main` | `gitbuddy catch-up` | merges instead if your saves were already pushed |
| `git fetch && git reset --hard origin/<b>` | `gitbuddy match-remote` | parks unsaved work in a workspace, unsent saves on a backup branch, undoable |
| `git show <rev>` | `gitbuddy view <id\|last>` | files, sent or not, and how to revert it |
| `git push --force-with-lease` | `gitbuddy send --force` | asks first |
| `git pull --rebase --autostash` | `gitbuddy get` | snapshot first, conflicts explained |
| pull + push | `gitbuddy sync` | |
| `git stash` / `git switch` | `gitbuddy work` / `gitbuddy switch` | named workspaces stored as refs, include untracked files, never reorder |
| `git stash list` | `gitbuddy list` | names, dates, changed-file counts |
| `git stash show -p` | `gitbuddy peek "name"` | |
| `git reflog` + `git reset` | `gitbuddy undo` | any gitbuddy action, incl. workspace changes; `redo` too |
| `git fsck --lost-found` | `gitbuddy rescue` | lists lost stashes/commits, brings them back |
| `git log` | `gitbuddy history` | `--by`, `--since`, `--grep`, marks unsent saves |
| `git blame` | `gitbuddy who file[:line]` | per-author summary or one line |
| `git grep` + `git log -S` | `gitbuddy find "text"` | now and in history |
| `git restore --source=<rev> file` | `gitbuddy go-back file to "3 days ago"` | natural dates, "2 saves ago" |
| `git switch --detach <rev>` | `gitbuddy time-travel <when>` / `back` | tucks away changes, brings them back |
| `git bisect` | `gitbuddy when-broke` | yes/no questions, or `--run "cmd"` |
| `git restore . && git clean -fd` | `gitbuddy throw-away` | snapshot first, so it's undoable |
| `git reset --soft HEAD~1` | `gitbuddy unsave` | push guard |
| `git revert` | `gitbuddy revert <id\|last\|--pr 42>` | several saves or a whole PR; opens a revert PR on main/protected branches (`--here` to stay local) |
| `.gitignore` + `git rm --cached` | `gitbuddy ignore <pattern>` | |
| `git filter-repo --invert-paths` | `gitbuddy forget-file <path>` | keeps your remote configured |
| `git checkout --ours/--theirs` | `gitbuddy keep mine\|theirs\|both` | "mine" is always *your* side, even during rebase |
| `git rebase/merge --continue` | `gitbuddy continue` | auto-stages files with no markers left |
| `git rebase/merge --abort` | `gitbuddy abort` | |
| `gh pr create` | `gitbuddy share` | works from `main`: moves your saves to a branch for you |
| `gh pr checkout` | `gitbuddy review <n>` / `back` | |
| `git merge` | `gitbuddy combine <branch>` | `--squash` |
| `git cherry-pick` | `gitbuddy grab <id>` | |
| `git rebase -i` | `gitbuddy tidy squash\|reword\|drop\|edit` | only touches unsent saves |
| `git tag -a` + changelog | `gitbuddy release 1.2.0` | updates CHANGELOG.md and package.json, `--publish` |
| `git branch -d <merged>` + `gc` | `gitbuddy clean-up` | also empties old trash |
| anything else | `gitbuddy git <args>` | straight passthrough |
