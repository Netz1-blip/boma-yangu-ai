# API reference

Boma Yangu AI exposes one production endpoint for chat.

---

## `POST /api/chat`

Serverless handler: `api/chat.js`  
Runtime: Node.js on Vercel (ES modules).

### Purpose

Accept a conversation history, retrieve relevant knowledge-base chunks, and return one assistant message from Cerebras.

---

### Request

**Headers**

| Header | Value |
|--------|-------|
| `Content-Type` | `application/json` |

**Body (JSON)**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `messages` | `array` | Yes | OpenAI-style chat messages `{ role, content }` |
| `county` | `string \| null` | No | County name for retrieval filter (e.g. `"Nairobi"`) |

**`messages` rules**

- Must be non-empty array.
- Must contain at least one message with `role: "user"`.
- Only the **last 6** messages are used server-side (`MAX_HISTORY`).
- `content` may be a string or multimodal array; strings are preferred.

**Example**

```json
{
  "messages": [
    { "role": "user", "content": "How much is the housing levy?" }
  ],
  "county": "Nairobi"
}
```

The client (`index.html`) typically sends up to 12 messages but the server trims again to 6.

---

### Response

**Success — `200 OK`**

```json
{
  "reply": "The housing levy is **1.5%** of your gross monthly salary…\n\n> Source: [KRA](https://www.kra.go.ke)"
}
```

**Error responses**

| Status | Body | Meaning |
|--------|------|---------|
| `400` | `{ "error": "messages array is required." }` | Invalid payload |
| `400` | `{ "error": "No user message found." }` | No user role in history |
| `405` | `{ "error": "Method not allowed." }` | Not POST |
| `429` | `{ "error": "AI is busy. Please wait…" }` | Cerebras rate limit |
| `500` | `{ "error": "Server configuration error." }` | Missing `CEREBRAS_API_KEY` |
| `500` | `{ "error": "Empty response…" }` | Model returned no content |
| `502` | `{ "error": "Failed to reach AI service…" }` | Network/upstream failure |

---

### `OPTIONS /api/chat`

Returns `200` with CORS headers for browser preflight.

---

## Internal: retrieval module

Not HTTP-exposed; used by `api/chat.js`.

### `retrieve(query, opts)`

**File:** `lib/retrieval.js`

| Option | Default | Description |
|--------|---------|-------------|
| `topK` | `5` | Max chunks returned |
| `scope` | `null` | Filter by scope label |
| `county` | `null` | Filter by county label |

**Returns:** Array of:

```ts
{
  text: string;
  source: string;
  scope: string;
  county: string | null;
  score: number;
  method: "vector" | "keyword";
}
```

### `formatContext(chunks)`

Returns a single string for the system prompt, or `NO_KB_MATCH: …` if empty.

---

## Prompt & citation behaviour

The model is instructed to:

1. Answer in the user’s language (English or Swahili).
2. Use KB context first; avoid inventing figures.
3. End factual answers with `> Source: [Portal Name](URL)` using the **SOURCE URL LEGEND** built from retrieved chunk filenames.

Filename → URL mapping lives in `SOURCE_URLS` inside `api/chat.js`. Unknown files default to `https://www.bomayangu.go.ke`.

---

## Upstream: Cerebras

| Setting | Value |
|---------|-------|
| URL | `https://api.cerebras.ai/v1/chat/completions` |
| Model | `gpt-oss-120b` |
| Temperature | `0.3` |
| Max tokens | `900` |

**Auth:** `Authorization: Bearer ${CEREBRAS_API_KEY}`

---

## Upstream: Hugging Face (embeddings)

| Setting | Value |
|---------|-------|
| Model | `sentence-transformers/all-MiniLM-L6-v2` |
| Auth | `Bearer ${HF_TOKEN}` |
| Used at | Query time (`retrieval.js`) and build time (`buildVectors.js`) |

---

## Client integration example

```javascript
const res = await fetch('/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    messages: [
      { role: 'user', content: 'Je, ninastahili nyumba nafuu?' }
    ],
    county: selectedCounty || null
  })
});

if (!res.ok) throw new Error('api');
const { reply } = await res.json();
```

---

## Rate limiting & abuse

- **Client:** 4-second debounce between sends (`index.html`).
- **Server:** No custom rate limiter; relies on Cerebras/HF quotas.
- **Recommendation:** Add Vercel firewall or edge rate limiting if abused publicly.
