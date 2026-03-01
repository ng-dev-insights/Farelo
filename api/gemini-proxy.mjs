// ─── Farelo · Gemini Proxy ────────────────────────────────────────────────────

import express   from 'express';
import fetch     from 'node-fetch';
import cors      from 'cors';
import dotenv    from 'dotenv';
import rateLimit from 'express-rate-limit';

dotenv.config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error('❌  GEMINI_API_KEY is not set in .env — aborting.');
  process.exit(1);
}

const GEMINI_MODEL   = 'gemini-2.0-flash-lite';
const GEMINI_URL     = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'http://localhost:5173';
const PORT           = parseInt(process.env.PORT || '4000', 10);

const app = express();
app.use(cors({ origin: '*', methods: ['POST', 'GET'] })); // open for debugging
app.use(express.json({ limit: '16kb' }));

const limiter = rateLimit({ windowMs: 60 * 1000, max: 14 });
app.use('/api/openai', limiter);
app.use('/openai',     limiter);

function toGeminiPayload(messages) {
  const system  = messages.find(m => m.role === 'system');
  const userMsg = messages.filter(m => m.role !== 'system');
  const contents = userMsg.map((m, i) => ({
    role : m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: (i === 0 && system) ? `${system.content}\n\n${m.content}` : m.content }],
  }));
  return {
    contents,
    generationConfig: { temperature: 0.2, maxOutputTokens: 350 },
  };
}

function toOpenAIShape(geminiData) {
  const text = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  return { choices: [{ message: { role: 'assistant', content: text } }], model: GEMINI_MODEL };
}

async function handleRequest(req, res) {
  const { messages } = req.body ?? {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: '`messages` must be a non-empty array.' });
  }

  const payload = toGeminiPayload(messages);
  console.log('\n─── Outgoing Gemini request ───────────────────────');
  console.log('URL   :', GEMINI_URL.replace(GEMINI_API_KEY, 'KEY_HIDDEN'));
  console.log('Body  :', JSON.stringify(payload, null, 2));

  try {
    const upstream = await fetch(GEMINI_URL, {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify(payload),
    });

    const rawText = await upstream.text(); // read as text first — JSON.parse can itself throw
    console.log('\n─── Gemini raw response ───────────────────────────');
    console.log('Status:', upstream.status);
    console.log('Body  :', rawText.slice(0, 800)); // first 800 chars

    let data;
    try {
      data = JSON.parse(rawText);
    } catch (parseErr) {
      console.error('JSON parse failed:', parseErr.message);
      return res.status(502).json({ error: 'Gemini returned non-JSON response.', raw: rawText.slice(0, 200) });
    }

    if (!upstream.ok) {
      const msg = data?.error?.message ?? `Gemini HTTP ${upstream.status}`;
      if (upstream.status === 429) return res.status(429).json({ error: 'Rate limit hit.' });
      return res.status(upstream.status).json({ error: msg });
    }

    return res.json(toOpenAIShape(data));

  } catch (err) {
    // This only fires for network errors (DNS failure, connection refused, etc.)
    console.error('Network error:', err.message);
    return res.status(500).json({ error: `Network error: ${err.message}` });
  }
}

app.post('/api/openai', handleRequest);
app.post('/openai',     handleRequest);

// ── Quick test endpoint — hit this in browser to confirm proxy+key work ───────
app.get('/test', async (_req, res) => {
  try {
    const upstream = await fetch(GEMINI_URL, {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'Reply with just the word: working' }] }],
        generationConfig: { maxOutputTokens: 10 },
      }),
    });
    const text = await upstream.text();
    console.log('/test response:', text.slice(0, 400));
    res.send(`<pre>Status: ${upstream.status}\n\n${text.slice(0, 800)}</pre>`);
  } catch (e) {
    res.status(500).send(`Network error: ${e.message}`);
  }
});

app.get('/health', (_req, res) => res.json({ ok: true, model: GEMINI_MODEL }));
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

app.listen(PORT, () => {
  console.log(`✅  Gemini proxy on port ${PORT} — model: ${GEMINI_MODEL}`);
  console.log(`   Test it: http://localhost:${PORT}/test`);
});