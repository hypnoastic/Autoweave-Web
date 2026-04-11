# AutoWeave Web

AutoWeave Web is the product-facing application for AutoWeave.

It is the control-plane product that sits above the AutoWeave runtime library and turns workflow execution, repository access, approvals, artifacts, and operator decisions into a usable collaborative system.

## What This Product Does

AutoWeave Web gives teams a product shell for operating AI-assisted software delivery work without collapsing everything into a chat transcript.

Today, the web product is responsible for:

- GitHub-backed sign-in and installation setup
- the public landing page and product entry flow
- the authenticated shell, navigation, and product information architecture
- the inbox workspace for high-signal operational work
- dashboard and orbit-level operational views
- repository-aware product APIs and product-side state
- workflow, artifact, chat, and review surfaces that are visible to operators

In practical terms, this is the product where a user:

- signs in with GitHub
- lands in an inbox or dashboard instead of a blank assistant surface
- opens an orbit tied to a repository or workspace
- sees workflow state, approvals, review queues, artifacts, and chat in one shell
- drives product-level actions around repos, PRs, issues, demos, and workspaces

## What It Is Meant To Be

AutoWeave Web is meant to be the collaborative product layer for governed software execution.

The intended product direction is:

- a control plane for autonomous and semi-autonomous software workflows
- a system where workflow state is first-class, not hidden behind assistant replies
- a repo-aware and environment-aware operational shell
- a place where approvals, clarifications, artifacts, and rollout decisions stay attached to the work
- a product that feels closer to a delivery control plane than to a chatbot with side panels

The product should communicate:

- production trust
- safe change management
- explicit workflow state
- visible auditability
- operational clarity across repositories, environments, and approvals

## Future Intent

The long-term intent is not just to provide a nicer frontend for existing workflow tools.

AutoWeave Web is meant to become the place where teams operate the full lifecycle of intelligent software delivery:

- define and review workflow intent
- bind workflows to repositories, environments, and permissions
- run autonomous or semi-autonomous work with explicit operator oversight
- pause for approvals or clarifications without losing execution context
- inspect artifacts, run history, and audit state in the same shell
- move from planning to execution to rollout without switching product metaphors

In its fuller form, the product should feel like:

- a control plane for software change
- a collaborative operating layer for governed automation
- a system where human review and machine execution are part of one visible workflow

It should not drift toward:

- a generic AI chat workspace
- a dashboard that only reports telemetry after the fact
- a thin wrapper around repo actions with no workflow memory or approval model

The product vision is that operators, reviewers, and builders can all work inside the same shell while still seeing:

- what is changing
- why it is changing
- which repo and environment are affected
- what approvals are required
- what the runtime already did
- what still needs a human decision

## What This Repo Is Not

This repo is not the workflow runtime itself.

That runtime lives in `Autoweave Library/`.

The correct boundary is:

- `Autoweave Web/` owns product UX, product APIs, product auth, shell navigation, inbox/dashboard/orbit surfaces, and GitHub-facing product integration
- `Autoweave Library/` owns workflow execution, durable runtime state, artifact emission, approvals, clarification pauses, worker dispatch, and monitoring internals

The web backend should consume the library through an installed package boundary, not by coupling directly to its source tree.

## Current Product Shape

At a high level, the current product includes:

- Public landing page
  - explains the orchestration/control-plane story
  - routes users into login or signup
- Auth flow
  - GitHub OAuth callback handling
  - GitHub App installation setup path
- Authenticated shell
  - persistent top bar
  - sidebar navigation
  - search and notifications surfaces
- Inbox
  - ERGO-first operational inbox
  - high-signal work items
  - compact chat plus inbox context
- Dashboard
  - overview surface for product-level operational state
- Orbit workspace
  - repo-aware workspace for a single orbit
  - workflows, artifacts, chats, issues, PRs, demos, and settings
- Product API backend
  - product-side auth/session handling
  - inbox/dashboard/orbit payloads
  - GitHub integration and product state aggregation

## Repo Layout

Top-level structure:

- `frontend/`
  - Next.js App Router app
  - public pages, authenticated routes, product shell, and UI components
- `backend/`
  - FastAPI backend for product APIs, auth, GitHub integration, and product state
- `docker/`
  - container entrypoints and local stack support
- `docker-compose.yml`
  - local multi-service stack for product development
- `tests/`
  - higher-level web stack and integration coverage

Key frontend areas:

- `frontend/app/`
  - route entrypoints
- `frontend/components/`
  - product screens and shared UI
- `frontend/lib/`
  - API client code and shared product types

Key backend areas:

- `backend/src/autoweave_web/api/`
  - API routes
- `backend/src/autoweave_web/services/`
  - GitHub integration and product-state aggregation
- `backend/src/autoweave_web/models/`
  - product persistence models
- `backend/tests/`
  - backend API coverage

## Product Concepts

### Inbox

Inbox is the high-signal operator entry point.

It is meant to aggregate:

- approvals
- mentions
- ERGO briefing context
- review queue state
- source artifacts
- recent operational conversations

### Orbit

An orbit is the main product workspace unit.

An orbit typically binds together:

- a repository or repo scope
- workflow context
- chat and DM threads
- PR and issue visibility
- artifacts and demos
- operator actions and navigation state

### ERGO

ERGO is the conversational/product assistant surface inside the product.

It should help operators work inside the shell, but it is not meant to replace workflow state, audit visibility, or operational surfaces.

## Local Development

### Prerequisites

- Node.js / npm
- Python 3.12
- Docker and Docker Compose

### Environment

Start from:

```bash
cp .env.example .env.local
```

Key environment areas include:

- frontend base URLs
- backend base URLs
- GitHub OAuth settings
- GitHub App settings
- database and runtime wiring

### Run With Docker

From this repo:

```bash
docker compose up -d --build
```

That stack is intended to bring up:

- frontend on `3000`
- backend on `8000`
- supporting services such as Postgres and Redis

### Run Frontend Locally

```bash
cd frontend
npm install
npm run dev
```

### Run Backend Locally

```bash
cd backend
python -m pip install -e .
uvicorn autoweave_web.api.app:create_app --factory --reload --port 8000
```

## Verification

Common frontend checks:

```bash
cd frontend
npm test
npm run build
```

Common backend checks:

```bash
cd backend
pytest
```

## Design and UX Direction

AutoWeave Web is not intended to feel like a generic AI chat app.

The product direction is:

- operational
- dense but readable
- workflow-first
- repo-aware
- approval-aware
- consistent with a control-plane metaphor

That means:

- chat is important, but it does not become the whole product
- workflow, environment, artifact, and audit surfaces stay first-class
- shell stability matters
- operators should be able to understand state without reading long conversations

## Short Version

If you need the shortest correct summary:

- `Autoweave Web` is the product
- it gives AutoWeave a real collaborative control-plane shell
- it handles auth, GitHub integration, inbox/dashboard/orbit UX, and product APIs
- it is meant to make governed software workflows usable by humans
- it sits above `Autoweave Library`, which remains the execution runtime underneath
