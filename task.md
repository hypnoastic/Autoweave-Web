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
- [ ] unify authenticated dashboard and orbit shells
- [ ] professionalize high-traffic product surfaces
- [ ] add full-canvas workspace and artifact modes
- [ ] harden runtime/UI behavior after shell refactors

## Verification

- [x] backend tests
- [x] frontend tests
- [x] package boundary tests
- [x] dockerized smoke verification
- [x] documentation refresh
- [x] full backend test suite after redesign
- [x] frontend production build after redesign
