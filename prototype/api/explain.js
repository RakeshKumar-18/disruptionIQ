// Vercel serverless function: POST /api/explain
// Turns facts worked out by DisruptionIQ's rules into a short plain-English explanation using Google Gemini.
// The API key stays on the server (Vercel environment variable GEMINI_API_KEY); the browser never sees it.
// The rules decide every number; the model only explains and advises. If this fails, the page falls back to rule text.

// First model that answers wins. GEMINI_MODEL (optional) lets you switch models without a code change.
const MODELS = [process.env.GEMINI_MODEL, 'gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-flash-latest'].filter(Boolean);

const RULES =
  'You are the assistant inside DisruptionIQ, a supply-chain disruption tool for a company with warehouses across India. ' +
  'Use only the facts given; never invent numbers, names or dates. Write plain English with no markdown and no bullet points. ' +
  'Write rupee amounts with the ₹ sign. Use totals exactly as given; never add up or recount numbers yourself. ' +
  'You advise and the user decides; do not add a closing line about who makes decisions. ' +
  'Necessity comes first: life-critical deliveries (healthcare) outrank essential services (food, energy, utilities), which outrank ' +
  'operational and commercial orders such as premium subscriptions, whatever their contract priority or value.';

const TASKS = {
  order:
    'Explain in at most 2 short sentences (under 45 words) why this customer order is at risk and what matters most for recovering it.',
  options:
    'The rules engine produced the numbered recovery options below. Recommend which option number(s) the analyst should submit: at ' +
    'most one per order. Never pick a blocked option. Never pick an option whose side_effects are not "none" if the same order has a ' +
    'safe option (do no harm). Prefer options that cover the whole order. Put life-critical orders first, then essential ones, then ' +
    'the earliest due dates and Critical contract priority, and prefer the lowest cost when options are similar. ' +
    'Return "recommended" (the option numbers) and "advice" (at most 3 short sentences, under 70 words, naming options as #N).',
  fragility:
    'A stress test failed each location for a week, in simulation. Explain in at most 3 short sentences (under 75 words) why the ' +
    'top fragile points are fragile and the single most useful step to make the network stronger, using the suggested fixes given.',
  briefing:
    'Write the briefing for the signed-in user (their role is in the facts) in at most 3 short sentences (under 70 words): ' +
    'the overall situation, the single most urgent action and why, and anything waiting on this role. If a life-critical order is at ' +
    'risk, lead with it. If nothing is open, say so briefly. ' +
    'If you greet the user, match the time_of_day given (morning, afternoon, evening or night).',
  approval:
    'Brief the approver on this pending recovery plan in at most 3 short sentences (under 70 words): what approving commits the company ' +
    'to (cost, stock or shipment), what it protects (order value, priority, due date) and one thing to check first. Mention a cheaper ' +
    'or faster alternative only if the facts list one. Do not tell them to approve or reject; they decide.',
  incident:
    'Write a short incident report for the audit log in at most 4 sentences (under 90 words): what happened, which orders and how much ' +
    'value were hit, how each order was recovered, the recovery cost if given, and how long recovery took. Neutral, factual tone.',
};

// Tasks that answer in JSON, so the page can act on the answer (highlight the suggested options).
const SCHEMAS = {
  options: {
    type: 'OBJECT',
    properties: { advice: { type: 'STRING' }, recommended: { type: 'ARRAY', items: { type: 'INTEGER' } } },
    required: ['advice', 'recommended'],
  },
};

// Only this site (and local testing) may call the function from a browser.
const ALLOWED_ORIGIN = /^(https:\/\/disruptioniq[\w-]*\.vercel\.app|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/;

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGIN.test(origin)) return res.status(403).json({ error: 'Not allowed.' });

  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(503).json({ error: 'AI is not set up yet (GEMINI_API_KEY is missing).' });

  const { kind, facts } = req.body || {};
  if (!TASKS[kind] || !facts || typeof facts !== 'object') return res.status(400).json({ error: 'Unknown request.' });
  const data = JSON.stringify(facts);
  if (data.length > 8000) return res.status(413).json({ error: 'Too much data.' });

  const body = {
    systemInstruction: { parts: [{ text: RULES }] },
    contents: [{ role: 'user', parts: [{ text: `${TASKS[kind]}\n\nFacts (JSON):\n${data}` }] }],
    generationConfig: SCHEMAS[kind]
      ? { temperature: 0.3, responseMimeType: 'application/json', responseSchema: SCHEMAS[kind] }
      : { temperature: 0.4 },
  };
  // For JSON tasks, return the advice as `text` and the option numbers as `picks` (only numbers that exist).
  const shape = (raw) => {
    if (!SCHEMAS[kind]) return { text: raw };
    const n = Array.isArray(facts.options) ? facts.options.length : 0;
    let j = null;
    try { j = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { j = null; }
    const text = j && typeof j.advice === 'string' ? j.advice.trim() : raw;
    const from = j && Array.isArray(j.recommended) ? j.recommended : (text.match(/#\s?(\d+)/g) || []).map((x) => x.replace(/\D/g, ''));
    const picks = [...new Set(from.map(Number).filter((x) => Number.isInteger(x) && x >= 1 && x <= n))];
    return { text, picks };
  };

  let lastError = 'No model answered.';
  for (const model of MODELS) {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(8000),
        }
      );
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        lastError = (j.error && j.error.message) || `Gemini returned HTTP ${r.status}.`;
        // Model not found or not available on this key: try the next one. Quota, bad key, etc.: stop.
        if (r.status === 404 || (r.status === 400 && !/api key/i.test(lastError))) continue;
        break;
      }
      const parts = (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
      const text = parts.filter((p) => !p.thought).map((p) => p.text || '').join('').trim();
      if (text) return res.status(200).json({ ...shape(text), model });
      lastError = 'Gemini returned an empty answer.';
    } catch (e) {
      if (e && e.name === 'TimeoutError') { lastError = 'Gemini took too long to answer.'; break; } // the page falls back to rule text
      lastError = String((e && e.message) || e);
    }
  }
  return res.status(502).json({ error: lastError });
};
