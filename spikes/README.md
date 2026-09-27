# spikes/

Every line of Phraise code lives here until an integration spike proves the idea is feasible and the key risks are resolved. There is no main source tree yet, on purpose.

Conventions:

- One directory per attempt: `spikes/<date>-<component>-<approach>/`, for example `spikes/2026-09-28-markdown-core-remark/` and, if a second approach is tried, `spikes/2026-09-30-markdown-core-comrak/`.
- Each directory is self-contained: its own `README.md` stating goal, status and how to run it, its own dependencies, its own tests. No cross-spike imports; copy and note the origin.
- Every spike ends with a findings doc in `context/docs/` and a log in `context/logs/`. "Abandoned because X" is a valid and useful outcome.
- Briefs for spikes live in `context/plans/`. See `AGENTS.md` at the repo root.
