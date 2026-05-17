/**
 * server.js — SupplyShock Predictor with Country Auth + ML Intelligence Suite
 */
require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');

const { login, logout, authMiddleware, COUNTRY_CREDENTIALS } = require('./auth');
const shipRoutes    = require('./routes/shipRoutes');
const weatherRoutes = require('./routes/weatherRoutes');
const geoRoutes     = require('./routes/geoRoutes');
const portRoutes    = require('./routes/portRoutes');
const mlRoutes      = require('../ml/mlRoutes');
const { runPipeline } = require('../ml/coordinatorAgentML');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// ─── Country login banner ──────────────────────────────────────────────────────
const COUNTRY_BANNERS = {
  India: `
============================================================
  [IN] INDIA PORTAL ACTIVATED
  Monitoring : Arabian Sea, Bay of Bengal, Persian Gulf
  Entry Ports: Nhava Sheva, Chennai, Kochi, Kolkata, Mundra
  Risk Zones : Hormuz (HIGH), Gulf of Aden (HIGH), BoB Piracy
  API Keys   : MarineTraffic [IN], OpenWeatherMap, PortWatch [IN]
============================================================`,

  Iran: `
============================================================
  [IR] IRAN PORTAL ACTIVATED
  Monitoring : Persian Gulf, Gulf of Oman, Arabian Sea
  Entry Ports: Bandar Abbas, Imam Khomeini Port, Chabahar
  Risk Zones : Hormuz IRGC (HIGH), US Navy Gulf (HIGH), Red Sea Houthi (HIGH)
  API Keys   : MarineTraffic [IR], OpenWeatherMap, PortWatch [IR]
============================================================`,

  USA: `
============================================================
  [US] USA PORTAL ACTIVATED
  Monitoring : North Atlantic, Trans-Pacific, Gulf of Mexico
  Entry Ports: Los Angeles, Houston, New York, Baltimore, Savannah
  Risk Zones : Panama Canal drought (MEDIUM), China tariff reroutes (HIGH)
  API Keys   : MarineTraffic [US], OpenWeatherMap, PortWatch [US]
============================================================`,

  Russia: `
============================================================
  [RU] RUSSIA PORTAL ACTIVATED
  Monitoring : Black Sea, Bosphorus, Baltic, Arctic, Pacific
  Entry Ports: St. Petersburg, Novorossiysk, Vladivostok, Murmansk
  Risk Zones : Black Sea war (HIGH), Bosphorus block (HIGH), Red Sea (HIGH)
  API Keys   : MarineTraffic [RU], OpenWeatherMap, PortWatch [RU]
============================================================`,
};

// ─── Auth endpoints ────────────────────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  const { userId, password } = req.body;
  if (!userId || !password)
    return res.status(400).json({ success: false, error: 'userId and password required' });

  const result = login(userId, password);
  if (!result.success) {
    console.log(`\n  [AUTH]  Failed login attempt — userId: ${userId}`);
    return res.status(401).json(result);
  }

  const banner = COUNTRY_BANNERS[result.country] || '';
  console.log(banner);
  console.log(`  Session token  : ${result.token.slice(0, 24)}...`);
  console.log(`  Login time     : ${new Date().toISOString()}`);
  console.log(`  Running preprocessing for ${result.country}...\n`);

  try {
    const shipAgent = require('../agents/shipAgent');
    const { runPreprocessing } = require('../utils/preprocessLogger');
    const rawShips = await shipAgent.run(result.country);
    await runPreprocessing(result.country, rawShips);
    console.log(`\n  [LOGIN]  Preprocessing complete for ${result.country} — ready for analysis.\n`);
  } catch (err) {
    console.error(`\n  [LOGIN]  Preprocessing failed: ${err.message}\n`);
  }

  res.json(result);
});

app.post('/api/auth/logout', authMiddleware, (req, res) => {
  const token = req.headers['x-auth-token'];
  const country = req.session.country;
  logout(token);
  console.log(`\n  [AUTH]  ${country} operator logged out — ${new Date().toISOString()}\n`);
  res.json({ success: true });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  const c = COUNTRY_CREDENTIALS[req.session.country];
  res.json({ success: true, country: req.session.country, flag: c.flag, color: c.color, accentColor: c.accentColor });
});

// ─── Protected API routes ──────────────────────────────────────────────────────
app.use('/api/ships',   authMiddleware, shipRoutes);
app.use('/api/weather', authMiddleware, weatherRoutes);
app.use('/api/geo',     authMiddleware, geoRoutes);
app.use('/api/ports',   authMiddleware, portRoutes);
app.use('/api/ml',      authMiddleware, mlRoutes);

app.post('/api/analyze', authMiddleware, async (req, res) => {
  try {
    const country = req.session.country;
    console.log(`\n  [ANALYZE]  Request received for country: ${country}`);
    console.log(`  [ANALYZE]  ${new Date().toISOString()}`);
    console.log(`  [ANALYZE]  Starting preprocessing + ML pipeline...\n`);
    const result = await runPipeline(country);
    res.json({ success: true, country, ...result });
  } catch (err) {
    console.error('\n  [ERROR]  Pipeline failed:', err.message);
    console.error(err.stack);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date() }));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// ─── Startup banner ────────────────────────────────────────────────────────────
const startServer = (port) => {
  const server = app.listen(port, () => {
    console.log('');
    console.log('============================================================');
    console.log('  SUPPLYSHOCK PREDICTOR  v5.0  [ML-AUGMENTED]');
    console.log('  Multi-Agent Maritime Import Intelligence Platform');
    console.log('============================================================');
    console.log(`  Server     : http://localhost:${port}`);
    console.log(`  Health     : http://localhost:${port}/api/health`);
    console.log(`  ML Status  : http://localhost:${port}/api/ml/status`);
    console.log(`  Mode       : ${process.env.DATA_MODE === 'live' ? 'LIVE API' : 'MOCK DATA'}`);
    console.log('');
    console.log('  COUNTRY CREDENTIALS:');
    Object.entries(COUNTRY_CREDENTIALS).forEach(([c, v]) => {
      console.log(`  ${v.flag}  ${c.padEnd(8)}  ${v.userId}  /  ${v.password}`);
    });
    console.log('');
    console.log('  Warming up ML models in background...');
    console.log('============================================================');
    console.log('');

    // Warm up ML engine at startup so first /api/analyze is instant
    (async () => {
      try {
        const mlAgent = require('../ml/mlPredictionAgent');
        await mlAgent.init();
        console.log('  [ML]  All 4 models trained and ready.\n');
      } catch (err) {
        console.warn('  [ML]  Warm-up failed (non-fatal):', err.message, '\n');
      }
    })();
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      const altPort = port + 1;
      console.warn(`Port ${port} is already in use. Attempting to start on ${altPort} instead.`);
      startServer(altPort);
      return;
    }

    console.error('Server error:', err);
    process.exit(1);
  });
};

startServer(PORT);

module.exports = app;
