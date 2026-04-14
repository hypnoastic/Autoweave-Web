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
- Add first-class saved views over native orbit issues so planning can pin durable issue slices across orbits instead of rebuilding filters inside the shell.
- Keep cycles derived for now, but move `Views` off of frontend-only projections and onto a real backend payload.
- Preserve the PM-first shell: saved views should surface planning work, not thread lists or generic feed state.

## Files Touched In This Slice
- `backend/src/autoweave_web/api/app.py`
- `backend/src/autoweave_web/models/entities.py`
- `backend/src/autoweave_web/schemas/api.py`
- `backend/tests/test_api.py`
- `frontend/lib/api.ts`
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
- `npm test -- planning-screen.test.tsx`
- `npm run build`
- `PYTHONPATH='../../Autoweave Library' uv run --extra dev pytest tests/test_api.py -k 'saved_views or native_issue'`
- Browser validation on `http://localhost:3000/app/views` with a seeded local session:
  - `output/playwright/views-saved-custom.png`
- Observed browser issue: missing `favicon.ico` only.

## Remaining Planned Slices
- Add richer native issue lifecycle beyond the current stage/cycle controls: assignment, labels, relations, subtasks, and richer board/list views.
- Add stronger issue-to-chat and issue-to-delivery deep links.
- Refine orbit overview and board interactions.
- Add Playwright coverage for the PM-first flows.

## Slice Notes
- Saved views now come from a backend payload that mixes system views with persisted user-created views.
- Custom views currently support orbit scope, status filters, priority filters, assignee scope, and cycle scope.
- Preview rows stay focused on native issue work and keep the shell pointed at planning surfaces instead of chat routes.

## Remaining Known Gaps
- Native issues do not yet support labels, parent/sub-issue relationships, or richer relation modeling.
- Cycle lifecycle is still basic: there is no rollover, archive flow, or workspace-level cycle management UI yet.
- Saved views do not yet support editing, deleting, pin ordering, or share semantics.
- The orbit board currently supports stage and cycle updates from the detail panel only; drag/drop is intentionally deferred until the PM model stabilizes.
