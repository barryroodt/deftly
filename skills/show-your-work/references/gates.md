# Gate file format

Adapted from [unlazy v2](https://github.com/Leonxlnx/unlazy) by Leonxlnx under the MIT License.

A gate file is the machine-readable contract between a completion claim and observed evidence.

## Format

```markdown
# Gates: example

- [ ] G1: observable outcome
  CHECK: node check.mjs
  EXPECT: /8\/8 passed/
  EVIDENCE: pending

- [ ] G2: manual outcome
  EVIDENCE: pending

ABANDON: G2 external system is unavailable
```

## Parsing rules

- A gate starts with `- [ ]`, `- [x]`, or `- [X]`.
- The token before the first colon is its stable ID.
- Indented `CHECK`, `EXPECT`, and `EVIDENCE` lines belong to the preceding gate.
- Plain `EXPECT` text must occur in combined standard output and error output.
- `/pattern/flags` uses a JavaScript regular expression.
- Without `EXPECT`, exit code zero decides success.
- Checked gates with missing or pending evidence remain unmet.
- `ABANDON: <id> <reason>` creates an explicit terminal non-success outcome.

## Checker modes

| Mode | Behavior |
|---|---|
| default | Run unchecked or evidence-pending runnable gates and update evidence. |
| `--verify` | Re-run every runnable gate, including checked gates. |
| `--status` | Parse and report without executing commands or changing files. |
| `--strict` | Return non-success when any gate is abandoned. |
| `--contract-hash` | Print one SHA-256 contract fingerprint per file without executing commands or changing files. |
| `--jobs N` | Run up to N distinct checks concurrently. |

Equal `CHECK` strings share one execution during a checker run. Each gate still evaluates its own `EXPECT`.

The contract fingerprint covers gate IDs, titles, `CHECK`, and `EXPECT`. Checkbox state, `EVIDENCE` lines, and `ABANDON` entries are runtime outcomes and stay outside the fingerprint. Gate runs and honest abandonment reports never change it; strict verification already turns abandonment into a distinct terminal result.

## Exit codes

- `0`: all gates met, or all resolved under compatible non-strict abandonment behavior
- `1`: unmet gates remain
- `2`: usage or parse error
- `3`: all actionable gates resolved, but strict abandonment prevents success

## Evidence rules

Evidence must contain the deciding output only. The checker records a bounded tail. Manual evidence must name a measurement, decisive output, or precise file reference.

If a check fails during `--verify`, the checker clears the completion box and records failure evidence. Previous success cannot survive a failed fresh check.
