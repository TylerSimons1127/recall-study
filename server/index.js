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

const BLOOM_DESCRIPTIONS = {
  basic:      "focus on recall: terms, definitions, key facts",
  application:"focus on applying ideas: scenarios, examples, use cases",
  analysis:   "focus on comparing, contrasting, cause/effect, synthesis",
};
const EASE_DESCRIPTIONS = {
  easy:   "very short answers, single word or phrase, no trickiness",
  medium: "one-sentence answers, require reading carefully",
  hard:   "longer answers that need precise wording or two concepts combined",
};
const STYLE_PROMPTS = {
  term:      `strict "term — definition" pairs`,
  qa:        `question-and-answer pairs where q is a genuine question`,
  cloze:     `cloze-deletion style: q shows a sentence with a blanked term (_____), a is the missing term`,
  truefalse: `true/false statements in q ("True or false: ..."), a is "True" or "False" plus one sentence why`,
  mixed:     `a healthy mix of term-definition, Q&A, cloze, and true/false`,
};

app.post("/api/generate", async (req, res) => {
  const { text, title, count, depth, ease, style } = req.body || {};
  if (!text || typeof text !== "string" || text.trim().length < 20) {
    return res.status(400).json({ error: "text required (at least 20 chars)" });
  }
  const userKey = (req.headers["x-user-key"] || "").trim();
  const useKey = userKey || SERVER_KEY;
  if (!useKey) return res.status(503).json({ error: "no OpenRouter key configured on server" });

  // Missing fields → sensible defaults ("let the AI decide" when count is 0 / "ai")
  const depthD = BLOOM_DESCRIPTIONS[depth] || BLOOM_DESCRIPTIONS.application;
  const easeD = EASE_DESCRIPTIONS[ease] || EASE_DESCRIPTIONS.medium;
  const styleD = STYLE_PROMPTS[style] || STYLE_PROMPTS.mixed;
  const requested = (count && count !== "ai") ? parseInt(count, 10) : null;
  const inferred = requested ?? Math.min(30, Math.max(6, Math.floor(text.split(/\s+/).length / 28)));

  const prompt = [
    {
      role: "system",
      content: "You are a flashcard extractor. Return only a strict JSON array of {q, a} objects — no markdown, no explanation, no code fences. Facts must come only from the supplied text.",
    },
    {
      role: "user",
      content: `Extract ${inferred} study flashcards from this ${title ? `material about "${title}"` : "material"}.\n\nDEPTH: ${depthD}.\nEASE: ${easeD}.\nFORMAT: ${styleD}.\n\nTEXT:\n${text.slice(0, 8000)}`,
    },
  ];

  try {
    const firstModel = MODEL;
    let usedModel = firstModel;
    let data = null;

    for (const candidate of [firstModel, ...FALLBACK_MODELS] ) {
      const r = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${useKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://tylersimons1127.github.io/recall-study/",
          "X-Title": "Recall Study",
        },
        body: JSON.stringify({ model: candidate, messages: prompt, temperature: 0.3, max_tokens: 3000 }),
      });
      if (r.ok) { data = await r.json(); usedModel = candidate; break; }
      if (r.status !== 404) {
        const body = await r.text();
        return res.status(r.status).json({ error: `openrouter ${r.status}`, detail: body.slice(0, 400) });
      }
    }

    if (!data) {
      return res.status(404).json({ error: "all model fallbacks 404'd — no free model available right now" });
    }

    const content = data.choices?.[0]?.message?.content || "";
    const match = content.match(/\[[\s\S]*\]/);
    if (!match) return res.status(502).json({ error: "model did not return JSON", raw: content.slice(0, 300) });
    let arr;
    try { arr = JSON.parse(match[0]); } catch { return res.status(502).json({ error: "invalid JSON from model", raw: match[0].slice(0, 300) }); }
    const cards = arr
      .filter(c => c && typeof c.q === "string" && typeof c.a === "string" && c.q.trim() && c.a.trim())
      .slice(0, 40)
      .map(c => ({ q: c.q.trim().slice(0, 300), a: c.a.trim().slice(0, 600) }));
    res.json({ cards, model: usedModel, source: userKey ? "user" : "shared", requested: inferred });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// POST /api/explain — answer a card with a step-by-step of where it appeared
app.post("/api/explain", async (req, res) => {
  const { front, back, sourceText } = req.body || {};
  if (!front || !back) return res.status(400).json({ error: "front and back required" });
  const userKey = (req.headers["x-user-key"] || "").trim();
  const useKey = userKey || SERVER_KEY;
  if (!useKey) return res.status(503).json({ error: "no OpenRouter key configured on server" });
  const prompt = [
    { role: "system", content: "You are a patient teacher explaining how a flashcard answer traces to the source text. Be brief (2-4 sentences). Quote the relevant source snippet." },
    { role: "user", content: `Term: ${front}\nMy answer: ${back}\n\nSource text excerpt:\n${(sourceText||"").slice(0, 3000) || "(no source — explain from the term alone)"}` },
  ];
  const r = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: { "Authorization": `Bearer ${useKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, messages: prompt, temperature: 0.4, max_tokens: 500 }),
  });
  if (!r.ok) return res.status(r.status).json({ error: `openrouter ${r.status}`, detail: (await r.text()).slice(0, 300) });
  const data = await r.json();
  res.json({ explanation: data.choices?.[0]?.message?.content || "" });
});

app.listen(PORT, () => console.log(`recall-api listening on ${PORT}`));