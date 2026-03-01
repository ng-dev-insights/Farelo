// ─── Farelo · OpenAI Proxy ────────────────────────────────────────────────────
// Secure server-side proxy so the API key never reaches the browser.
//
// Setup:
//   1.  npm install express node-fetch cors dotenv express-rate-limit
//   2.  Create .env file (see .env.example below — NEVER commit the real one)
//   3.  node openai-proxy.mjs
//
// .env.example ─────────────────────────────────────────────────────────────────
//   OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxxxxxxxxx   ← your real key goes here
//   PORT=4000
//   ALLOWED_ORIGIN=http://localhost:3000           ← your frontend URL
// ──────────────────────────────────────────────────────────────────────────────

import express    from 'express';
import fetch      from 'node-fetch';
import cors       from 'cors';
import dotenv     from 'dotenv';
import rateLimit  from 'express-rate-limit';

dotenv.config();

// ── Fail fast if key is missing ───────────────────────────────────────────────
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY || OPENAI_API_KEY.trim() === '') {
  console.error('❌  OPENAI_API_KEY is not set in .env — aborting.');
  process.exit(1);
}

const OPENAI_URL     = 'https://api.openai.com/v1/chat/completions';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'http://localhost:3000';
const PORT           = parseInt(process.env.PORT || '4000', 10);

// ── Allowed models (whitelist — prevents misuse of your key) ──────────────────
const ALLOWED_MODELS = new Set([
  'gpt-3.5-turbo',
  'gpt-3.5-turbo-0125',
  'gpt-4o-mini',       // cheap + fast — good upgrade from 3.5
]);

// ── Max tokens we'll ever forward (budget cap) ───────────────────────────────
const MAX_TOKENS_ALLOWED = 400;

const app = express();

// ── CORS — only your frontend domain ─────────────────────────────────────────
app.use(cors({
  origin: ALLOWED_ORIGIN,
  methods: ['POST'],
}));

app.use(express.json({ limit: '16kb' })); // reject oversized bodies

// ── Rate limiting — 30 estimates per IP per minute ───────────────────────────
const limiter = rateLimit({
  windowMs : 60 * 1000,   // 1 minute
  max      : 30,
  message  : { error: 'Too many requests — please wait a moment.' },
  standardHeaders: true,
  legacyHeaders  : false,
});
app.use('/api/openai', limiter);
app.use('/openai',     limiter);

// ── Main handler ──────────────────────────────────────────────────────────────
async function handleOpenAI(req, res) {
  const { model, messages, max_tokens } = req.body ?? {};

  // ── Validate model ─────────────────────────────────────────────────────────
  if (!model || !ALLOWED_MODELS.has(model)) {
    return res.status(400).json({
      error: `Model '${model}' is not allowed. Use one of: ${[...ALLOWED_MODELS].join(', ')}`,
    });
  }

  // ── Validate messages ──────────────────────────────────────────────────────
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: '`messages` must be a non-empty array.' });
  }

  // ── Cap max_tokens ─────────────────────────────────────────────────────────
  const safTokens = Math.min(
    typeof max_tokens === 'number' && max_tokens > 0 ? max_tokens : 300,
    MAX_TOKENS_ALLOWED,
  );

  try {
    const upstream = await fetch(OPENAI_URL, {
      method : 'POST',
      headers: {
        'Content-Type' : 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens      : safTokens,
        temperature     : 0.3,   // lower = more deterministic JSON output
        response_format : { type: 'json_object' },  // GPT-4o-mini / 3.5-turbo-0125 enforce JSON
      }),
    });

    const data = await upstream.json();

    if (!upstream.ok) {
      // Surface OpenAI error without leaking the key
      const msg = data?.error?.message ?? `OpenAI returned HTTP ${upstream.status}`;
      console.error('OpenAI error:', msg);
      return res.status(upstream.status).json({ error: msg });
    }

    return res.json(data);

  } catch (err) {
    console.error('Proxy fetch error:', err.message);
    return res.status(500).json({ error: 'Upstream request failed — try again.' });
  }
}

app.post('/api/openai', handleOpenAI);
app.post('/openai',     handleOpenAI);

// ── Health check (useful for uptime monitors) ─────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// ── 404 catch-all ─────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

app.listen(PORT, () => {
  console.log(`✅  Farelo OpenAI proxy running on port ${PORT}`);
  console.log(`   Allowed origin : ${ALLOWED_ORIGIN}`);
  console.log(`   Allowed models : ${[...ALLOWED_MODELS].join(', ')}`);
});