# skills.sh Publishing Repository — Design

**Date:** 2026-05-17
**Owner:** barry@jumptag.co.za
**Status:** Approved, ready for implementation planning

## Purpose

Create a new git repository (`skills.sh`) that holds Claude Code-compatible Skills authored by the owner and is published to the [skills.sh](https://skills.sh) registry for distribution.

Users install skills via:

```bash
npx skills add <owner>/skills.sh
```

Claude Code users can additionally install via the plugin marketplace flow.

## Scope

### In scope

- Repository scaffold only. No skills are authored yet.
- Standard `SKILL.md` folder convention (compatible with `anthropics/skills`).
- Authoring ergonomics: template + a small scaffold script for new skills.
- Optional Claude Code plugin marketplace metadata so the repo doubles as a `/plugin marketplace add` target.

### Out of scope (YAGNI)

- CI validation of skill frontmatter — defer until skill count grows.
- Category subfolders inside `skills/` — flat until > 10 skills.
- Custom `registry.json` or similar manifest — skills.sh discovers folders directly.
- Pre-populating with imported skills — content decisions deferred.

## Repository Layout

```
skills.sh/
├── README.md                       # what the repo is, install command, skill index
├── LICENSE                          # Apache-2.0
├── .gitignore                       # OS + editor noise
├── .claude-plugin/
│   └── marketplace.json             # enables `/plugin marketplace add` in Claude Code
├── skills/
│   └── .gitkeep                     # placeholder; per-skill folders land here
├── template/
│   └── SKILL.md                     # starter SKILL.md with frontmatter
└── scripts/
    └── new-skill.sh                 # scaffolds a new skill folder from template
```

## Component Details

### `README.md`

Sections:

1. One-line description.
2. Install command (`npx skills add <owner>/skills.sh`).
3. Claude Code plugin install instructions (alternative path).
4. Skill index — auto-maintained list of skills in `skills/` with one-line descriptions. Manual updates until skill count justifies automation.
5. Contributing / authoring notes (link to `template/SKILL.md` and `scripts/new-skill.sh`).
6. License.

### `LICENSE`

Apache-2.0. Matches `anthropics/skills` and dominant convention in the ecosystem; permissive and compatible with downstream installation into private projects.

### `.gitignore`

Standard macOS + common editor/tooling noise: `.DS_Store`, `*.swp`, `.idea/`, `.vscode/`, `node_modules/`. No project-specific build artifacts expected.

### `.claude-plugin/marketplace.json`

Minimal marketplace manifest exposing the repo as a Claude Code plugin marketplace, so Claude Code users get a second install path alongside `npx skills add`. The marketplace lists a single plugin whose `skills/` directory points to the repo's `skills/` folder.

Exact schema follows the Claude Code plugin marketplace spec; this file is finalised during implementation against the current spec version.

### `skills/`

Empty at scaffold time. Each future skill is a sibling folder containing at minimum a `SKILL.md`. Optional supporting files (scripts, references) live inside the skill's own folder.

### `template/SKILL.md`

Reference template with:

- YAML frontmatter (`name`, `description`).
- Clear placeholder copy explaining what each section is for.
- Example sections: purpose, when to use, examples, guidelines.
- A comment at the top noting it is a template and should be copied, not edited in place.

### `scripts/new-skill.sh`

Small POSIX shell script:

- Usage: `./scripts/new-skill.sh <skill-name>`.
- Validates the name (lowercase, hyphen-separated, no spaces).
- Refuses to overwrite an existing folder.
- Copies `template/SKILL.md` to `skills/<skill-name>/SKILL.md`.
- Pre-fills the `name:` frontmatter field with the supplied name.
- Prints next-step hints (edit description, add examples).

Kept intentionally simple — no Node dependency, no template engine.

## Install Paths (User-Facing)

### Via skills.sh

```bash
npx skills add <owner>/skills.sh
```

Discovers all skill folders under `skills/` and installs them into the user's configured agent.

### Via Claude Code plugin marketplace

```bash
/plugin marketplace add <owner>/skills.sh
/plugin install <plugin-name>@<marketplace-name>
```

Both paths read the same `skills/` directory; no duplication of skill content.

## Authoring Workflow

1. Run `./scripts/new-skill.sh my-skill-name`.
2. Edit `skills/my-skill-name/SKILL.md` — fill in description, examples, guidelines.
3. Add supporting files in the same folder if needed.
4. Update `README.md` skill index with the new entry.
5. Commit and push. Skills.sh re-indexes from the GitHub repo.

## Open Questions

None blocking implementation. The exact field set for `.claude-plugin/marketplace.json` is resolved during implementation against the current Claude Code marketplace spec.

## Non-Goals

- This repository does not implement or host the skills.sh registry itself; it is a *consumer* of that registry's publishing convention.
- No automated publishing pipeline beyond `git push`.
