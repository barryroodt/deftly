# Cross-repo interface discovery

Loaded from core SKILL.md Step 1.6. For each pair of cloned repos,
discover how they connect.

## Prompt template

For each pair `(repo-A, repo-B)` in the discovered set, ask the user:

> "How does {repo-A} connect to {repo-B}? (API calls, shared types,
> binary dependencies, env vars, SQL, RPC — or 'no direct connection')"

Skip pairs the user says have no connection. Record all interfaces
for use in:
- The architect skill (`.agents/skills/architect/SKILL.md`, Step 2.7)
- `architecture/ARCHITECTURE.md` (Step 3.2 Cross-Repo Interface
  Contracts section)

## Shortcut: extract from fetched docs

If the user says "check the docs" or if Phase 1.3-fetched documents
already describe the interfaces, extract directly from those docs
instead of asking pair-by-pair. Categories to look for in the docs:
- API endpoints (HTTP method, path, request/response shape)
- RPC methods (name, parameters, return type)
- SQL functions (signature, who calls them)
- Env vars (name, who sets, who reads)
- Binary dependencies (what's packaged where)

If the docs cover only some pairs, ask only about the remaining pairs.
