# Model Fallback Ladder

Applies to a harness whose model you can select. Omp accepts `--model <id-or-role>`; other harnesses use their own documented mechanisms. A fixed-default harness has no model ladder: escalation means switching to another permitted available harness, not respawning the same default (see `failure-handling.md`).

## Select for the job

1. Honor a caller-supplied selector first. If it cannot be honored, report the missing capability or mapping rather than silently substituting another model.
2. Otherwise choose a suitable configured role or available model for the job. An ordinary coding worker and a review/judgment worker need not start on the same model. A saved default is acceptable only when no selector is requested or chosen and it suits the task.
3. Re-check the selected harness's live capabilities and configured roles. Catalog presence is not proof the model runs; require the real-first-prompt smoke test described in `SKILL.md`.

For Omp, `@task` and `@slow` are role examples; a custom review role such as `@reviewer` is usable only if configured on the target machine. Do not require that particular custom role, create it automatically, or mistake these names for a benchmark ranking. If no custom review role was requested or configured, choose a suitable available selector. If the caller explicitly requested an absent role, stop and report it.

A Solo-spawned top-level Omp worker loads its Omp settings but bypasses native task-agent dispatch. `task.agentModelOverrides` and the Solo worker's name do not select its model. Pass the chosen selector on the launch; let Omp resolve a role alias against its current settings rather than pinning a cached concrete model.

## Escalate without duplicating runtime fallback

Let the harness apply its configured runtime fallback, subject to caller constraints. Do not layer a hardcoded provider/model ladder over it or retry a model the runtime already exhausted. For a genuine capability limit that remains, preserve the handoff and choose the next suitable available model under those constraints. Follow `failure-handling.md` for state preservation and bounded recovery.

Role aliases are Omp-specific in these examples. Never pass them to another harness unless that harness independently documents equivalent support. No saved model mappings or fallback settings need to be changed to launch a worker.
