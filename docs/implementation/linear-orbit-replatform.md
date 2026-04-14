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
- Add dedicated-chat deep links from planning and issue surfaces so ERGO behaves like a teammate attached to project work, not a separate destination with lost context.
- Keep work surfaces primary: chat links should frame the selected issue or orbit inside the dedicated `Chat` route, not replace orbit-native planning views.
- Preserve additive compatibility with the current inbox/chat plumbing and avoid backend contract churn for this slice.

## Files Touched In This Slice
- `frontend/app/app/orbits/[orbitId]/page.tsx`
- `frontend/app/app/chat/page.tsx`
- `frontend/components/chat-screen.tsx`
- `frontend/components/inbox-screen.tsx`
- `frontend/components/inbox-screen.test.tsx`
- `frontend/components/my-work-screen.tsx`
- `frontend/components/orbit-workspace.tsx`
- `frontend/components/orbit-workspace.test.tsx`
- `frontend/lib/chat-links.ts`
- `frontend/lib/orbit-links.ts`
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
- `npm test -- inbox-screen.test.tsx orbit-workspace.test.tsx planning-screen.test.tsx`
- `npm test -- inbox-screen.test.tsx orbit-workspace.test.tsx`
- `npm run build`
- Rebuilt runtime on `http://localhost:3000` with:
  - `docker compose -f 'Autoweave Web/docker-compose.yml' up -d --build frontend backend`
- Browser validation status:
  - public route checks succeeded
  - authenticated deep-link browser proof is blocked until a real local GitHub token is entered or an existing session is restored; Playwright refused automated secret entry as expected
- Observed browser issue: missing `favicon.ico` only.

## Remaining Planned Slices
- Add richer native issue lifecycle beyond the current stage/cycle controls: assignment, labels, relations, subtasks, and richer board/list views.
- Extend issue-to-chat and issue-to-delivery links deeper into saved views and board cards.
- Refine orbit overview and board interactions.
- Add Playwright coverage for the PM-first flows.

## Slice Notes
- The dedicated `Chat` route now accepts orbit and issue context from route params instead of reading search params directly inside the client shell.
- Orbit issue detail and My Work issue queues can now open ERGO with the selected issue framed inside the chat surface.
- Chat context stays compact: orbit/issue metadata is visible above the thread without turning the whole page back into a chat-first dashboard.
- The orbit route now supports detail-targeted params so the chat context card can return users to the exact issue or PR detail state instead of only the orbit root.

## Remaining Known Gaps
- Native issues do not yet support labels, parent/sub-issue relationships, or richer relation modeling.
- Cycle lifecycle is still basic: there is no rollover, archive flow, or workspace-level cycle management UI yet.
- Saved views do not yet support editing, deleting, pin ordering, or share semantics.
- The orbit board currently supports stage and cycle updates from the detail panel only; drag/drop is intentionally deferred until the PM model stabilizes.
- Browser-proof automation for authenticated PM flows still needs a safe local auth harness or an explicitly provided manual session.
