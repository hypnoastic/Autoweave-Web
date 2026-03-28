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

These live in the product database schema and remain the authoritative record.

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

These live in a separate runtime schema and in orbit-specific runtime roots.

### Redis

Redis is used only for transient state:

- user navigation state
- last opened orbit
- last opened orbit section
- idempotency / leases used by the AutoWeave runtime
- queue/broker functions for background workflow execution

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
- product backend and frontend implementation in progress
- package-installed runtime integration in progress
