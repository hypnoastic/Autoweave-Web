# AutoWeave Web V1 Task List

## Foundation

- [x] create product repository
- [x] define architecture and packaging boundary
- [x] package library wheel and install it into backend environment
- [x] add Docker Compose stack
- [x] wire runtime Neon/Aura config into `Autoweave Web/.env`
- [x] separate product Redis and runtime Redis logical state

## Backend

- [x] create FastAPI product API
- [x] create product data model
- [x] add GitHub auth flow
- [x] add orbit creation flow
- [x] add invite/email flow
- [x] add ERGO chat orchestration flow
- [x] add workflow board API backed by AutoWeave
- [x] add PR / issue sync API
- [x] add codespace orchestration
- [x] add demo orchestration
- [x] add Redis navigation state service
- [x] add context ingestion bridge
- [x] route workflow clarification/approval prompts into originating chat conversations
- [x] deduplicate repeated open workflow prompts to stop repeated ask loops
- [x] route human answers and approval receipts back to the same originating channel/DM

## Frontend

- [x] landing page
- [x] auth screens
- [x] dashboard shell
- [x] orbit shell and left rail
- [x] chat and DM UX
- [x] workflow board UX
- [x] PR / issue UX
- [x] codespaces UX
- [x] demos UX

## UI Redesign Pass

- [x] introduce shared shell / overlay / modal / detail panel primitives
- [x] add tokenized light / dark / system theme handling
- [x] redesign dashboard sidebar, priority surface, codespaces surface, and modals
- [x] redesign orbit rail and shell behavior
- [x] rebuild chat into channels + bottom DMs sidebar
- [x] add channel creation and DM-start flows
- [x] add optimistic local echo and ERGO pending state
- [x] redesign workflow board with right detail panel
- [x] split PR and issue surfaces
- [x] redesign codespace shell with in-app back navigation
- [x] separate global settings and orbit settings modals
- [ ] run full browser validation on the rebuilt Docker stack (deferred in this pass by request)
- [x] tighten `.dockerignore` / build context so Docker rebuilds stay local-dev friendly

## Phase 0 Stabilization

- [x] baseline capture and risk audit
- [x] verify both repos are clean before starting Phase 0 implementation
- [x] verify live Docker stack health and installed-package boundary
- [x] verify token-backed local auth/session path
- [x] restore Playwright validation through the CLI session harness
- [x] capture authenticated dashboard and orbit baseline artifacts
- [x] standardize shared UI foundation and design-system base
- [x] unify authenticated dashboard and orbit shells
- [x] mount one persistent `/app` shell so dashboard and orbit no longer remount separate chrome
- [x] move notifications, global settings, and profile into the top bar without changing shell persistence
- [x] keep sidebar collapse state stable across dashboard -> orbit transitions
- [x] validate expanded shell, collapsed shell, search modal, orbit transition loading, and loaded orbit shell in the live browser
- [x] replace old dashboard/orbit text loaders with in-window skeleton states inside the persistent shell
- [x] tighten top-bar/sidebar chrome alignment so the content window does not drift downward
- [x] remove the orbit sidebar triage block and keep triage in inbox/search flows only
- [x] remove the extra shell-level inner app frame so dashboard/orbit render directly on the canvas
- [x] remove the duplicated dashboard/home sidebar treatment and slim the collapsed rail
- [x] keep Dashboard pinned at the top of the same sidebar in orbit mode
- [x] remove the orbit identity block from the persistent sidebar
- [x] keep orbit-specific controls limited to a bottom-pinned `Orbit settings` item in orbit mode
- [x] flatten orbit chat and workflow so they scroll inside the content pane instead of stretching the shell
- [x] split codespaces into a list view plus a full-canvas open workspace mode tied to the top-bar back button
- [x] stop rail icons from jumping during collapse/expand and tighten the collapsed width further
- [x] darken the shared shell chrome so the top bar and sidebar read as one connected surface against the lighter main content
- [x] switch chat conversation changes to cached in-place loading with bottom scroll anchoring
- [x] move shell back/forward behavior onto router-backed navigation
- [x] fix dark-mode selected text contrast
- [x] professionalize high-traffic product surfaces
- [ ] add full-canvas workspace and artifact modes
- [x] keep the primary rail interactive while left slide panels are open
- [x] harden runtime/UI behavior after shell refactors
- [ ] continue shrinking full-orbit payload latency now that bootstrap shell hydration is in place

## Verification

- [x] backend tests
- [x] frontend tests
- [x] package boundary tests
- [x] dockerized smoke verification
- [x] documentation refresh
- [x] full backend test suite after redesign
- [x] frontend production build after redesign
