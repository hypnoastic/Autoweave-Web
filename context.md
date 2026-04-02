# AutoWeave Web Product Context

## Product Identity

- product name: AutoWeave Web
- visible manager agent: ERGO
- visual tone: black / white / grey, sharp, minimal, 2D, no purple SaaS styling

## Core Decisions

- use a separate product backend instead of extending the library monitoring UI
- keep the `autoweave` package as the orchestration/runtime engine
- consume `autoweave` through a built and installed wheel
- keep raw product truth in product tables
- project derived execution context into AutoWeave memory instead of dumping raw history
- use Docker-managed local runtime storage for workspaces and demos
- keep product raw truth on local Docker Postgres
- keep AutoWeave runtime state on hosted Neon copied into `Autoweave Web/.env`
- keep context graph on hosted Neo4j Aura copied into `Autoweave Web/.env`
- split Redis usage: DB `1` for product navigation, DB `0` for runtime/Celery
- redesign the product around fixed-height shells and internal scroll regions
- keep chat calm and human-facing; keep execution detail in the workflow surface
- keep DMs inside chat only, not as a separate orbit-level top nav area
- use modal settings and slide-over panels consistently across dashboard and orbit views

## Runtime Model

- one orbit owns one runtime root
- a shared worker consumes background workflow jobs
- Redis stores transient navigation and queue state in separated logical DBs
- product data and runtime data are physically separated across local Docker Postgres and hosted Neon
- graph context is projected into hosted Aura instead of being stored in product tables

## Current UI Architecture

- dashboard uses a denser collapsible sidebar
- orbit view uses a fixed-width left rail
- search and notifications use left slide-over panels
- workflow / PR / issue detail uses a right slide-over panel
- create-orbit, global settings, orbit settings, channel creation, and DM start use centered modals
- theme state is token-driven and supports `system`, `light`, and `dark`
- chat uses optimistic local echo and ERGO pending state while workflow remains the detailed execution surface

## Current Constraints

- Figma MCP was not available during this redesign pass, so the redesign was executed repo-first and validated against the running product instead of being driven from live Figma nodes
- GitHub OAuth is not configured in the current local environment, so the real login path under test is the token-backed local auth flow
- MCP Playwright browser control is currently unreliable in this workspace; the active browser-validation path is the Playwright CLI session harness
- fresh browser sessions currently hit CORS when the frontend is served from `127.0.0.1:3000` and calls the backend on `127.0.0.1:8000`
- the initial orbit shell is now bootstrap-hydrated, but the full orbit payload is still heavier than it should be and remains a follow-up performance target

## Phase 0B Foundation State

- the shared primitive layer now includes:
  - `PageHeader`
  - `InlineNotice`
  - `EmptyState`
  - `SkeletonBlock`
  - `PageLoader`
  - `ListRow`
  - `FieldHint`
  - `FieldError`
- shared overlays now unmount when closed and use clearer dialog/menu semantics with escape and backdrop close behavior
- the theme layer now has semantic focus/state/motion tokens plus reduced-motion handling
- dashboard/orbit/chat now consume the new loader/notice/empty-state/header foundation in a bounded proof pass
- current local validation for this slice:
  - `cd frontend && npm test -- --run` -> `20 passed`
  - `cd frontend && npm run build` -> success

## Phase 0C Shell State

- dashboard and orbit now share:
  - `RailSidebar`
  - `RailCluster`
  - `RailButton`
- dashboard now uses a persistent contextual home sidebar via `ContextSidebar`
- orbit no longer relies on a local rail-button helper
- current local validation for this slice:
  - `cd frontend && npm test -- --run` -> `20 passed`
  - `cd frontend && npm run build` -> success
- current live validation limitation:
  - rebuilt browser sessions still stall in `Loading dashboard…` and `Loading orbit…`
  - dashboard stall is currently explained by backend CORS on `localhost:3000` -> `localhost:8000`

## Phase 0D Surface State

