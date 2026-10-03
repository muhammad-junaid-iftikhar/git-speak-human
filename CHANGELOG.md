# Changelog

## v0.2.0 · 2026-10-03

First public release: plain-English git with undo for everything, workspaces without branches, smart send that handles teammates and protected branches, revert pull requests, try-a-branch, terminal themes, and an MCP server for AI agents.

- Tick version tasks in task.md (fa822b0)
- Add gitbuddy --version / -v and a detailed version command (c8030a1)
- Bundle built-in themes into the program so standalone binaries have them (eabcf31)
- Add terminal themes: one pick restyles colors, font, prompt and shell (6962c4b)
- Add gitbuddy revert: revert saves, ranges or a whole PR, via a revert PR on main (0db036e)
- Add gitbuddy try: test anyone's branch as a local copy or in its own folder (775c364)
- Make send handle teammates' saves and protected branches (d61153b)
- Plan phase 9: push/pull clashes, protected main, try branches, revert PRs, versions, terminal themes (dbe921d)
- Add branch sending, file picking, save viewer and remote sync checks (467da46)
- Fix menu freezing after a command: write output synchronously, no update check inside the menu (e2c60be)
- Run when-broke test commands with sh -c on every platform (a6733d4)
- Run when-broke test commands through git's own shell so they work on Windows (a521cc7)
- Fix when-broke on newer git, which quotes 'bad' in bisect output (0226951)
- Include bisect output in when-broke error details (405ffaa)
- Print details when the when-broke test fails (47f9c0b)
- Read when-broke result from bisect log so it works on every git version (135cf79)
- Add docs: README, git cheatsheet, license, contributing, issue templates (e3603a9)
- Add release pipeline, standalone binaries and one-line installers (a87944c)
- Make gitbuddy fun: menu, profile, streaks, achievements, themes (75205f2)
- Cover the rest of git in plain words (7b9b1e8)
- Add agent mode: state, commands manifest, MCP server, AGENTS.md (33dee9d)
- Add safety net, conflict helper, tests and CI (1d0d015)
- Rebuild gitbuddy core: safe git layer, snapshots, real workspaces (6f4693f)
- Rename to gitbuddy and add task.md roadmap (3b7f080)
- Redesign: multi-work workflow without branches (85326d3)
- Add stash support: save work without losing it (7888207)
- Make it human: rename to 'buddy' command with natural language (5aff10f)
- Initial commit: git-speak-human CLI tool (5ca70e0)
