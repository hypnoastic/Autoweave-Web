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
- Expand the native issue model into a real PM object: assignee, labels, parent/sub-issues, dependency links, and richer issue detail.
- Project `My Work`, saved views, and orbit issue surfaces from the native issue model instead of keeping them mostly status/cycle projections.
- Add denser orbit issue filters and list/board switching before drag and drop is considered.

## Files Touched In This Slice
- `backend/src/autoweave_web/api/app.py`
- `backend/src/autoweave_web/db/migrations.py`
- `backend/src/autoweave_web/models/entities.py`
- `backend/src/autoweave_web/schemas/api.py`
- `backend/tests/test_api.py`
- `frontend/components/my-work-screen.tsx`
- `frontend/components/orbit-workspace.tsx`
- `frontend/components/orbit-workspace.test.tsx`
- `frontend/components/planning-screen.tsx`
- `frontend/components/planning-screen.test.tsx`
- `frontend/lib/types.ts`
- `docs/implementation/linear-orbit-replatform.md`

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
- `PYTHONPATH='../../Autoweave Library' uv run --extra dev pytest tests/test_api.py -k 'native_issue or saved_views'`
- `npm test -- orbit-workspace.test.tsx planning-screen.test.tsx`
- `npm test`
- `npm run build`
- Browser validation status:
  - authenticated PM browser proof is still blocked by the missing local auth harness slice
  - current browser-safe proof remains limited to unauthenticated/public routes unless a manual session is restored

## Remaining Planned Slices
- Rebuild Inbox as a triage-first surface around approvals, mentions, blocked work, stale work, and agent asks.
- Strengthen cycles and saved views with editing, pinning, delete flows, and richer issue assignment controls.
- Add a safe local auth bootstrap for Playwright so authenticated PM flows can be proven end to end without typing secrets in the browser.

## Slice Notes
- Native issues now persist assignee, labels, one-parent hierarchy, dependency links, related links, duplicate links, stale-state calculation, and recent issue activity.
- Saved views now understand labels, stale work, hierarchy scope, and dependency risk instead of only status, priority, and cycle scope.
- Orbit issues now support a denser board/list surface with compact search, owner/blocker/stale filters, and richer right-side detail editing.
- `My Work` now exposes stale and dependency-aware native issue metadata instead of treating native issues like thin board cards.

## Remaining Known Gaps
- Inbox is still not triage-first enough. It needs explicit review/approval/blocker/agent buckets and inline quick actions.
- Cycle lifecycle is still basic: there is no rollover, archive flow, or workspace-level cycle management UI yet.
- Saved views do not yet support editing, deleting, pin ordering, or share semantics.
- The orbit board currently supports stage and cycle updates from the detail panel only; drag/drop is intentionally deferred until the PM model stabilizes.
- Browser-proof automation for authenticated PM flows still needs a safe local auth harness or an explicitly provided manual session.
