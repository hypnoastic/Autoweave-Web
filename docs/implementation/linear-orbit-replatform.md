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
- Promote cycles and saved views from derived planning helpers into real workspace controls.
- Add create, edit, pin, and delete flows for saved views plus real orbit-backed cycle management on the planning surfaces.
- Keep the local Playwright path honest by allowing local dev-session users to create repo-less validation orbits when GitHub is intentionally absent.

## Files Touched In This Slice
- `backend/src/autoweave_web/models/entities.py`
- `backend/src/autoweave_web/db/migrations.py`
- `backend/src/autoweave_web/api/app.py`
- `backend/src/autoweave_web/schemas/api.py`
- `backend/tests/test_api.py`
- `frontend/components/planning-screen.tsx`
- `frontend/components/planning-screen.test.tsx`
- `frontend/lib/api.ts`
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
- `PYTHONPATH='../../Autoweave Library' uv run --extra dev pytest tests/test_api.py -k 'dev_session or native_issue or saved_views'`
- `npm run build`
- `docker compose -f 'Autoweave Web/docker-compose.yml' up -d --build backend`
- Browser validation:
  - seeded a local session through `POST /api/auth/dev-session`
  - verified authenticated `/app/inbox`
  - verified authenticated `/app/my-work`
  - artifacts:
    - `output/playwright/auth-dev-session-inbox.png`
    - `output/playwright/auth-dev-session-my-work.png`
- `PYTHONPATH='../../Autoweave Library' uv run --extra dev pytest tests/test_api.py -k 'native_issue or saved_views'`
- `npm test -- orbit-workspace.test.tsx planning-screen.test.tsx`
- `npm test`
- `npm run build`
- `PYTHONPATH='../../Autoweave Library' uv run --extra dev pytest tests/test_api.py -k 'inbox_payload or dev_session or native_issue or saved_views'`
- `npm test -- inbox-screen.test.tsx`
- `npm test`
- `npm run build`
- `docker compose -f 'Autoweave Web/docker-compose.yml' up -d --build frontend backend`
- Browser validation:
  - seeded a local session through `POST /api/auth/dev-session`
  - verified authenticated `/app/inbox` on `3000`
  - verified bucket filtering for blocked work
  - verified inline native issue stage updates from the inbox workspace
  - artifacts:
    - `output/playwright/inbox-triage-screen.png`
    - `output/playwright/inbox-triage-review-filter.png`
- `PYTHONPATH='../../Autoweave Library' uv run --extra dev pytest tests/test_api.py -k 'local_dev_session_can_create_orbit_without_live_github_repo or saved_views or planning_cycles or native_issue or dev_session'`
- `npm test -- planning-screen.test.tsx`
- `npm test`
- `npm run build`
- `docker compose -f 'Autoweave Web/docker-compose.yml' up -d --build backend`
- Browser validation:
  - seeded a local session through `POST /api/auth/dev-session`
  - created a repo-less validation orbit through the live local API
  - created a native issue in that orbit for planning coverage
  - verified authenticated `/app/cycles` on `3000`
  - created a real cycle through the UI
  - verified authenticated `/app/views` on `3000`
  - created, pinned, edited, and deleted a custom saved view through the UI
  - artifacts:
    - `output/playwright/cycles-real-surface.png`
    - `output/playwright/views-pinned-surface.png`

## Remaining Planned Slices
- Expand issue surfaces with richer assignment and cycle controls directly inside orbit issue detail.
- Broaden triage semantics so inbox and my-work can move work between cycles and review stages without leaving their primary surfaces.

## Slice Notes
- Local Playwright auth now works against real seeded workspace data instead of forcing browser automation through GitHub OAuth.
- The dev-session bootstrap reuses existing users when possible, including hyphenated GitHub logins, and returns a normal product session token.
- Native issues now persist assignee, labels, one-parent hierarchy, dependency links, related links, duplicate links, stale-state calculation, and recent issue activity.
- Saved views now understand labels, stale work, hierarchy scope, and dependency risk instead of only status, priority, and cycle scope.
- Orbit issues now support a denser board/list surface with compact search, owner/blocker/stale filters, and richer right-side detail editing.
- `My Work` now exposes stale and dependency-aware native issue metadata instead of treating native issues like thin board cards.
- Inbox now prioritizes review requests, blocked work, stale work, sources, and ERGO asks through explicit bucket metadata in the API and denser filter-driven rows in the UI.
- Native issue triage items can be reassigned or moved between stages directly from the inbox workspace without leaving ERGO chat context.
- Saved views now persist their full filter definition, support pinning, editing, and deletion, and render directly from the backend instead of acting like static projections.
- Cycles now surface real orbit-backed records across the workspace, with create, edit, and delete controls in the planning shell.
- Local dev-session users can create repo-less orbits in development/test, which makes Playwright PM validation possible without a live GitHub token.

## Remaining Known Gaps
- Cycle lifecycle is still basic: there is no rollover, archive flow, or workspace-level cycle health editing beyond the current create/update/delete surface.
- Saved views still do not support explicit pin reordering or share semantics.
- The orbit board currently supports stage and cycle updates from the detail panel only; drag/drop is intentionally deferred until the PM model stabilizes.
- Browser-proof automation now exists for authenticated flows, but richer seeded PM scenarios still depend on manual API setup rather than a dedicated fixture endpoint.
