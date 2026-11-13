# ai-skills

Personal agent skills, one folder per skill under `skills/`. Each skill has a `SKILL.md` (Claude Code) and an `agents/openai.yaml` (Codex).

Install a skill by symlinking its folder:

```sh
ln -s ~/dev/ai-skills/skills/<name> ~/.claude/skills/<name>
ln -s ~/dev/ai-skills/skills/<name> ~/.agents/skills/<name>
```

A skill only a person starts sets `disable-model-invocation: true` in `SKILL.md` and `policy.allow_implicit_invocation: false` in `agents/openai.yaml`. Set both or neither.

| Skill | What it does |
|---|---|
| `trim-scope` | Cut what agreed scope doesn't need from a ticket, spec or conversation, then apply the cuts you pick. |
| `flow-video` | Make a silent, text-led HyperFrames video of how a PR, commit, range or uncommitted change works: one request as a sequence diagram, traced at method-signature level, with its error codes, complexity hotspots and a human-review checklist. |
