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
- Docker rebuild context is currently larger than it should be because runtime/output residue is still included during image builds
- browser-level validation of the rebuilt stack is the remaining step for this pass

## Open Implementation Threads

- finalize GitHub OAuth + session strategy
- finalize workspace editor container launch details
- finalize demo publish heuristics from generated workspaces
- reduce Docker build context size with stricter ignores
- run full browser UI validation pass (intentionally deferred in this pass)
- restore Figma-connected design workflow once edit-capable MCP access is available
