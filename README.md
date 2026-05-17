# deftly

A collection of [Agent Skills](https://github.com/anthropics/skills/tree/main/spec) authored by Barry Roodt. Skills follow the open Agent Skills spec and work with any compatible AI coding agent.

## Install

### Via skills.sh (any supported agent)

```bash
npx skills add barryroodt/deftly
```

The skills.sh CLI installs every skill under `skills/` into your configured agent.

### Via Claude Code plugin marketplace

```bash
/plugin marketplace add barryroodt/deftly
/plugin install deftly@deftly
```

## Skills

This index lists every skill in `skills/`. Update it whenever you add or remove a skill.

| Skill | Description |
| ----- | ----------- |
| [`agent-team-review`](./skills/agent-team-review/) | Parallel multi-agent code review using Agent Teams. |
| [`weekly-review`](./skills/weekly-review/) | Generates a weekly recap from Linear, Notion, and GitHub activity. |

## Authoring

To add a new skill:

```bash
./scripts/new-skill.sh my-skill-name
```

This copies `template/SKILL.md` into `skills/my-skill-name/SKILL.md`, pre-fills the `name:` frontmatter, and prints next steps. Edit the copy, add supporting files in the same folder if needed, update the skill index above, then commit.

The template lives in `template/SKILL.md`. See [Anthropic's Agent Skills spec](https://github.com/anthropics/skills/tree/main/spec) for the full frontmatter contract.

## Repository layout

```
deftly/
├── .claude-plugin/marketplace.json   # Claude Code marketplace manifest
├── skills/                           # one folder per skill
├── template/SKILL.md                 # starter template
├── scripts/new-skill.sh              # scaffolder
└── scripts/test_new_skill.sh         # test harness for the scaffolder
```

## License

Apache License 2.0. See [LICENSE](./LICENSE).
