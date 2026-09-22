// Recall backend — Express + OpenRouter on Render, plus optional per-user key for heavy users
import express from "express";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 3001;
const SERVER_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = process.env.MODEL || "google/gemma-3n-e2b-it:free";

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
    if (!r.ok) {
      const body = await r.text();
      return res.status(r.status).json({ error: `openrouter ${r.status}`, detail: body.slice(0, 400) });
    }
    const data = await r.json();
    const content = data.choices?.[0]?.message?.content || "";
    const match = content.match(/\[[\s\S]*\]/);
    if (!match) return res.status(502).json({ error: "model did not return JSON", raw: content.slice(0, 300) });
    let arr;
    try { arr = JSON.parse(match[0]); } catch { return res.status(502).json({ error: "invalid JSON from model", raw: match[0].slice(0, 300) }); }
    const cards = arr
      .filter(c => c && typeof c.q === "string" && typeof c.a === "string" && c.q.trim() && c.a.trim())
      .slice(0, 30)
      .map(c => ({ q: c.q.trim().slice(0, 300), a: c.a.trim().slice(0, 600) }));
    res.json({ cards, model: MODEL, source: userKey ? "user" : "shared" });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.listen(PORT, () => console.log(`recall-api listening on ${PORT}`));
