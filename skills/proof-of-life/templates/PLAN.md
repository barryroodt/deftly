# Plan: <task>

Machine-readable schedule: `PLAN.json`

## Contract

Decide these facts before dispatch:

- Interfaces: <function shapes, file formats, or message contracts>
- Data ownership: <what each owned path contains>
- Naming: <project conventions>
- Error behavior: <failure and handover conventions>
- Integration order: <branch gates and final observable behavior>

## Tree

Use this section to explain decomposition. `PLAN.json` remains the source of node IDs, kinds, dependencies, ownership, tiers, gates, root, and concurrency.

- 1 <task>
  - 1.1 <branch>
    - 1.1.1 <leaf>
    - 1.1.2 <leaf>
  - 1.2 <branch>

## Status log

Append only. Record plan validation, dispatch, return, verification, failure, and handover events. Do not copy the current state table here.

- <timestamp or step> plan written and contract fixed
