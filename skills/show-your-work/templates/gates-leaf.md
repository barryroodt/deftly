# Gates: <leaf or focused task>

Scope: <one observable deliverable>

- [ ] G1: <observable outcome>
  CHECK: <command that proves the outcome>
  EXPECT: <decisive substring or /regex/flags>
  EVIDENCE: pending

- [ ] G2: <another runnable outcome>
  CHECK: <command>
  EXPECT: <decisive substring or /regex/flags>
  EVIDENCE: pending

- [ ] G3: <manual outcome when no command can prove it>
  EVIDENCE: pending

<!--
Adapted from Leonxlnx/unlazy v2 under the MIT License.
A checked gate with pending evidence remains unmet.
For an impossible gate, add: ABANDON: G<n> <reason>
Parent verification uses gate-check.mjs --verify --strict.
-->
