// Recall backend — Express + OpenRouter on Render, plus optional per-user key for heavy users
import express from "express";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 3001;
const SERVER_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = process.env.MODEL || "meta-llama/llama-3.2-3b-instruct:free";
// Free models that OpenRouter keeps rotating; server tries in order on 404.
const FALLBACK_MODELS = [
  MODEL,
  "meta-llama/llama-3.2-3b-instruct:free",
  "google/gemma-3-1b-it:free",
  "google/gemma-2-9b-instruct:free",
  "mistralai/mistral-7b-instruct:free",
  "nousresearch/hermes-3-llama-3.2-405b:free",
].filter((v,i,a)=>a.indexOf(v)===i);

app.use(cors({ origin: true }));
app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req, res) => res.json({ ok: true, model: MODEL, shared: !!SERVER_KEY }));

// POST /api/generate { text, title? } -> { cards: [{q, a}] }
// Optional header: X-User-Key: sk-or-v1-...  → use that key instead of shared one.
app.post("/api/generate", async (req, res) => {
  const { text, title } = req.body || {};
  if (!text || typeof text !== "string" || text.trim().length < 20) {
    return res.status(400).json({ error: "text required (at least 20 chars)" });
  }
  const userKey = (req.headers["x-user-key"] || "").trim();
  const useKey = userKey || SERVER_KEY;
  if (!useKey) return res.status(503).json({ error: "no OpenRouter key configured on server" });

  const want = Math.min(20, Math.max(5, Math.floor(text.split(/\s+/).length / 30)));
  const prompt = [
    {
      role: "system",
      content: "You are a flashcard extractor. Return only a strict JSON array of {q, a} objects — no markdown, no explanation, no code fences. Facts must come only from the supplied text.",
    },
    {
      role: "user",
      content: `Extract ${want} study flashcards from this ${title ? `material about "${title}"` : "material"}. JSON array only.\n\nTEXT:\n${text.slice(0, 8000)}`,
    },
  ];
  try {
    const r = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${useKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://tylersimons1127.github.io/recall-study/",
        "X-Title": "Recall Study",
      },
      body: JSON.stringify({ model: MODEL, messages: prompt, temperature: 0.2, max_tokens: 2000 }),
    });

    let data, r0 = r;
    if (r.status === 404) {
      for (const alt of FALLBACK_MODELS) {
        if (alt === MODEL) continue;
        const r2 = await fetch(OPENROUTER_URL, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${useKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://tylersimons1127.github.io/recall-study/",
            "X-Title": "Recall Study",
          },
          body: JSON.stringify({ model: alt, messages: prompt, temperature: 0.2, max_tokens: 2000 }),
        });
        if (r2.ok) { r0 = r2; break; }
      }
      if (r0.status === 404) {
        const body = await r.text();
        return res.status(404).json({ error: `openrouter 404`, detail: body.slice(0, 400) });
      }
    }
    if (!r0.ok) {
      const body = await r0.text();
      return res.status(r0.status).json({ error: `openrouter ${r0.status}`, detail: body.slice(0, 400) });
    }
    data = await r0.json();
    const content = data.choices?.[0]?.message?.content || "";
    const match = content.match(/\[[\s\S]*\]/);
    if (!match) return res.status(502).json({ error: "model did not return JSON", raw: content.slice(0, 300) });
    let arr;
    try { arr = JSON.parse(match[0]); } catch { return res.status(502).json({ error: "invalid JSON from model", raw: match[0].slice(0, 300) }); }
    const cards = arr
      .filter(c => c && typeof c.q === "string" && typeof c.a === "string" && c.q.trim() && c.a.trim())
      .slice(0, 30)
      .map(c => ({ q: c.q.trim().slice(0, 300), a: c.a.trim().slice(0, 600) }));
    res.json({ cards, model: data.model || MODEL, source: userKey ? "user" : "shared" });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.listen(PORT, () => console.log(`recall-api listening on ${PORT}`));