// Node.js proxy for Anthropic API (ESM version)
import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

app.post('/api/anthropic', async (req, res) => {
  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
      },
      body: JSON.stringify(req.body),
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Anthropic proxy running on port ${PORT}`);
});

// Instructions:
// 1. Install dependencies: npm install express node-fetch cors dotenv
// 2. Create a .env file with ANTHROPIC_API_KEY=your_key_here
// 3. Start server: node api/anthropic-proxy.mjs
// 4. In your frontend, POST to /api/anthropic instead of directly to Anthropic
