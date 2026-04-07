# AutoWeave Web V1 Implementation

## Goal

Build the first serious AutoWeave product around the packaged `autoweave` library:

- Next.js + TypeScript + Tailwind frontend
- Python backend that consumes the installed `autoweave` package
- Dockerized local development
- PostgreSQL as the canonical durable store
- Redis for transient state and navigation memory
- Docker-managed local workspaces, demos, and artifacts
- ERGO as the visible manager agent

## Product / Runtime Separation

### Product canonical store

The web product owns raw collaborative application truth:

- users
- orbit metadata
- memberships and invites
- channels, messages, DM threads
- PR and issue snapshots
- codespaces and demos
- work requests and user actions
- product-level context projections

For the current V1 stack, these live in the web product's local Docker Postgres database and remain the authoritative record.
Agents do not query these tables directly.

### AutoWeave runtime store

The `autoweave` package owns derived execution state:

- workflow runs
- tasks
- attempts
- approval requests
- human requests
- runtime memory entries
- artifacts
- observability events

These live in hosted Neon Postgres using the runtime connection copied into `Autoweave Web/.env`, with the runtime isolated to the `autoweave_runtime` schema plus orbit-specific runtime roots.

### Redis

Redis is used only for transient state:

- product navigation state in Redis DB `1`
- last opened orbit
- last opened orbit section
- AutoWeave queue, Celery broker/result, leases, and heartbeats in Redis DB `0`

### Local Docker-managed storage

The product stores local execution outputs in Docker volumes:

- orbit runtime roots
- generated artifacts
- runtime workspaces
- codespace clones
- demo publish directories

## Context Ingestion Model

Raw product history is not dumped directly into AutoWeave.

The bridge works like this:

1. Product writes raw events to product tables.
2. A deterministic ingestion service extracts structured execution context:
   - summaries
   - decisions
   - referenced files
   - PR / issue references
   - linked work items
   - branch and workspace context
3. The backend stores those structured projections in product tables.
4. The backend also projects compact derived memory entries into the AutoWeave runtime repository for the related orbit/project.
5. Agents work primarily from that derived execution context and can request deeper product detail on demand through the backend.

## Concrete Runtime Topology

- `product postgres (local docker)`: raw product truth
- `runtime postgres (hosted Neon)`: workflow runs, tasks, approvals, memory, artifacts metadata
- `graph (hosted Neo4j Aura)`: derived context graph only
- `redis db 1 (local docker)`: product navigation remembrance
- `redis db 0 (local docker)`: AutoWeave Celery/runtime transient state
- `docker volume`: runtime artifacts, workspaces, demos, generated outputs

## Orbit Model

- one orbit maps to one GitHub repository
- repository creation happens through GitHub integration during orbit creation
- existing repositories are intentionally not attachable in V1
- orbit settings manage invite flow
- accepting an invite introduces the user into the chat and adds them as a collaborator through GitHub when possible

## ERGO Interaction Rule

ERGO is the visible manager agent.

Main chat stays clean:

- user asks ERGO for work
- ERGO gathers small clarifications if needed
- once work starts, ERGO posts `working on it`
- detailed execution lives in the workflow section
- ERGO returns to chat only for completion, review, or approval

## Workflow UX

- chat is for human-facing collaboration
- workflow board is the agent execution surface
- card detail panel shows task status, current step, approvals, and context
- PR / issues view is separate from workflow detail

## Packaging Boundary

The backend must not import the library from the source folder.

The product backend image and local backend environment both install a built `autoweave` wheel and import the installed package from there.

Verification:

- packaging tests build the wheel
- backend integration tests verify the import path comes from installed site-packages, not the library source directory

## Docker Topology

- `frontend`: Next.js web product
- `backend`: FastAPI product API
- `worker`: background workflow runner using the installed `autoweave` package
- `redis`: transient state and queue broker
- `mailpit`: local invite email sink

The backend and worker mount the shared runtime volume and talk to external Postgres / Neo4j / GitHub / OpenHands via environment configuration.

## Testing Plan

