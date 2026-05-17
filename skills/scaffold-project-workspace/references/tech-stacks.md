# Tech-stack detection table

Loaded from core SKILL.md Step 2.4. For each cloned repo, check for
the marker files below and record detected stacks. Output: the set of
`Allow Rules` strings to hand to each adapter in Step 2.5.

| File Found | Stack | Allow Rules |
|---|---|---|
| `package.json` + `bun.lockb` | Bun | `bun install`, `bun install *`, `bun test *`, `bun run *` |
| `package.json` + `pnpm-lock.yaml` | pnpm | `pnpm install`, `pnpm install *`, `pnpm test *`, `pnpm run *`, `pnpm start *` |
| `package.json` + `package-lock.json` | npm | `npm install`, `npm install *`, `npm test *`, `npm run *` |
| `package.json` + `yarn.lock` | yarn | `yarn install`, `yarn install *`, `yarn test *`, `yarn run *` |
| `Cargo.toml` | Rust | `cargo build`, `cargo build *`, `cargo test *`, `cargo check *`, `cargo clippy *` |
| `Cargo.toml` containing `pgrx` | pgrx | Above + `cargo pgrx test *`, `cargo pgrx run *` |
| `Makefile` | Make | `make`, `make *` |
| `Dockerfile` or `docker-bake.hcl` | Docker | `docker build *`, `docker run *`, `docker bake *`, `docker images *`, `docker ps *` |
| `go.mod` | Go | `go *`, `go`, `golangci-lint *`, `gopls *`, `dlv *` |
| `requirements.txt` or `pyproject.toml` | Python | `python *`, `pip install *`, `pytest *` |

After detection, present the stack list to the user for confirmation
before passing to adapters.

Allow-rule strings are Claude Code-flavored glob patterns. The CC
adapter consumes them verbatim. Other adapters translate to their
permission model (Codex: sandbox-mode + approval policy; Gemini:
trust + tool-exclusions; Copilot: no translation needed).
