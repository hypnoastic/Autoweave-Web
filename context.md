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
- keep AutoWeave runtime state on hosted Neon from `Autoweave Library/.env.local`
- keep context graph on hosted Neo4j Aura from `Autoweave Library/.env.local`
- split Redis usage: DB `1` for product navigation, DB `0` for runtime/Celery

## Runtime Model

- one orbit owns one runtime root
- a shared worker consumes background workflow jobs
- Redis stores transient navigation and queue state in separated logical DBs
- product data and runtime data are physically separated across local Docker Postgres and hosted Neon
- graph context is projected into hosted Aura instead of being stored in product tables

## Open Implementation Threads

- finalize GitHub OAuth + session strategy
- finalize workspace editor container launch details
- finalize demo publish heuristics from generated workspaces
