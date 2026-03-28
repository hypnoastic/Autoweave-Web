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

## Runtime Model

- one orbit owns one runtime root
- a shared worker consumes background workflow jobs
- Redis stores transient navigation and queue state
- Postgres stores both product and runtime data in separated logical namespaces

## Open Implementation Threads

- finalize GitHub OAuth + session strategy
- finalize workspace editor container launch details
- finalize demo publish heuristics from generated workspaces
