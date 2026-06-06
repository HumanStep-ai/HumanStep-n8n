# Development guide

## Prerequisites

- Node.js 18+ locally; CI and publish use Node 22 (required for npm Trusted Publishing)
- A running n8n instance (local or cloud)
- HumanStep API key with access to `https://api.humanstep.ai/api`

## Local setup

```bash
git clone https://github.com/HumanStep-ai/HumanStep-n8n.git
cd HumanStep-n8n
npm install
npm run build
```

Link into n8n for local testing:

```bash
npm link
mkdir -p ~/.n8n/custom
cd ~/.n8n/custom
npm init -y
npm link n8n-nodes-humanstep
```

Restart n8n, then add **HumanStep API** credentials and the nodes in the editor.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript and copy icons to `dist/` |
| `npm run dev` | Watch mode (TypeScript recompile) |
| `npm run lint` | ESLint (nodes, credentials, package.json) |
| `npm run lintfix` | ESLint with auto-fix |

## Test matrix

### Credentials

1. Add **HumanStep API** credentials with your `hs_live_...` key
2. Base URL: `https://api.humanstep.ai/api`
3. Click **Test** — should succeed against `GET /api/team`

### Action node — simple decision

1. Add **HumanStep** → Create Decision
2. **Use Template**: `false`
3. Enter a question title
4. Execute — verify a pending decision appears in HumanStep

### Action node — template decision

1. **Use Template**: `true`
2. Select a template and fill mapped fields
3. Execute — verify decision is created with correct payload

### Trigger — all decisions

1. Add **HumanStep Trigger**, **Use Template**: `false`
2. Activate the workflow (requires public n8n URL or tunnel)
3. Resolve any decision in HumanStep
4. Verify the workflow executes with decision data

### Trigger — template filter

1. **Use Template**: `true`, select a specific template
2. Activate the workflow
3. Resolve a decision with that template — workflow should run
4. Resolve a decision with a different template — workflow should not run

### Trigger — cleanup

1. Deactivate the workflow
2. Verify the webhook is removed from HumanStep (Settings → Webhooks or API)

## Architecture

```
n8n Trigger Node  --POST /api/webhooks-->  api.humanstep.ai
HumanStep app worker  --POST webhook URL-->  n8n Trigger Node
```

Webhook delivery is handled by the HumanStep web app (`app.humanstep.ai`), not the public API. The trigger registers webhooks via `api.humanstep.ai`; when a decision is resolved, the app worker delivers the event to your n8n webhook URL.

## Known limitations (v0.1.0)

- **Create Decision** returns immediately after creating the decision; it does not poll or wait for resolution. Use the trigger node or a separate workflow to react to outcomes.
- **Schema autocomplete** on the trigger may require at least one real resolved decision; automatic test payloads on webhook registration are not yet exposed on the public API.

## Publishing to npm

Publishing uses GitHub Actions with [npm provenance](https://docs.npmjs.com/generating-provenance-statements) (required for n8n verified community nodes).

### One-time setup

1. Create the public GitHub repository: `HumanStep-ai/HumanStep-n8n`
2. Register the npm package name `n8n-nodes-humanstep` under the `humanstepai` npm account
3. Add a GitHub Actions secret **`NPM_TOKEN`** (recommended):
   - npm → Access Tokens → **Granular Access Token**
   - Permissions: read/write on `n8n-nodes-humanstep` only
   - GitHub repo → Settings → Secrets → Actions → New secret → `NPM_TOKEN`
4. Optional: configure [npm Trusted Publishers](https://docs.npmjs.com/trusted-publishers) for OIDC-only publishes (no token). Requires package settings → Trusted publishing → GitHub Actions → `HumanStep-ai` / `HumanStep-n8n` / `publish.yml` exactly.

If CI fails with `404 Not Found` on `npm publish`, Trusted Publisher is not linked yet — use `NPM_TOKEN` instead.

### Release flow

1. Bump `version` in `package.json` and push to `main`
2. Tag and push: `git tag v0.1.2 && git push origin v0.1.2` (or create a GitHub Release)
3. The **Publish** workflow runs lint, build, and `npm publish`
4. In n8n: **Settings → Community Nodes → update** `n8n-nodes-humanstep`

### Verification (optional, later)

After smoke-testing the published package, submit for n8n verification at [creators.n8n.io/nodes](https://creators.n8n.io/nodes).

## Troubleshooting

| Issue | Check |
|-------|-------|
| Credential test fails | API key valid, Base URL ends with `/api`, no trailing slash issues |
| Trigger never fires | n8n webhook URL publicly reachable; workflow is active |
| Webhook registration fails | Inspect n8n execution log; verify `POST /api/webhooks` with curl |
| Template fields empty | Template ID valid; `GET /api/templates/:id` returns `fields_schema` |