- backend unit and API tests with pytest + httpx
- product-to-runtime context ingestion tests
- packaging boundary tests
- frontend component tests with Vitest + Testing Library
- Docker config validation

## Current Implementation Status

- architecture and repo structure established
- package-installed runtime integration working
- product data and runtime data remain separated
- Matrix chat transport integration is now implemented behind feature flags while keeping product DB canonical for conversations, messages, notifications, and human-loop cards
- UI shell redesign implemented for dashboard and orbit surfaces
- shell follow-up refinements now keep the orbit search visually centered in the top bar, turn the top-bar search field into the active typed search input with a downward-expanding result surface from that same field, open the profile menu correctly from the live shell, and keep the top-bar toggle plus collapsed rail icons/recent orbit marks aligned to one fixed anchor in the slimmer sidebar
- theme/surface refinements now standardize the authenticated product on a calmer semantic layer model:
  - darker shell chrome
  - flatter canvas background
  - more consistent panel/card surfaces
  - stronger modal backdrops and panel solidity
  - readable dark-mode text selection and clearer surface contrast in light mode
- dashboard body refinements now replace the old in-canvas hero copy with a compact operational overview:
  - greeting plus small signal strip
  - three concise summary tiles
  - denser priority and recent-workspace columns
  - stable internal page scrolling instead of a long stacked page feel
- orbit common framing refinements now strip out the repeated orbit-name/page-title stacks inside the canvas:
  - workflow, PRs, Issues, workspaces, and artifacts use compact operational section bars
  - PRs and Issues are now split into separate sidebar entries and separate views
  - shell breadcrumb continues to hold the primary page context while the canvas focuses on work
- chat refinements now move the surface closer to a dense collaboration tool instead of a prototype messenger:
  - all messages are left-aligned
  - channel and DM lists are flatter and less boxed
  - ERGO uses a more recognizable colored identity mark
  - conversation search now returns matching-message results in its own panel instead of filtering the live thread
  - the composer is smaller and now exposes markdown/attachment direction without adding fake backend behavior
- workflow-origin prompts now project from runtime snapshots into the originating chat surface (channel or DM)
- repeated open clarification prompts are deduplicated so manager ask loops do not spam chat
- human-request answers and approval decisions now post resolved receipts back into the originating conversation

## Matrix Transport Integration (2026-04-07)

### Architecture

- product conversations and messages remain canonical in the web database
- Matrix is transport and sync only:
  - room provisioning
  - message send
  - timeline ingest
  - transport confirmation / retry metadata
- Matrix identifiers stay behind service boundaries and do not replace product IDs

### Additive schema

- new tables:
  - `MatrixUserMapping`
  - `MatrixRoomBinding`
  - `MatrixMessageLink`
  - `MatrixSyncState`
  - `MatrixMembershipState`
- new additive product message fields:
  - `transport_state`
  - `transport_error`

### Backend services

- `MatrixService`
- `MatrixProvisioningService`
- `MatrixSyncBridge`
- dedicated bridge worker entrypoint:
  - `python -m autoweave_web.matrix_bridge`

### Frontend path

- `matrix-js-sdk` is integrated only through a hidden product adapter
- initial chat hydration still comes from product REST
- local echo stays product-owned
- Matrix sync only nudges targeted conversation refresh/reconciliation
- failed remote sends surface as retryable product states in the existing chat UI

### Local Docker topology

- added `synapse` service
- added `matrix-bridge` service
- local Docker backend and bridge now use:
  - `DOCKER_DATABASE_URL`
  - `DOCKER_RUNTIME_POSTGRES_URL`
- this avoids inheriting the remote Neon `DATABASE_URL` from `.env` during local Matrix validation

### Validation

- `cd Autoweave Web && ./.venv/bin/python -m pytest backend/tests -q` -> `47 passed`
- `cd Autoweave Web/frontend && npm test -- --run` -> `29 passed`
- `cd Autoweave Web/frontend && npm run build` -> success
- `cd Autoweave Web && AUTOWEAVE_WEB_STACK_SMOKE=1 ./.venv/bin/python -m pytest tests/test_stack_smoke.py -q` -> `2 passed`
- `docker compose -f 'Autoweave Web/docker-compose.yml' up -d --build backend worker frontend matrix-bridge synapse`
- `curl -s http://127.0.0.1:8000/api/health` -> healthy