- high-traffic product surfaces now use a denser shared row grammar instead of relying on one-off cards:
  - dashboard priority and codespaces
  - orbit chat sidebar
  - orbit search, inbox, and command surfaces
  - orbit codespace/artifact lists
  - orbit settings repository/member rows
  - DM picker and repository connect modal
- the shared UI layer now includes:
  - `SelectionChip` for saved views, theme choices, and role controls
  - an expanded `ListRow` with active state, eyebrow labels, and supporting meta/actions
- workflow, PR/issues, workspaces, and artifacts now use `PageHeader` for a more consistent top-of-surface frame

## Phase 0F Shell Hardening State

- the shared overlay primitive now keeps the primary rail exposed when a left slide panel is open
- orbit and dashboard rail actions now close conflicting shell overlays before opening the next surface
- live browser validation now confirms:
  - Inbox can open in orbit
  - the rail remains clickable while Inbox is open
  - Command palette can replace Inbox directly without manually dismissing the left panel first
- the remaining authenticated-shell debt is narrower:
  - fresh rebuild/browser sessions no longer stay pinned indefinitely on `Loading orbit…`; the shell now hydrates from a lightweight bootstrap orbit payload before the full orbit payload finishes
  - the full orbit payload still remains much slower than the bootstrap response and should be shrunk further in a later performance pass
  - localhost vs `127.0.0.1` origin behavior is still not fully standardized

## Phase 0F Orbit Bootstrap Hydration

- added a lightweight `bootstrap` read mode to `GET /api/orbits/{id}` so the first authenticated orbit load can hydrate:
  - orbit metadata
  - repositories
  - channels
  - direct messages
  - permissions
  - navigation
  - workflow summary
  - section-specific codespaces / PRs / issues / demos / artifacts when the current saved navigation section needs them
- orbit bootstrap reads intentionally skip:
  - members
  - chat messages
  - human-loop card collections
  - notifications
  - read-state mutation
- the frontend orbit reload path now:
  - hydrates from the bootstrap orbit payload when no prior payload exists
  - continues to fetch the full orbit payload in the background
  - keeps preferences loading decoupled from first shell render
- current local validation for this slice:
  - `cd frontend && npm test -- --run` -> `26 passed`
  - `./.venv/bin/python -m pytest backend/tests -q` -> `44 passed`
  - `AUTOWEAVE_WEB_STACK_SMOKE=1 ./.venv/bin/python -m pytest tests/test_stack_smoke.py -q` -> `2 passed`
- current live validation for this slice:
  - Playwright CLI on `127.0.0.1` now shows the authenticated orbit shell rendered by the 3-second post-navigation snapshot
  - captured `output/playwright/phase0f-orbit-bootstrap-3s.png`
  - direct API timing still shows the full orbit payload is substantially slower than bootstrap, so this slice fixes hydration predictability without claiming the full hot path is optimized

## Current Live Validation Read

- browser validation on `127.0.0.1:3000` with the token-backed local session now proves:
  - dashboard renders the professionalized row-based priority/codespace surfaces
  - orbit chat renders with the new row-based channel/DM grammar
  - orbit inbox renders with the saved-view chip grammar and repo-aware inbox rows
  - command palette renders with the shared row grammar and can now replace the inbox directly from the rail
- the remaining live debt is now narrower than the earlier baseline suggested:
  - dashboard and orbit do render in a real browser session, but scripted validation can still capture `Loading…` if it snapshots too early
  - localhost vs `127.0.0.1` origin behavior still needs one deliberate `0F` pass so the authenticated shell is predictably validation-safe without timing/origin workarounds

## Open Implementation Threads

- stabilize the authenticated orbit load path before broad shell refactors
- standardize the shared overlay, focus, and state system across dashboard and orbit
- unify dashboard shell and orbit shell into one authenticated product frame
- add full-canvas workspace and artifact open modes after shell standardization
- finalize GitHub OAuth + session strategy for environments beyond token-backed local development
- restore Figma-connected design workflow once edit-capable MCP access is available
