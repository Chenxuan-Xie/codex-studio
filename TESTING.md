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
- New-conversation UI — Planner/Codex/DSH forms rendered with model lists, effort lists, editable names, and initialization prompts.
- New Codex conversation — created `worker1` with `gpt-6.1-sol` / `low`, replied `READY`, and wrote the Codex thread name.
- `POST /api/conversations` — created `worker-http-test` through the HTTP route with model/effort and initial prompt, then deleted the test thread.
- Run continuation — a completed state with round 1 was appended 2 rounds through `Orchestrator.continue_run`; state moved to round 2 / max 3 with the追加要求 in the goal.
- Run continuation UI — a saved completed record opened with the “继续这个记录” composer, rounds field and append button.
- Codex active-writer observation — codex-02 failed with `thread-store conflict ... already has an active writer`; the new worker path detects this and falls back to the Codex desktop queue instead of losing the task.
- DSH live-session fallback — resuming a live session (`worker1`) created a fresh session and returned `FALLBACK_OK` without closing or disturbing the open DSH conversation.
- Resume-interrupted flow — a stopped run exposes only failed/blocked/stopped tasks; tasks that received the prompt get the quota-recovery continuation, while unsent tasks are re-sent with their original prompt; the action then re-enters the same Planner review loop.
- Console suppression — all Codex, DSH Node and git subprocess launches now pass Windows `CREATE_NO_WINDOW`; the packaged desktop shell starts Python via `pythonw.exe`.
- Windows desktop shell — generic Electron launched with `CodexStudio.exe`, started its bundled Python backend on an available local port, and opened the app window.
- Windows portable zip — 494 MB folder packed to `CodexStudio-0.1.0-win-x64.zip` (186 MB) and verified to launch.
- Windows setup executable — IExpress package installed to `D:\CodexStudioApp` and launched `Codex Studio`.
- D-drive data policy — Electron `userData`, session cache, logs, crash dumps, temp and Python backend data are under `D:\CodexStudioAppData`; portable config was generated with `data_dir=D:\CodexStudioAppData\data`.
- New DSH conversation — created `worker9` with WorkBuddy / `low`, replied `READY`, and the DSH session title was renamed to `worker9`.
- Full DSH Planner → Codex Worker run — a DSH Planner produced a plan, a Codex Worker executed the read-only task, and the DSH Planner returned `done`.
- Full Codex Planner → DSH Worker run — after repairing the DSH Windows workspace permission, the DSH Worker executed a PowerShell read-only directory check and the run returned `done` (`run-20261101-193356-5662`).
- DSH Windows ACL repair — added the signed-in user's full-control entry to the `AI+6G` workspace, verified `WRITE_OWNER`, then repeated the confined DSH shell operation successfully (`ACL_SHELL_OK`). Recovery files are in `data/acl-recovery`.
- Launcher — `start_studio.ps1 -NoBrowser` detected the running server without error.

## Not yet run

- A full write-capable paid task with production file changes was not run; both read-only end-to-end cycles passed.
- A live DSH conversation must be closed before ACP can take its write handle; this is an expected DSH ownership constraint, not a Studio crash.

## Known constraints

- Codex account switching remains manual in Codex, followed by “切换账号后继续” in Studio.
- `gpt-6.1-sol` is supported as an existing Codex conversation Worker; direct API use requires a real OpenAI-compatible endpoint in `config.json`.
- Codex Worker execution uses `codex exec resume`; do not edit the same thread from two clients at once.