### Known limitations

- Matrix rollout is channel-first and forward-only; historical product chat is not migrated into Matrix
- DM bridging and typing/presence remain flag-gated follow-up work
- Synapse answers correctly inside the container, but host-side direct port probing on `127.0.0.1:8008` remains unreliable in this environment
- one Matrix bridge ingest unit test is still failing locally and remains outside the current UI pass scope:
  - `backend/tests/test_matrix_service.py::test_matrix_bridge_ingests_inbound_events_once_and_tracks_sync_cursor`

## UX Refinement Pass (2026-04-07)

The current major UX pass is intentionally local-only and starts from a browser-audited baseline instead of trusting the current inner-page layouts.

Completed preconditions:

- checkpointed the existing Matrix transport work into its own local commit so UI slices can stay isolated
- cleared the two live browser blockers that would otherwise pollute page-level QA:
  - Matrix chat bootstrap no longer fails with a backend `500` in the live stack
  - shell avatar/session rendering no longer emits the earlier hydration mismatch during orbit loads
- added loopback URL normalization for Matrix sync bootstrap so the local browser does not bounce between `localhost` and `127.0.0.1`

Next active implementation slices:

1. light/dark theme token and surface consistency
2. dashboard redesign
3. orbit page redesigns:
   - chat
   - workflow
   - PRs
   - Issues
   - workspaces
   - artifacts
4. landing and GitHub-first auth redesign

### Shell refinement slice completed

- top bar height and collapsed rail width now match at `48px`
- global search moved into the center of the top bar and is no longer a sidebar route/button
- dashboard recent orbits are now plain sidebar items instead of boxed rows with extra metadata
- collapsed dashboard rail still preserves recent orbit icons
- orbit mode now keeps search in the top bar instead of duplicating it in the sidebar nav
- shell validation for this slice completed in the live browser in both light and dark themes

## Phase 0 Stabilization Baseline (2026-04-02)

- both repos are clean before the new Phase 0 execution begins
- the live Docker stack is healthy and the backend still confirms the installed-package boundary through `/api/health`
- GitHub OAuth is not configured in the current local environment, so the real sign-in path under test is the token-backed local auth flow
- Playwright validation is active through the CLI session harness because the MCP browser context is not stable in this workspace
- the authenticated dashboard shell is a valid baseline and still hydrates successfully
- the authenticated orbit shell is not yet a safe baseline: from a fresh session it can remain on `Loading orbit…` while backend logs still show `200` responses for `/api/orbits/{id}` and `/api/orbits/{id}/workflow`
- hidden drawers and modals still remain mounted when visually closed, which confirms the shared overlay system as the first UI-foundation target for Phase 0

## Phase 0 Execution Order

1. baseline capture and risk audit
2. shared UI foundation and design-system base
3. authenticated shell unification
4. product surface professionalization
5. workspace and artifact full-canvas modes
6. runtime/UI hardening after shell refactors

## Phase 0B - Shared UI Foundation

The shared foundation slice is now implemented locally.

Scope landed:

- expanded `frontend/components/ui.tsx` with shared page, state, and row primitives
- standardized overlay semantics so closed panels/modals/menus unmount instead of staying hidden in the DOM
- added semantic state/focus/motion tokens in `frontend/app/globals.css` and `frontend/tailwind.config.ts`
- added reduced-motion handling and restrained opacity/transform-only entry motion
- updated dashboard/orbit/chat to prove the new shared loader/notice/empty-state/header grammar without broad shell refactors yet

Validation for this slice:

- `cd frontend && npm test -- --run` -> `19 passed`
- `cd frontend && npm run build` -> success

Known live validation issue still open after the foundation slice:

- fresh Playwright browser sessions on `127.0.0.1:3000` are currently blocked by CORS when the frontend calls `127.0.0.1:8000`
- fresh authenticated orbit sessions still stall in `Loading orbit…`

