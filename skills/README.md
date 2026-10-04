# gitbuddy skill

One file, `gitbuddy/SKILL.md`, teaches an AI assistant how to use gitbuddy safely: which command to use, how to read its JSON, and what never to do.

Install it once and your assistant can handle git tasks in plain English.

## Claude Code

Personal (all projects):

```bash
mkdir -p ~/.claude/skills && cp -R skills/gitbuddy ~/.claude/skills/
```

Or straight from GitHub:

```bash
mkdir -p ~/.claude/skills/gitbuddy && curl -fsSL https://raw.githubusercontent.com/muhammad-junaid-iftikhar/git-speak-human/main/skills/gitbuddy/SKILL.md -o ~/.claude/skills/gitbuddy/SKILL.md
```

Then ask: "use gitbuddy to save and send my changes". Claude loads the skill when the task matches its description.

## OpenCode, Cursor, Codex and other agents that read `AGENTS.md`

Copy the rules into your project's `AGENTS.md`:

```bash
cat skills/gitbuddy/SKILL.md >> AGENTS.md
```

Or put `skills/gitbuddy/SKILL.md` in the agent's skills folder if it supports the same `SKILL.md` format.

## ChatGPT (custom GPT or Projects)

1. Create a custom GPT (or a Project), then open its **Instructions** / **Project instructions**.
2. Paste the whole contents of `SKILL.md` (everything after the `---` block at the top is the important part; keeping the top is fine too).
3. In the GPT's Actions/tools, nothing else is needed. ChatGPT can't run commands on your computer, so use it to plan and write commands. Run them in your own terminal and paste the output back.

## Any other LLM (chat or API)

Paste `SKILL.md` as the system prompt. For tools that can run shell commands (such as an agent with a terminal), the assistant can run `gitbuddy … --json` directly and read the results.

## Make sure it can run gitbuddy

The assistant needs `gitbuddy` on its PATH:

```bash
bun install -g github:muhammad-junaid-iftikhar/git-speak-human
gitbuddy --version
```

Or use the standalone installer: `curl -fsSL https://raw.githubusercontent.com/muhammad-junaid-iftikhar/git-speak-human/main/install.sh | sh`.

## Keeping it up to date

The skill documents the commands in this repo. When a new version adds commands, `gitbuddy commands --json` always shows the current list, and the skill tells the assistant to check it.
