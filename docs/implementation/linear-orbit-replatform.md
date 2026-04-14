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
- Add a safe local auth bootstrap for Playwright so authenticated PM flows can be proven without typing GitHub secrets into the browser.
- Reuse existing local users when the provided GitHub login already exists, including hyphenated logins from seeded dev data.
- Keep the bootstrap strictly local/dev/test only and validate it against real authenticated routes on `3000`.

## Files Touched In This Slice
- `backend/src/autoweave_web/api/app.py`
- `backend/src/autoweave_web/schemas/api.py`
- `backend/tests/test_api.py`
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
- Browser validation status:
  - authenticated PM browser proof is now unblocked by the local auth bootstrap
  - the next browser pass should target the triage-first inbox and cycle/view management flows

## Remaining Planned Slices
- Rebuild Inbox as a triage-first surface around approvals, mentions, blocked work, stale work, and agent asks.
- Strengthen cycles and saved views with editing, pinning, delete flows, and richer issue assignment controls.

## Slice Notes
- Local Playwright auth now works against real seeded workspace data instead of forcing browser automation through GitHub OAuth.
- The dev-session bootstrap reuses existing users when possible, including hyphenated GitHub logins, and returns a normal product session token.
- Native issues now persist assignee, labels, one-parent hierarchy, dependency links, related links, duplicate links, stale-state calculation, and recent issue activity.
- Saved views now understand labels, stale work, hierarchy scope, and dependency risk instead of only status, priority, and cycle scope.
- Orbit issues now support a denser board/list surface with compact search, owner/blocker/stale filters, and richer right-side detail editing.
- `My Work` now exposes stale and dependency-aware native issue metadata instead of treating native issues like thin board cards.

## Remaining Known Gaps
- Inbox is still not triage-first enough. It needs explicit review/approval/blocker/agent buckets and inline quick actions.
- Cycle lifecycle is still basic: there is no rollover, archive flow, or workspace-level cycle management UI yet.
- Saved views do not yet support editing, deleting, pin ordering, or share semantics.
- The orbit board currently supports stage and cycle updates from the detail panel only; drag/drop is intentionally deferred until the PM model stabilizes.
- Browser-proof automation now exists for authenticated flows, but there is still no dedicated local seed path for richer scenario setup beyond the current dev database.