## Phase 0C - Authenticated Shell Unification

This shell slice is now implemented locally.

Scope landed:

- added shared authenticated-shell primitives for the primary rail and contextual sidebar
- moved dashboard to the same primary rail grammar as orbit
- moved orbit off its local rail-button helper and onto the shared rail primitives
- added a dashboard shell test so the new framing is covered in automated validation

Validation for this slice:

- `cd frontend && npm test -- --run` -> `20 passed`
- `cd frontend && npm run build` -> success
- `docker compose up -d --build frontend` rebuilt the live frontend for validation

Known live validation issue still open after the shell slice:

- dashboard still stalls in `Loading dashboard…` in browser validation because backend CORS is blocking `localhost:3000` -> `localhost:8000`

## Shell Cleanup Follow-up - Remove the Inner App Frame

This follow-up shell pass is now implemented locally.

Scope landed:

- removed the last shell-level bordered content frame from `frontend/components/authenticated-shell.tsx`
- the persistent top bar and contextual sidebar remain mounted, but dashboard and orbit content now render directly on the main canvas instead of inside a second rounded app window
- local panels and work surfaces still keep their own borders where they express real product structure

Validation for this follow-up:

- `cd frontend && npm test -- --run` -> `26 passed`
- `cd frontend && npm run build` -> success
- live browser screenshots captured:
  - `output/playwright/dashboard-no-inner-frame.png`
  - `output/playwright/orbit-no-inner-frame.png`

## Shell Cleanup Follow-up - Sidebar and Workspace Behavior

This follow-up shell pass is now implemented locally.

Scope landed:

- removed the duplicated home button from the persistent sidebar so dashboard is represented by one consistent nav item
- slimmed the collapsed sidebar width and aligned the shell button sizing so the top-bar controls and sidebar controls read as one system
- removed the orbit identity block from the persistent sidebar
- flattened the orbit chat wrapper so chat no longer sits inside an extra outer card
- removed the outer workflow board panel so the workflow surface scrolls inside the page instead of stretching the shell
- changed codespaces from split list-plus-iframe mode to:
  - a workspace list page
  - a full-canvas open workspace mode
  - top-bar back returns from the open workspace to the list

Validation for this follow-up:

- `cd frontend && npm test -- --run` -> `27 passed`
- `cd frontend && npm run build` -> success
- live browser screenshots captured:

## Shell Cleanup Follow-up - Chat Switching and Rail Stability

This follow-up shell pass is now implemented locally.

Scope landed:

- kept `Dashboard` pinned at the top of the same persistent sidebar while inside orbit mode
- switched the shell back/forward controls to router-backed navigation
- reworked the collapsed rail button layout to use fixed icon slots plus fading labels so icons do not jump during collapse/expand
- reduced the collapsed rail width again so the icon-only state reads tighter
- removed the accent-heavy active treatment from chat rows so light/dark states stay calmer and more legible
- added conversation caching plus non-blocking load behavior for channel/DM switching so chat refreshes in place instead of feeling frozen
- added bottom anchoring for the chat timeline so the active conversation reopens at the latest messages instead of the top
- fixed dark-mode text selection contrast in `globals.css`

Validation for this follow-up:

- `cd frontend && npm test -- --run` -> `28 passed`
- `cd frontend && npm run build` -> success
- live browser validation captured:
  - `output/playwright/orbit-chat-shell-fixed.png`
  - `output/playwright/orbit-chat-dm-loaded.png`
  - `output/playwright/orbit-chat-shell-collapsed.png`
  - `output/playwright/dashboard-shell-tighter.png`
  - `output/playwright/orbit-chat-no-outer-card.png`
  - `output/playwright/orbit-workflow-scroll-contained.png`

## Phase 0F - Orbit Bootstrap Hydration

This hardening slice is now implemented locally.

Scope landed:

