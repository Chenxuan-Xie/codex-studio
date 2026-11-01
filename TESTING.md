# Local test record

Date: 2026-11-01

## Passed

- `python -m unittest discover -s tests -v` — 6 tests passed.
- `python -m py_compile server.py` — passed.
- `node --check static/app.js` — passed.
- `/api/bootstrap` — 20 Codex projects returned from `projects` + `project_roots`.
- `/api/threads?project=<AI+6G id>` — 6 Codex conversations returned with Codex `name` labels.
- `/api/dsh-sessions?project=<AI+6G id>` — 33 DSH conversations returned from `session_projcache`.
- DSH ACP new session + prompt — returned `ACP_OK`.
- DSH ACP resume of a persisted non-live session + WorkBuddy model — returned `ACP_RESUME_OK`.
- DSH ACP busy-session guard — returns a clear “DSH 会话正在被占用” message instead of hanging.
- Codex Worker `codex exec resume` — test turn returned `OK` and wrote back to the same thread.
- Codex-rotator `x-codex-turn-metadata` header fix — proxy request returned HTTP 200; original 502 no longer reproduced.
- UI browser test — project list, Planner selection, DSH tab, add-DSH-worker, and start-button state all worked.
- Launcher — `start_studio.ps1 -NoBrowser` detected the running server without error.

## Not yet run

- A full paid Planner → real task → DSH/Codex Worker → Planner review cycle using a funded Codex account, because the existing Planner thread previously hit workspace credits.
- A live DSH conversation must be closed before ACP can take its write handle; this is an expected DSH ownership constraint, not a Studio crash.

## Known constraints

- Codex account switching remains manual in Codex, followed by “切换账号后继续” in Studio.
- `gpt-6.1-sol` is supported as an existing Codex conversation Worker; direct API use requires a real OpenAI-compatible endpoint in `config.json`.
- Codex Worker execution uses `codex exec resume`; do not edit the same thread from two clients at once.
