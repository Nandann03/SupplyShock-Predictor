/**
 * mlRoutes.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Express router for ML endpoints. Mount in server.js:
 *
 *   const mlRoutes = require('./routes/mlRoutes');
 *   app.use('/api/ml', authMiddleware, mlRoutes);
 *
 * Endpoints:
 *   GET  /api/ml/status          — model health + training metrics
 *   POST /api/ml/predict         — full ML prediction for one shipment
 *   POST /api/ml/scenario        — what-if shock simulation
 *   POST /api/ml/scenarios/all   — run all preset shocks
 *   POST /api/ml/routes/recommend — alternate route scoring
 *   POST /api/ml/suppliers/rank  — supplier ranking
 *   POST /api/ml/impact          — business impact estimate
 */

'use strict';

const express  = require('express');
const router   = express.Router();
const mlAgent  = require('../ml/mlPredictionAgent');
const mlReg    = require('../ml/mlRegistry');

// Ensure ML is initialized before any request
let initPromise = null;
function ensureInit() {
  if (!initPromise) initPromise = mlAgent.init();
  return initPromise;
}

// ─── GET /api/ml/status ───────────────────────────────────────────────────────
router.get('/status', async (req, res) => {
  try {
    await ensureInit();
    res.json({
      success:       true,
      status:        'ready',
      model_version: '2.0.0',
      metrics:       mlAgent.metrics,
      shock_presets: mlAgent.shockPresets,
      timestamp:     new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /api/ml/predict ─────────────────────────────────────────────────────
// Body: { ship: <shipObject>, context: { stockCoverDays?, demandVolatility?, supplierRiskScore?, ruleBasedScore? } }
router.post('/predict', async (req, res) => {
  try {
    await ensureInit();
    const { ship, context = {} } = req.body;
    if (!ship) return res.status(400).json({ success: false, error: 'ship object required' });

    const prediction = await mlAgent.predictOne(ship, context);
    const impact     = mlReg.estimateBusinessImpact(prediction, {
      cargoValue:   ship.consignment?.totalValueUSD || 5_000_000,
      dailyRevenue: context.dailyRevenue || 50_000,
    });

    res.json({ success: true, shipment_id: ship.shipId || ship.name, prediction, impact });
  } catch (err) {
    console.error('[/api/ml/predict]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /api/ml/scenario ────────────────────────────────────────────────────
// Body: { ship, shock: 'severe_weather' | {...}, context? }
router.post('/scenario', async (req, res) => {
  try {
    await ensureInit();
    const { ship, shock, context = {} } = req.body;
    if (!ship || !shock) return res.status(400).json({ success: false, error: 'ship and shock required' });

    const result = await mlAgent.simulate(ship, shock, context);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /api/ml/scenarios/all ───────────────────────────────────────────────
router.post('/scenarios/all', async (req, res) => {
  try {
    await ensureInit();
    const { ship, context = {} } = req.body;
    if (!ship) return res.status(400).json({ success: false, error: 'ship required' });

    const scenarios = mlReg.simulateAllScenarios(ship, context);
    // Sort by worst delta
    scenarios.sort((a, b) => b.delta.ml_risk_score - a.delta.ml_risk_score);
    res.json({ success: true, shipment_id: ship.shipId || ship.name, scenarios });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /api/ml/routes/recommend ───────────────────────────────────────────
// Body: { ship, context? }
router.post('/routes/recommend', async (req, res) => {
  try {
    await ensureInit();
    const { ship, context = {} } = req.body;
    if (!ship) return res.status(400).json({ success: false, error: 'ship required' });

    const result = await mlAgent.recommendRoutes(ship, context);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /api/ml/suppliers/rank ──────────────────────────────────────────────
// Body: { suppliers: [{supplierId, supplierCountry, supplierRiskScore}], ship, context? }
router.post('/suppliers/rank', async (req, res) => {
  try {
    await ensureInit();
    const { suppliers, ship, context = {} } = req.body;
    if (!suppliers || !ship) return res.status(400).json({ success: false, error: 'suppliers and ship required' });

    const ranked = await mlAgent.rankSuppliers(suppliers, ship, context);
    res.json({ success: true, ranked_suppliers: ranked });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /api/ml/impact ──────────────────────────────────────────────────────
// Body: { mlOutput, financials?: { cargoValue, dailyRevenue, penaltyCostPerDay } }
router.post('/impact', async (req, res) => {
  try {
    await ensureInit();
    const { mlOutput, financials = {} } = req.body;
    if (!mlOutput) return res.status(400).json({ success: false, error: 'mlOutput required' });

    const impact = mlReg.estimateBusinessImpact(mlOutput, financials);
    res.json({ success: true, impact });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
