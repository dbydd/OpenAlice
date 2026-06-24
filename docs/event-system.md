# Event System Guide

OpenAlice still has a small typed event bus, but the old connector/AgentCenter automation stack is retired. Treat this document as the current, narrow guide for the remaining event-log/webhook surface.

## Current role

The event system provides:

- typed event definitions in `src/core/agent-event.ts`
- an append-only event log in `src/core/event-log.ts`
- listener/producer primitives in `src/core/listener.ts`, `src/core/producer.ts`, and `src/core/listener-registry.ts`
- webhook ingestion and event query/stream routes in `src/webui/routes/events.ts`

It is **not** the primary AI execution path anymore. The model loop runs in native workspace CLIs (`claude`, `codex`, `opencode`, `pi`, `shell`). For root Pi CLI/watch mode, heartbeat and notifications should be handled by Pi extensions first.

## Current event types

Defined in `src/core/agent-event.ts`:

| Event | Status |
|---|---|
| `cron.fire` | Legacy/sample event. Cron engine was retired; kept to avoid spec churn. |
| `message.received` | Legacy connector-era event; currently no web/Telegram connector producer. |
| `message.sent` | Legacy connector-era event. |
| `agent.work.requested` | External-ingestable canonical work request. Currently logged; future listener may route it to headless workspace/Pi. |
| `agent.work.done` | Dormant; no in-process AgentWork consumer today. |
| `agent.work.skip` | Dormant. |
| `agent.work.error` | Dormant. |

## Webhook ingestion

Route: `POST /api/events/ingest`

Implementation: `src/webui/routes/events.ts`

The route:

1. checks webhook auth tokens from `data/config/webhook.json`
2. allows only event types marked `external: true`
3. validates payloads against TypeBox schemas
4. appends to the event log through a producer handle

Legacy alias:

```text
task.requested -> agent.work.requested { source: "task", prompt }
```

This alias remains for old external integrations.

## When adding an event type

1. Add the payload interface to `src/core/agent-event.ts`.
2. Add it to `AgentEventMap`.
3. Add a TypeBox schema.
4. Add metadata to `AgentEvents`.
5. Mark `external: true` only if webhook callers may forge this event.
6. If it is externally ingestable, extend the producer declaration at the `createEventsRoutes` call site.
7. Add/update tests around payload validation and ingest auth if it crosses HTTP.

## What not to do

- Do not revive `AgentCenter` or connector routing for root Pi CLI mode.
- Do not use OpenAlice cron/AgentWork for Pi heartbeat before trying a Pi extension.
- Do not add events as a substitute for a direct CLI command when the task is synchronous.

## Reference files

| Concern | File |
|---|---|
| Event metadata + schemas | `src/core/agent-event.ts` |
| Listener types | `src/core/listener.ts` |
| Producer types | `src/core/producer.ts` |
| Registry | `src/core/listener-registry.ts` |
| Event log | `src/core/event-log.ts` |
| Webhook/events routes | `src/webui/routes/events.ts` |
| Webhook auth | `src/webui/routes/webhook-auth.ts` |
