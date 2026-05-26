// lib/retrieval.js
// Boma Yangu AI - Vector Retrieval Engine
// Primary: HuggingFace cosine similarity
// Fallback: keyword search (when HF is slow/unavailable)

import fs from "fs";
import path from "path";

// -- Constants ----------------------------------------------------------------

const VECTORS_PATH    = path.join(process.cwd(), "data", "boma-vectors.json");
const HF_API_URL      = "https://router.huggingface.co/hf-inference/models/sentence-transformers/all-MiniLM-L6-v2/pipeline/feature-extraction";
const TOP_K           = 5;
const SCORE_THRESHOLD = 0.32;
const HF_TIMEOUT_MS   = 5000;  // 5s max per HF attempt — keeps us inside Vercel 10s limit
const HF_RETRIES      = 2;     // 2 attempts max (5s each = 10s budget)
const HF_RETRY_DELAY  = 400;   // ms between retries

// -- Vector store (loaded once, cached in memory) -----------------------------

let _vectorStore = null;

function loadVectorStore() {
  if (_vectorStore) return _vectorStore;
  if (!fs.existsSync(VECTORS_PATH)) {
    throw new Error("Vector store not found at " + VECTORS_PATH + ". Run: node script/buildVectors.js");
  }
  const raw = fs.readFileSync(VECTORS_PATH, "utf-8");
  _vectorStore = JSON.parse(raw);
  console.log("[retrieval] Loaded " + _vectorStore.length + " chunks.");
  return _vectorStore;
}

// -- Math helpers -------------------------------------------------------------

function dot(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

function norm(v) { return Math.sqrt(dot(v, v)); }

function cosineSimilarity(a, b) {
  const denom = norm(a) * norm(b);
  return denom === 0 ? 0 : dot(a, b) / denom;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// -- HuggingFace embedding (with timeout + retry) -----------------------------

async function embedQuery(queryText) {
  const hfToken = process.env.HF_TOKEN;
  if (!hfToken) throw new Error("HF_TOKEN not set.");

  let lastError;

  for (let attempt = 1; attempt <= HF_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HF_TIMEOUT_MS);

    try {
      const response = await fetch(HF_API_URL, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + hfToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inputs: queryText,
          options: { wait_for_model: true },
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (response.status === 429 || response.status === 503) {
        console.warn("[retrieval] HF status " + response.status + " on attempt " + attempt);
        if (attempt < HF_RETRIES) await sleep(HF_RETRY_DELAY);
        continue;
      }

      if (!response.ok) {
        const errText = await response.text();
        throw new Error("HF error [" + response.status + "]: " + errText);
      }

      const result = await response.json();
      const embedding = Array.isArray(result[0]) ? result[0] : result;

      if (!Array.isArray(embedding) || embedding.length !== 384) {
        throw new Error("Bad embedding shape: " + embedding?.length);
      }

      if (attempt > 1) console.log("[retrieval] HF succeeded on attempt " + attempt);
      return embedding;

    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      const reason = err.name === "AbortError" ? "timeout after " + HF_TIMEOUT_MS + "ms" : err.message;
      console.warn("[retrieval] Attempt " + attempt + " failed: " + reason);
      if (attempt < HF_RETRIES) await sleep(HF_RETRY_DELAY);
    }
  }

  throw new Error("HF failed after " + HF_RETRIES + " attempts: " + lastError?.message);
}

// -- Keyword fallback search --------------------------------------------------
// When HF is unavailable, score chunks by word overlap with the query.
// Not as precise as vector search but keeps the app working.

function keywordSearch(query, store, topK) {
  console.log("[retrieval] Using keyword fallback.");

  const stopWords = new Set([
    "a","an","the","is","are","was","were","be","been","being",
    "have","has","had","do","does","did","will","would","could","should",
    "i","you","he","she","it","we","they","me","him","her","us","them",
    "and","or","but","so","yet","for","nor","as","at","by","to","of",
    "in","on","with","from","into","about","what","how","when","where",
    "which","who","that","this","these","those","my","your","our","their",
    // Swahili common words
    "na","ya","wa","za","la","ni","si","kwa","katika","au","pia","hii",
    "hizi","hiyo","hilo","je","nini","wapi","jinsi","wakati","ikiwa"
  ]);

  const queryWords = query.toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w));

  if (queryWords.length === 0) return [];

  const scored = store.map(chunk => {
    const text = chunk.text.toLowerCase();
    let score = 0;
    for (const word of queryWords) {
      // Count occurrences — more hits = more relevant
      const count = (text.match(new RegExp(word, "g")) || []).length;
      score += count;
    }
    return {
      text:   chunk.text,
      source: chunk.source || "unknown",
      scope:  chunk.scope  || "national",
      county: chunk.county || null,
      score:  score / (queryWords.length * 10), // normalise to ~0-1
      method: "keyword",
    };
  });

  return scored
    .filter(c => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

// -- Main retrieval function --------------------------------------------------

export async function retrieve(query, opts = {}) {
  const { topK = TOP_K, scope = null, county = null } = opts;

  const store = loadVectorStore();

  // Filter by scope / county
  let candidates = store;
  if (scope)  candidates = candidates.filter(c => c.scope?.toLowerCase()  === scope.toLowerCase());
  if (county) candidates = candidates.filter(c => c.county?.toLowerCase() === county.toLowerCase());

  // -- Try vector search first -----------------------------------------------
  try {
    const queryVec = await embedQuery(query);

    const scored = candidates.map(chunk => ({
      text:   chunk.text,
      source: chunk.source || "unknown",
      scope:  chunk.scope  || "national",
      county: chunk.county || null,
      score:  cosineSimilarity(queryVec, chunk.embedding),
      method: "vector",
    }));

    const results = scored
      .filter(c => c.score >= SCORE_THRESHOLD)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    console.log("[retrieval] Vector search => " + results.length + " chunks (threshold: " + SCORE_THRESHOLD + ")");

    // If vector search returns nothing useful, try keyword fallback too
    if (results.length === 0) {
      console.log("[retrieval] No vector matches — trying keyword fallback.");
      return keywordSearch(query, candidates, topK);
    }

    return results;

  } catch (err) {
    // -- HF failed — use keyword fallback ------------------------------------
    console.error("[retrieval] Vector search failed, using keyword fallback. Error: " + err.message);
    return keywordSearch(query, candidates, topK);
  }
}

// -- Format context for LLM --------------------------------------------------

export function formatContext(chunks) {
  if (!chunks || chunks.length === 0) {
    return "NO_KB_MATCH: No relevant content found in the knowledge base. The model MUST NOT invent an answer. Say you do not have that information and direct the user to boma.go.ke or call 0700 832 832.";
  }

  const method = chunks[0]?.method === "keyword" ? " [keyword fallback]" : "";
  console.log("[retrieval] Formatting " + chunks.length + " chunks" + method);

  return chunks
    .map((c, i) => {
      const label = c.county
        ? "[" + (c.scope || "NATIONAL").toUpperCase() + " - " + c.county + "]"
        : "[" + (c.scope || "NATIONAL").toUpperCase() + "]";
      return "--- Source " + (i + 1) + ": " + c.source + " " + label + " ---\n" + c.text;
    })
    .join("\n\n");
}