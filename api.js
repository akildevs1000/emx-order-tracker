const express = require('express');
const axios = require('axios');
require('dotenv').config();


const app = express();
const HOST = process.env.HOST || '0.0.0.0';
const PORT = process.env.PORT || 3000;

const BASE_URL = 'https://www.emx.ae';

let buildIdCache = null;

// --- Get current Next.js buildId dynamically ---
async function getBuildId() {
  if (buildIdCache) return buildIdCache;

  const resp = await axios.get(BASE_URL);
  const match = resp.data.match(/"buildId":"(.*?)"/);

  if (!match) throw new Error('Failed to extract buildId from EMX site');

  buildIdCache = match[1];
  console.log('EMX buildId:', buildIdCache);
  return buildIdCache;
}

// --- Fetch events directly from JSON API ---
async function getTrackingEvents(awb) {
  const buildId = await getBuildId();
  const ts = Date.now();

  const url =
    `${BASE_URL}/_next/data/${buildId}/en/all-services/track-a-package/step-two.json` +
    `?q=${encodeURIComponent(awb)}&timestamp=${ts}` +
    `&slug=all-services&slug=track-a-package&slug=step-two`;

  const { data } = await axios.get(url, { timeout: 15000 });

  return (
    data?.pageProps?.pageContext?.extraData?.result?.[0]?.events || []
  );
}

// ===== ROUTES =====

app.get('/test', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/track/:awb', async (req, res) => {
  try {
    const events = await getTrackingEvents(req.params.awb);

    return res.json({
      success: true,
      awb: req.params.awb,
      events,
      totalEvents: events.length,
    });

  } catch (err) {
    console.error('Tracking fetch error:', err.message || err);

    // If failed, reset buildId once (EMX deployment edge case)
    buildIdCache = null;

    return res.status(500).json({
      success: false,
      error: 'Failed to fetch tracking details',
    });
  }
});

// ===== START =====
app.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
});
