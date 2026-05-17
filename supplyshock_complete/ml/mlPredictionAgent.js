/**
 * mlPredictionAgent.js
 * ─────────────────────────────────────────────────────────────────────────────
 * ML-powered Agent 4 (Prediction Agent) — wraps mlRegistry.batchPredict()
 * and slots cleanly into the coordinatorAgent pipeline after inventoryAgent.
 *
 * Pipeline position:
 *   shipAgent → weatherAgent → geopoliticsAgent → portCongestionAgent
 *   → inventoryAgent → [mlPredictionAgent] → predictRisk → generateDecisions
 *
 * Integration: in coordinatorAgent.js replace the predictRisk call with:
 *   const step6 = await mlPredictionAgent.run(step5);
 *   const step7 = predictRisk(step6);  // now blends ML scores automatically
 */

'use strict';

const mlRegistry = require('./mlRegistry');

class MLPredictionAgent {
  constructor() {
    this.name    = 'MLPredictionAgent';
    this.version = '2.0.0';
    this._ready  = false;
  }

  async init() {
    if (this._ready) return;
    await mlRegistry.init();
    this._ready = true;
    console.log(`  [${this.name}]  ML models loaded — ready for inference`);
  }

  /**
   * Main pipeline runner.
   * Attaches mlPrediction + mlImpact to every ship object.
   * @param {Array} ships - output from inventoryAgent.run()
   * @returns {Array} ships with mlPrediction, mlImpact, mlScenarios added
   */
  async run(ships) {
    if (!this._ready) await this.init();

    console.log(`\n  [${this.name}]  Running ML inference on ${ships.length} shipments...`);

    const enriched = mlRegistry.batchPredict(ships);

    // Optionally attach top scenario for each high-risk ship
    const withScenarios = enriched.map(ship => {
      if (ship.mlPrediction?.ml_risk_label === 'High') {
        try {
          const scenarios = mlRegistry.simulateAllScenarios(ship, {
            stockCoverDays:    ship.cargoRisks?.[0]?.stockCoverDays || 20,
            demandVolatility:  0.2,
            ruleBasedScore:    ship.riskScore,
          });
          // Find worst scenario
          const worstScenario = scenarios
            .filter(s => s.delta.ml_risk_score > 0)
            .sort((a, b) => b.delta.ml_risk_score - a.delta.ml_risk_score)[0] || null;
          return { ...ship, mlWorstScenario: worstScenario };
        } catch { /* non-fatal */ }
      }
      return ship;
    });

    // Summary stats
    const withML = withScenarios.filter(s => s.mlPrediction);
    const avgDelay = withML.length
      ? (withML.reduce((s, ship) => s + (ship.mlPrediction.delay_probability || 0), 0) / withML.length).toFixed(3)
      : 'N/A';

    console.log(`  [${this.name}]  Inference complete — avg delay probability: ${avgDelay}`);
    const highRisk = withML.filter(s => s.mlPrediction?.ml_risk_label === 'High').length;
    const highShortage = withML.filter(s => s.mlPrediction?.shortage_risk === 'High').length;
    console.log(`  [${this.name}]  ML High-risk shipments: ${highRisk} | High shortage risk: ${highShortage}`);

    return withScenarios;
  }

  /**
   * Standalone predict for a single shipment (used by /api/ml/predict endpoint).
   */
  async predictOne(ship, context = {}) {
    if (!this._ready) await this.init();
    return mlRegistry.predict(ship, context);
  }

  /**
   * Scenario simulation (used by /api/ml/scenario endpoint).
   */
  async simulate(ship, shock, context = {}) {
    if (!this._ready) await this.init();
    return mlRegistry.simulateScenario(ship, shock, context);
  }

  /**
   * Alternate route recommendations.
   */
  async recommendRoutes(ship, context = {}) {
    if (!this._ready) await this.init();
    return mlRegistry.recommendAlternateRoutes(ship, context);
  }

  /**
   * Supplier ranking.
   */
  async rankSuppliers(suppliers, baseShip, context = {}) {
    if (!this._ready) await this.init();
    return mlRegistry.rankSuppliers(suppliers, baseShip, context);
  }

  /**
   * Business impact estimation.
   */
  async estimateImpact(mlOutput, financials = {}) {
    return mlRegistry.estimateBusinessImpact(mlOutput, financials);
  }

  get metrics() { return mlRegistry.trainMetrics; }
  get shockPresets() { return Object.keys(mlRegistry.shockPresets); }
}

module.exports = new MLPredictionAgent();
