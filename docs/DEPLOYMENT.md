# Deployment

Boma Yangu AI is deployed on **Vercel** as a static site plus serverless API routes.

---

## Production URLs

| Environment | URL |
|-------------|-----|
| Production alias | https://boma-yangu-ai.vercel.app |
| Vercel project | `boma-yangu-ai` (org: linked in `.vercel/project.json`) |

Deployment-specific URLs are also issued per deploy (see CLI output).

---

## Prerequisites

1. [Vercel account](https://vercel.com) with project linked to this repository/folder
2. [Vercel CLI](https://vercel.com/docs/cli): `npm i -g vercel`
3. Environment variables configured in Vercel dashboard

---

## Environment variables (Vercel)

Set for **Production**, **Preview**, and **Development**:

| Name | Description |
|------|-------------|
| `CEREBRAS_API_KEY` | API key from Cerebras Cloud |
| `HF_TOKEN` | Hugging Face token with inference access |

**Local development:** duplicate in `.env.local` (never commit).

```env
CEREBRAS_API_KEY=your_key_here
HF_TOKEN=your_hf_token_here
```

---

## First-time setup

From project root:

```bash
npm install
vercel link    # if not already linked (.vercel/ exists)
```

Follow prompts to select team and project (or create `boma-yangu-ai`).

---

## Deploy commands

### Production

```bash
vercel --prod
```

Non-interactive:

```bash
vercel --prod --yes
```

### Preview

```bash
vercel
```

Creates a preview URL for branch/change review.

---

## What gets deployed

Vercel includes:

| Path | Role |
|------|------|
| `index.html`, `eligibility.html` | Static pages |
| `api/chat.js` | Serverless function |
| `lib/retrieval.js` | Bundled with API |
| `data/boma-vectors.json` | Loaded at runtime by retrieval |
| `package.json` | Dependency install (`dotenv` only used in build script locally) |
| `vercel.json` | Rewrites |

**Not required on server:** `knowledge/` folder (unless you add build step later). Vectors are prebuilt.

**Excluded by `.gitignore`:** `.env.local`, `.vercel` (local link metadata may exist in repo — avoid committing secrets).

---

## Build behaviour

`package.json` has no `build` script. Vercel runs:

1. `npm install` (installs `dotenv`)
2. Deploys static output + API

Vector generation is **manual** before deploy:

```bash
node script/buildVectors.js
git add data/boma-vectors.json
# commit when ready
vercel --prod
```

---

## URL rewrites

`vercel.json`:

```json
{
  "rewrites": [
    { "source": "/eligibility", "destination": "/eligibility.html" }
  ]
}
```

Add more rewrites here for future pages (e.g. `/about` → `about.html`).

---

## Serverless limits

| Concern | Detail |
|---------|--------|
| Function timeout | Default Vercel hobby/pro limits apply (~10s on hobby) |
| Payload size | Keep `boma-vectors.json` within plan memory; monitor cold start |
| Region | Default US East (`iad1`) in build logs |

If timeouts occur:

- HF embedding already has 5s cap + keyword fallback
- Reduce `TOP_K` or optimise vector file size
- Consider Pro plan or edge config

---

## Post-deploy verification

1. **Home:** https://boma-yangu-ai.vercel.app loads chat UI
2. **Eligibility:** https://boma-yangu-ai.vercel.app/eligibility loads checker
3. **API:** Send a test message; verify JSON `{ reply }` in Network tab
4. **Language:** Ask same question in Swahili; reply should be Swahili only
5. **NO_KB_MATCH:** Ask obscure unrelated question; should defer to portal, not invent

---

## Rollback

In Vercel dashboard:

1. Project → Deployments
2. Select previous successful deployment
3. **Promote to Production**

Or redeploy a known-good git commit:

```bash
git checkout <commit>
vercel --prod --yes
```

---

## Custom domain (optional)

1. Vercel project → Settings → Domains
2. Add domain (e.g. `ai.example.co.ke`)
3. Configure DNS per Vercel instructions
4. SSL is automatic

Update any hardcoded links if you move off `*.vercel.app`.

---

## CI/CD (optional future)

Example GitHub Action on push to `main`:

```yaml
# Illustrative — not included in repo
- run: npm install
- run: node script/buildVectors.js  # only if knowledge/ changed
- run: vercel deploy --prod --token=${{ secrets.VERCEL_TOKEN }}
```

Store `VERCEL_TOKEN`, `CEREBRAS_API_KEY`, and `HF_TOKEN` as repository secrets.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| 500 “Server configuration error” | Missing `CEREBRAS_API_KEY` | Set env in Vercel, redeploy |
| Generic connection error in UI | API 502/网络 | Check Cerebras status; logs in Vercel |
| Answers ignore KB | Stale/missing vectors | Rebuild `boma-vectors.json`, redeploy |
| `/eligibility` 404 | Missing rewrite | Ensure `vercel.json` committed |
| Slow first message | Cold start + large JSON | Normal; warms on repeat requests |
| HF errors in logs | Token/rate limit | Verify `HF_TOKEN`; keyword fallback should still run |

View logs: Vercel → Project → Deployments → Functions → `/api/chat`.
