# AutoWeave Web Replatform Tracker

## Locked Product Decisions
- `Orbit` stays as the branded project container in the UI.
- AutoWeave is being shaped as a project-management control plane with a cloud teammate, not a chatbot product.
- Native chat remains first-class but complementary. It has a dedicated route and deep links from work surfaces.
- Default authenticated home is `My Work`.
- Development should ship in vertical slices with small commits and immediate pushes after green verification.

## Audit Summary
- Current strengths already in the repo: GitHub auth and GitHub App install flow, orbit membership, repo binding, ERGO messaging, workflow runs, approvals, artifacts, codespaces, PR snapshots, and issue snapshots.
- Main product gap before this slice: the app landed in a chat/inbox surface and the shell/navigation did not present the product as a PM system first.
- Main technical constraint: backend tests are still not a hard merge gate until the Python `docker` dependency problem is resolved or isolated.

## Active Slice
- Add first-class native orbit issues so planning work no longer lives only in GitHub snapshots or chat context.
- Add orbit cycles as explicit planning buckets with goal, dates, and issue membership.
- Surface native issues inside the orbit issues section as the primary planning board, while keeping GitHub issue sync visible below as delivery context.
- Make `My Work` aware of native planning issues so personal work and review queues stop being GitHub-only projections.
- Keep the implementation additive: do not break existing repo sync, PR snapshots, workflow execution, or chat routing while the PM model becomes first-class.

## Files Touched In This Slice
- `backend/src/autoweave_web/api/app.py`
- `backend/src/autoweave_web/models/entities.py`
- `backend/src/autoweave_web/schemas/api.py`
- `backend/src/autoweave_web/services/matrix.py`
- `backend/tests/test_api.py`
- `frontend/lib/types.ts`
- `frontend/lib/api.ts`
- `frontend/lib/app-shell-nav.ts`
- `frontend/components/my-work-screen.tsx`
- `frontend/components/planning-screen.tsx`
- `frontend/components/chat-screen.tsx`
- `frontend/components/inbox-screen.tsx`
- `frontend/components/dashboard.tsx`
- `frontend/components/orbit-workspace.tsx`
- `frontend/components/orbit-workspace.test.tsx`
- `frontend/components/planning-screen.test.tsx`
- `frontend/lib/planning-derived.ts`
- `frontend/app/app/*`

## Commit And Push Guidelines
- Commit after each green vertical slice. Do not batch unrelated backend, frontend, and docs work into one changeset.
- Push immediately after a slice passes targeted verification. Do not hold multiple slices locally.
- Use scoped commit messages:
  - `feat(shell): ...`
  - `feat(my-work): ...`
  - `feat(inbox): ...`
  - `feat(orbits): ...`
  - `feat(ergo): ...`
  - `fix(api): ...`
  - `docs(plan): ...`
- Every commit should update this file with:
  - what changed
  - tests/builds run
  - remaining known gaps

## Verification Log
- `npm test`
- `npm run build`
- `python -m pytest tests/test_api.py -k native_issue`
- `PYTHONPATH='../../Autoweave Library' uv run --extra dev pytest tests/test_api.py -k 'native_issue or test_matrix_flagged_channel_send_queues_transport_and_bootstrap or test_matrix_bootstrap_gracefully_disables_when_transport_is_unavailable'`
- Browser validation on `http://localhost:3000` with a seeded local session:
  - `output/playwright/my-work-screen.png`
  - `output/playwright/cycles-screen.png`
  - `output/playwright/views-screen.png`
- Browser validation for orbit-native issue flow:
  - `output/playwright/orbit-native-issues-board.png`
  - `output/playwright/orbit-native-issue-detail.png`
- Runtime hardening:
  - Matrix chat bootstrap now degrades to a disabled product payload when Matrix transport is unavailable, instead of throwing a shell-visible 500/CORS failure.
- Observed browser issue: missing `favicon.ico` only.

## Remaining Planned Slices
- Add richer native issue lifecycle beyond the current stage/cycle controls: assignment, labels, relations, subtasks, and richer board/list views.
- Add saved views as first-class backend and UI entities instead of the current derived shell projections.
- Add stronger issue-to-chat and issue-to-delivery deep links.
- Refine orbit overview and board interactions.
- Add Playwright coverage for the PM-first flows.

## Slice Notes
- Native orbit issues now have stable `PM-{number}` identifiers per orbit.
- Native issue stages currently map to: `triage`, `planned`, `in_progress`, `in_review`, `ready_to_merge`, and `done`.
- Orbit cycles are intentionally lightweight in this slice: name, goal, status, dates, and membership counts.
- GitHub issues remain visible, but they are now explicitly framed as synced delivery context instead of the primary planning model.

## Remaining Known Gaps
- Native issues do not yet support labels, parent/sub-issue relationships, or saved views.
- Cycle lifecycle is still basic: there is no rollover, archive flow, or workspace-level cycle management UI yet.
- The orbit board currently supports stage and cycle updates from the detail panel only; drag/drop is intentionally deferred until the PM model stabilizes.
- Matrix-backed chat sync still depends on a reachable Matrix homeserver for the full bridge path; this slice only fixed the degraded fallback so the orbit shell remains operational when Matrix is unavailable.
