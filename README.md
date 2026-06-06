# n8n-nodes-humanstep

[n8n](https://n8n.io/) community node package for [HumanStep](https://humanstep.ai) — add human decision steps to your automation workflows.

HumanStep lets you pause automations and route decisions to people for review. This integration provides:

- **HumanStep** action node — create decision requests (simple approval or template-based)
- **HumanStep Trigger** node — start workflows when decisions are resolved

## Installation

Follow the [n8n community nodes installation guide](https://docs.n8n.io/integrations/community-nodes/installation/).

In n8n, go to **Settings → Community Nodes → Install**, then enter:

```
n8n-nodes-humanstep
```

For local development, see [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Credentials

This package requires a HumanStep API credential:

| Field | Description |
|-------|-------------|
| **API Key** | Your HumanStep API key (`hs_live_...`) |
| **Base URL** | `https://api.humanstep.ai/api` (default) |

To create an API key:

1. Sign in to [HumanStep](https://app.humanstep.ai)
2. Open **Settings → API Keys**
3. Create a key and copy it (shown once)

Use **Test** in n8n to verify the credential against `GET /api/team`.

## Nodes

### HumanStep (action)

**Resource:** Validation  
**Operation:** Create Decision

Creates a pending decision in HumanStep and returns the decision object (including `resolve_url` for reviewers).

**Simple validation (no template)**

- Set **Use Template** to `false`
- Enter a **Question Title** (e.g. "Approve this expense?")
- Optionally add a JSON **Payload** with context for the reviewer

**Template-based decision**

- Set **Use Template** to `true`
- Select a **Review Template**
- Map template **Fields** using the resource mapper

### HumanStep Trigger

Listens for **Decision Resolved** events from HumanStep.

- **Use Template** `false` — triggers for any resolved decision in your workspace
- **Use Category** `true` — when **Use Template** is `false`, only triggers for decisions in the selected category
- **Use Template** `true` — only triggers for decisions using the selected template
- **Wait for Real Data** `false` — sends an immediate sample payload when you execute the trigger
- **Wait for Real Data** `true` — waits for the next real HumanStep webhook event

When you activate the workflow, the trigger registers a webhook with HumanStep. Resolved decisions are delivered to your n8n webhook URL.

## Example workflows

### Request approval before continuing

1. **HTTP Request** — fetch data to review
2. **HumanStep** — Create Decision with the data as payload
3. **HumanStep Trigger** (separate workflow) — on resolve, continue downstream steps (notify, update CRM, etc.)

### React when a template decision is approved

1. **HumanStep Trigger** — Decision Resolved, filter by template
2. **IF** — check `$json.decision.status === "approved"`
3. **Slack / Email** — notify the team

## Trigger payload

When a decision is resolved, the trigger receives:

```json
{
  "event": "decision.resolved",
  "decision": {
    "id": "uuid",
    "team_id": "uuid",
    "template_id": "uuid",
    "category_id": "uuid",
    "title": "Decision title",
    "status": "approved",
    "reason_required": false,
    "rejection_reason": null,
    "payload": {},
    "created_at": "2026-01-15T12:00:00Z",
    "resolved_at": "2026-01-15T12:05:00Z"
  }
}
```

Use expressions such as `{{ $json.decision.status }}` and `{{ $json.decision.payload }}` in downstream nodes.

## Requirements

- **Self-hosted n8n** — install this community node package manually or via the Community Nodes UI
- **Public webhook URL** — the trigger node requires n8n to be reachable from the internet so HumanStep can deliver webhook events (standard for any webhook-based trigger)
- **HumanStep account** — with API access enabled

## Resources

- [HumanStep](https://humanstep.ai)
- [HumanStep API reference](https://github.com/HumanStep-ai/humanstep-app/blob/main/docs/api-reference.md)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/community-nodes/)

## License

[MIT](LICENSE)
