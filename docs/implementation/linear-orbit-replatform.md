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
- Broaden triage semantics so `Inbox` and `My Work` can move native issues without leaving their primary surfaces.
- Keep owner, status, and cycle edits on one shared compact control strip so the PM shell does not splinter into surface-specific patterns.
- Browser-proof both surfaces against a disposable local orbit and dev-session user on `3000`.

## Files Touched In This Slice
- `frontend/components/native-issue-triage-controls.tsx`
- `frontend/components/inbox-screen.tsx`
- `frontend/components/inbox-screen.test.tsx`
- `frontend/components/my-work-screen.tsx`
- `frontend/components/my-work-screen.test.tsx`
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
- `npm test -- orbit-workspace.test.tsx`
- `npm test`
- `npm run build`
- `docker compose -f 'Autoweave Web/docker-compose.yml' up -d --build frontend`
- Browser validation:
  - seeded a fresh local session through `POST /api/auth/dev-session`
  - created a repo-less validation orbit plus cycle and native issues through the live local API
  - verified authenticated `/app/orbits/{orbitId}?section=issues` on `3000`
  - filtered orbit native issues by priority and cycle in the live UI
  - opened the right-hand native issue detail pane
  - edited title, detail, stage, and priority from the issue record panel and saved successfully
  - artifacts:
    - `output/playwright/orbit-issues-filtered-surface.png`
    - `output/playwright/orbit-issue-detail-editor.png`
- `npm test -- inbox-screen.test.tsx`
- `npm test -- my-work-screen.test.tsx`
- `npm test`
- `npm run build`
- `docker compose -f 'Autoweave Web/docker-compose.yml' up -d --build frontend`
- Browser validation:
  - seeded a fresh local session through `POST /api/auth/dev-session`
  - created a disposable repo-less orbit plus two cycles and one native issue through the live local API
  - verified authenticated `/app/my-work` on `3000`
  - moved the native issue from `April stabilization` to `May launch`
  - moved the same issue from `In progress` to `In review` and confirmed it surfaced in review pressure
  - verified authenticated `/app/inbox` on `3000`
  - confirmed the selected triage record exposed the same shared owner/status/cycle controls
  - moved the issue from `In review` to `Ready to merge` directly from inbox
  - artifacts:
    - `output/playwright/my-work-inline-triage-controls.png`
    - `output/playwright/inbox-inline-triage-controls.png`
- `PYTHONPATH='../../Autoweave Library' uv run --extra dev pytest tests/test_api.py -k 'inbox_payload_exposes_action_context_for_approvals_and_mentions or notifications_can_be_marked_read_directly or inbox_payload_prioritizes_native_issue_triage_buckets'`
- `npm test -- inbox-screen.test.tsx`
- `npm test`
- `npm run build`
- `docker compose -f 'Autoweave Web/docker-compose.yml' up -d --build backend`
- `docker compose -f 'Autoweave Web/docker-compose.yml' up -d --build frontend`
- Browser validation:
  - seeded a fresh local session through `POST /api/auth/dev-session`
  - created a repo-less validation orbit and stale native issue through the live local API
  - inserted mention and approval triage records against the live Postgres-backed workspace
  - verified authenticated `/app/inbox` on `3000`
  - marked a mention record read directly from the inbox detail surface
  - primed a stale native issue follow-up into the ERGO composer directly from inbox
  - resolved a live approval record through the inbox detail quick action
  - artifacts:
    - `output/playwright/inbox-approval-browser-proof.png`
    - `output/playwright/inbox-stale-followup-browser-proof.png`

## Remaining Planned Slices
- Tighten the native issue surface further with relation and hierarchy editing from denser inline flows instead of modal-heavy paths.
- Expand inbox quick actions from approvals, mentions, and stale work into run-failed, clarification, and review-request records with the same dense inline model.

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
- Orbit issue filters now include priority, owner, and cycle selects instead of relying only on chips and search.
- The native issue detail pane now edits the issue record directly with compact selects and structured fields instead of a long status/ownership chip wall.
- Browser proof now covers live native issue record editing in addition to cycles, views, inbox, and my-work.
- `Inbox` and `My Work` now share the same compact native issue triage strip for status, owner, and cycle changes.
- `My Work` preloads the owning orbit context for native issues so inline controls stay accurate without inflating the `my-work` payload.
- Browser proof now covers live inline triage from both the work queue and the inbox triage surface.
- Inbox triage records for approvals, mentions, and stale native issues now expose direct quick actions instead of forcing users into orbit detail or generic chat first.
- The inbox payload now carries explicit `action_context` metadata for approval and mention records, including workflow request linkage where needed.
- Operators can now mark mention notifications read, resolve approval requests, and seed a stale-issue ERGO follow-up prompt directly from the inbox surface.
- Browser proof now covers real mention-read, stale follow-up, and approval-resolution flows on the live local stack.

## Remaining Known Gaps
- Cycle lifecycle is still basic: there is no rollover, archive flow, or workspace-level cycle health editing beyond the current create/update/delete surface.
- Saved views still do not support explicit pin reordering or share semantics.
- Relation and hierarchy editing still rely on modal pickers instead of the denser inline controls now used for title, owner, stage, and cycle.
- The orbit board still does not support drag/drop; that remains intentionally deferred until the PM model stabilizes.
- Browser-proof automation now exists for authenticated flows, but richer seeded PM scenarios still depend on manual API setup rather than a dedicated fixture endpoint.
- Inbox quick actions currently cover approvals, mentions, and stale native issues, but run-failed and clarification records still open as context-only records without one-click inline resolution paths.