- added `bootstrap=1` support on `GET /api/orbits/{id}` so the first orbit read can return a lighter shell-hydration payload
- kept the bootstrap orbit payload limited to shell-critical data plus section-specific codespaces / PRs / issues / demos / artifacts when the saved navigation section needs them
- moved the frontend orbit reload path to:
  - hydrate immediately from the bootstrap orbit payload when there is no prior orbit payload
  - continue loading the full orbit payload in the background
  - keep preferences loading non-blocking for shell hydration
- added backend/frontend regression coverage proving:
  - the bootstrap orbit payload keeps shell-critical data while skipping heavy lists
  - the orbit shell renders from bootstrap before the full orbit payload finishes

Validation for this slice:

- `cd frontend && npm test -- --run` -> `26 passed`
- `cd frontend && npm run build` -> success
- `./.venv/bin/python -m pytest backend/tests -q` -> `44 passed`
- `AUTOWEAVE_WEB_STACK_SMOKE=1 ./.venv/bin/python -m pytest tests/test_stack_smoke.py -q` -> `2 passed`
- rebuilt Docker backend/frontend and revalidated the direct orbit route with Playwright CLI

Live validation result after this slice:

- the fresh authenticated orbit shell now paints in the browser instead of remaining pinned on `Loading orbit…`
- captured:
  - `output/playwright/phase0f-orbit-bootstrap-3s.png`
- residual performance debt remains:
  - the bootstrap orbit endpoint is still materially slower than ideal
  - the full orbit payload remains much heavier than bootstrap and should be split further in a later performance pass
- orbit still stalls in `Loading orbit…` after an 8 second browser wait

## Phase 0D - Product Surface Professionalization

This surface slice is now implemented locally.

Scope landed:

## Phase 0 Shell Pass - Persistent Authenticated Chrome

This shell/dashboard slice is now implemented locally.

Route/layout change:

- added `frontend/app/app/layout.tsx` so the authenticated shell persists across all `/app` routes
- dashboard and orbit now render as inner content inside the same mounted shell instead of each mounting separate chrome

Scope landed:

- added `frontend/components/authenticated-shell.tsx` as the single shell owner for:
  - the fixed top bar
  - the persistent contextual sidebar
  - shell-owned search and notifications modals
  - sidebar collapse persistence via local storage
  - profile/settings entry and theme controls
- moved notifications and profile controls out of the top bar and into the sidebar utility area
- changed the shell chrome to one connected neutral-dark surface so the top bar and sidebar read as one frame
- kept the main content area as the only distinct window with rounded corners and a separate panel surface
- moved orbit navigation into the same contextual sidebar system rather than preserving a separate orbit-only left rail
- kept sidebar collapse state stable when moving from dashboard into an orbit

Validation for this slice:

- `cd frontend && npm test -- --run` -> `26 passed`
- `cd frontend && npm run build` -> success
- Docker rebuild on the live stack for the frontend
- live browser validation on `127.0.0.1:3000` confirmed:
  - dashboard renders inside the persistent shell
  - expanded and collapsed sidebar states both render correctly
  - search opens as a modal from the sidebar
  - dashboard -> orbit keeps the same mounted shell and collapsed state
  - orbit navigation swaps inside the same sidebar container

Captured artifacts:

- `output/playwright/phase0-shell-dashboard-expanded.png`
- `output/playwright/phase0-shell-dashboard-collapsed.png`
- `output/playwright/phase0-shell-dashboard-search-modal.png`
- `output/playwright/phase0-shell-orbit-transition-loading.png`
- `output/playwright/phase0-shell-orbit-persistent.png`

## Phase 0 Shell Follow-up - In-Window Loading States

This shell follow-up is now implemented locally.

Scope landed:

- added `ShellPage` and `ShellPageSkeleton` primitives in `frontend/components/ui.tsx`
- moved dashboard and orbit onto the same inner page wrapper instead of separate local page containers
- replaced the generic `Loading dashboard…` and `Loading orbit…` pill states with full in-window skeleton states that render inside the persistent shell content pane

Validation for this slice:

- `cd frontend && npm test -- --run` -> `26 passed`
- `cd frontend && npm run build` -> success
- rebuilt the Docker frontend and revalidated the live app
- Playwright CLI confirmed that both `/app` and dashboard -> orbit transitions now render shell-mounted content skeletons before the full page data arrives

