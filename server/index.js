// Recall backend — Express + OpenRouter on Render, with file parsing + options + explanations
import express from "express";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 3001;
const SERVER_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const FALLBACK_MODELS = [
  "google/gemma-4-26b-a4b-it:free",
  "google/gemma-4-31b-it:free",
  "google/gemma-2-9b-it:free",
  "meta/llama-3.2-3b-instruct:free",
  "mistralai/mistral-7b-instruct",
].filter((v,i,a)=>a.indexOf(v)===i);
const MODEL = process.env.MODEL || FALLBACK_MODELS[0];

app.use(cors({ origin: true }));
app.use(express.json({ limit: "10mb" }));

app.get("/health", (_req, res) => res.json({ ok: true, model: MODEL, shared: !!SERVER_KEY }));

const BLOOM = {
  basic:      "focus on recall: terms, definitions, key facts",
  application:"focus on applying ideas: scenarios, examples, use cases",
  analysis:   "focus on comparing, contrasting, cause/effect, synthesis",
};
const EASE = {
  easy:   "very short answers, single word or phrase, no trickiness",
  medium: "one-sentence answers, require reading carefully",
  hard:   "longer answers that need precise wording or two concepts combined",
};
const STYLE = {
  term:      `strict "term — definition" pairs`,
  qa:        `question-and-answer pairs where q is a genuine question`,
  cloze:     `cloze-deletion style: q shows a sentence with a blanked term (_____), a is the missing term`,
  truefalse: `true/false statements in q ("True or false: ..."), a is "True" or "False" plus one sentence why`,
  mixed:     `a healthy mix of term-definition, Q&A, cloze, and true/false`,
};

async function callModel(useKey, messages, maxT=2500, temp=0.3){
  for (const candidate of [MODEL, ...FALLBACK_MODELS.filter(c=>c!==MODEL)]) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${useKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://tylersimons1127.github.io/recall-study/",
          "X-Title": "Recall Study",
        },
        body: JSON.stringify({ model: candidate, messages, temperature: temp, max_tokens: maxT }),
      });
      if (r.ok) return { data: await r.json(), model: candidate };
      const body = await r.text();
      const bodyPreview = body.slice(0, 200);
      // Retry on rate-limit (429) with backoff
      if (r.status === 429 && attempt < 2) { await new Promise(res=>setTimeout(res, 2000 * (attempt + 1))); continue; }
      // On 429 after exhausting retries, or model-resolution error: move to next model (break inner, continue outer)
      if (r.status === 429 || r.status === 404 || (r.status === 400 && body.includes("is not a valid model"))) break;
      // Other errors: throw immediately
      throw Object.assign(new Error(`openrouter ${r.status}`), { status: r.status, body: bodyPreview });
    }
    const err = new Error(`openrouter 429 rate-limited all models`); err.status = 429; throw err;
  }
  const e = new Error("all model fallbacks exhausted"); e.status = 404; throw e;
}

app.post("/api/generate", async (req, res) => {
  const { text, title, count, depth, ease, style } = req.body || {};
  if (!text || typeof text !== "string" || text.trim().length < 20) return res.status(400).json({ error: "text required (at least 20 chars)" });
  const userKey = (req.headers["x-user-key"] || "").trim();
  const useKey = userKey || SERVER_KEY;
  if (!useKey) return res.status(503).json({ error: "no OpenRouter key configured on server" });

  const requested = (count && String(count) !== "ai") ? parseInt(count, 10) : Math.min(30, Math.max(6, Math.floor(text.split(/\s+/).length / 28)));
  const prompt = [
    { role: "system", content: "You are a flashcard extractor. Return only a strict JSON array of {q, a} objects — no markdown, no explanation, no code fences. Facts must come only from the supplied text." },
    { role: "user", content: `Extract ${requested} study flashcards from this ${title ? `material about "${title}"` : "material"}.\n\nDEPTH: ${BLOOM[depth] || BLOOM.application}.\nEASE: ${EASE[ease] || EASE.medium}.\nFORMAT: ${STYLE[style] || STYLE.mixed}.\n\nTEXT:\n${text.slice(0, 8000)}` },
  ];

  try {
    const { data, model } = await callModel(useKey, prompt);
    const content = data.choices?.[0]?.message?.content || "";
    const match = content.match(/\[[\s\S]*\]/);
    if (!match) return res.status(502).json({ error: "model did not return JSON", raw: content.slice(0, 300) });
    let arr;
    try { arr = JSON.parse(match[0]); } catch { return res.status(502).json({ error: "invalid JSON from model", raw: match[0].slice(0, 300) }); }
    const cards = arr.filter(c => c && typeof c.q === "string" && typeof c.a === "string" && c.q.trim() && c.a.trim()).slice(0, 40).map(c => ({ q: c.q.trim().slice(0, 300), a: c.a.trim().slice(0, 600) }));
    res.json({ cards, model, source: userKey ? "user" : "shared", requested });
  } catch (e) {
    res.status(e.status || 500).json({ error: String(e.message || e), detail: e.body ? e.body.slice(0,300) : undefined });
  }
});

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
  try {
    const { data } = await callModel(useKey, prompt, 500, 0.4);
    res.json({ explanation: data.choices?.[0]?.message?.content || "" });
  } catch (e) { res.status(e.status || 500).json({ error: String(e.message || e) }); }
});

app.listen(PORT, () => console.log(`recall-api listening on ${PORT}`));