Captured artifacts:

- `output/playwright/phase0-shell-dashboard-loading-window.png`
- `output/playwright/phase0-shell-orbit-loading-window.png`

## Phase 0 Shell Follow-up - Chrome Alignment Cleanup

This shell cleanup is now implemented locally.

Scope landed:

- tightened `frontend/components/authenticated-shell.tsx` so the top bar and sidebar sit inside one connected chrome surface instead of visually pushing the content window downward
- kept the content pane as the only distinct rounded work window inside the shell
- removed the orbit sidebar `Triage / Saved views` block from `frontend/components/orbit-workspace.tsx`
- kept triage access in search and inbox surfaces instead of treating it as persistent sidebar chrome

Validation for this slice:

- `cd frontend && npm test -- --run` -> `26 passed`
- `cd frontend && npm run build` -> success
- rebuilt the Docker frontend and revalidated dashboard and orbit in the live browser

Captured artifacts:

- `output/playwright/shell-audit-dashboard-fixed.png`
- `output/playwright/shell-audit-orbit-fixed.png`

- expanded the shared UI layer with:
  - a richer `ListRow` that supports active state, eyebrow labels, and supporting metadata/actions
  - a shared `SelectionChip` primitive for saved views, theme controls, and role toggles
- replaced the card-heavy grammar across the highest-traffic product surfaces:
  - dashboard priority and codespaces
  - orbit chat channel/DM list
  - orbit search, inbox, and command palette results
  - orbit workspaces and artifacts lists
  - orbit settings repository/member rows
  - DM picker and repository connect list
- standardized top-of-surface framing with `PageHeader` for:
  - workflow
  - PRs and issues
  - workspaces
  - artifacts

Validation for this slice:

- `cd frontend && npm test -- --run` -> `21 passed`
- `cd frontend && npm run build` -> success
- rebuilt the live frontend via `docker compose up -d --build frontend`
- Playwright browser validation captured:
  - `output/playwright/phase0d-dashboard-professionalized.png`
  - `output/playwright/phase0d-orbit-professionalized.png`
  - `output/playwright/phase0d-orbit-inbox-professionalized.png`
  - `output/playwright/phase0d-orbit-command-professionalized.png`

Live validation nuance after this slice:

- the real browser now confirms the new dashboard/orbit surface grammar is present
- the earlier “orbit never renders” framing is too broad on `127.0.0.1`; orbit does render once the session is seeded and the page is given time to settle
- the remaining `0F` debt is now focused on predictable authenticated-shell validation:
  - left-panel overlay geometry and shell-surface exclusivity still need a bounded hardening pass
  - localhost vs `127.0.0.1` origin consistency still needs cleanup

## Phase 0F - Shell Overlay Hardening

This bounded hardening slice is now implemented in the current Phase 0 pass.

Scope landed:

- added shell-level overlay-opening helpers in dashboard and orbit so left panels, command palette, settings, and profile surfaces close conflicting shell overlays before opening the next one
- updated the shared `OverlayBackdrop` / `LeftSlidePanel` behavior so left-panel backdrops respect the rail offset instead of covering the primary rail
- added regression coverage for:
  - orbit inbox -> command palette overlay switching
  - dashboard search -> notifications overlay switching
  - left-panel backdrop geometry with an explicit rail offset

Validation for this slice:

- `cd frontend && npm test -- --run` -> `24 passed`
- `cd frontend && npm run build` -> success
- rebuilt the live frontend via `docker compose up -d --build frontend`
- Playwright CLI validation now proves the real interaction path:
  - open an orbit
  - open Inbox
  - click Command palette directly from the rail
  - confirm Command palette opens while Inbox is gone
  - captured `output/playwright/phase0f-orbit-overlay-switch.png`

Remaining `0F` debt after this slice:

- fresh rebuild/browser sessions can still capture `Loading orbit…` before the orbit route settles, even when backend orbit/workflow requests return `200`
- full Phase 0 completion still depends on resolving that authenticated orbit-hydration predictability issue
  - timing-sensitive `Loading…` captures if validation snapshots too early
  - lingering localhost vs `127.0.0.1` origin consistency risk for the authenticated shell

## UI Redesign Pass

This redesign pass focused on turning the V1 product from a stitched set of screens into a coherent product shell.

### Design direction

- closer to Linear + Slack than generic dashboard SaaS
- dense, sharp, minimal, calm
- black / white / grey only with restrained accent usage
- fixed-height shells with internal scrolling instead of long pages
- reduced roundness and lower visual noise

### Constraint during this pass

The redesign was planned as a Figma-first pass, but the Figma MCP connection was not available in this session. The repo was still redesigned systematically:

- design-system rules and screen targets were translated into shared shell primitives
- implementation was validated against the running product in-browser instead of improvising style changes screen by screen

### New frontend shell primitives

The frontend now relies on shared UI architecture instead of page-owned one-off layout code:

- `AppShell`
- `ShellMain`
- `LeftSlidePanel`
- `RightDetailPanel`
- `CenteredModal`
- `PopoverMenu`
- `ScrollPanel`
- tokenized theme primitives in global CSS/Tailwind

### Dashboard changes

- narrower, denser collapsible sidebar
- no redundant `Dashboard` heading
- sparse priority surface
- codespaces surfaced with running/stopped state
- search and notifications moved into left slide-over panels
- profile uses popover menu
- global settings uses modal
- orbit creation moved to centered modal
- logo upload added

### Orbit shell changes

- orbit rail is denser and fixed-width
- DMs are no longer a top-level rail section
- search and notifications match dashboard behavior
- orbit settings moved to modal
- global settings remains separate from orbit settings

### Chat changes

- real chat workspace layout with:
  - channels at top of the chat sidebar
  - DMs in the bottom of that same sidebar
- current-conversation search in the chat header
- immediate local echo for user messages
- ERGO pending state rendered in chat while detailed execution stays in workflow
- channel creation flow added
- DM start flow added

### Workflow / board changes

- full-page execution board
- task detail moved into right slide-over detail panel
- timeline-style event rendering in task detail
- approvals and human requests surfaced through the detail flow
- PR and issue boards split into separate surfaces
- cards use operational statuses instead of only priority labels

### Codespaces changes

- codespaces now stay inside the product shell
- selected codespace takes the main content area
- back-navigation returns to the previous orbit section, defaulting to chat
- external editor link remains available when needed

### Settings changes

- global settings is modal-based
- orbit settings is modal-based and separate
- theme preference supports system / light / dark
- theme preference syncs to product backend preferences

### Shell chrome changes

- the persistent shell is roughly 10% denser than the previous pass, with a 58px top bar and a thinner collapsed rail
- top-bar utility actions now sit on the right in this order: notifications, global settings, profile
- orbit mode keeps only one orbit-specific control in the sidebar footer: `Orbit settings`
- the top bar and sidebar now share the darker shell surface while the main product canvas stays lighter, creating a clearer split without a hard border between shell regions
- the shell icon language was cleaned up so dashboard, workflow, and artifacts no longer reuse confusing icons, and orbit mode now orders sidebar actions as `Dashboard`, `Search`, then the execution surfaces

### Backend/UI contract changes used by the redesign

- `GET /api/preferences`
- `PUT /api/preferences`
- `POST /api/orbits/{orbit_id}/channels`
- `GET /api/orbits/{orbit_id}/channels/{channel_id}/messages`
- `POST /api/orbits/{orbit_id}/channels/{channel_id}/messages`
- `POST /api/orbits/{orbit_id}/dms`
- richer orbit member payloads for DM creation and avatar/name display
- normalized `operational_status` on PR and issue payloads

### Validation completed

- backend API tests passed
- full backend suite passed
- frontend Vitest suite passed
- frontend production build passed
- root Docker build context was tightened with a repo-level `.dockerignore`
- live validation exposed stale Neon SSL connections in the product DB pool, and the backend engine was hardened with `pool_pre_ping` plus connection recycling

Browser/Docker validation remains part of this pass and should be run against the rebuilt local stack.
