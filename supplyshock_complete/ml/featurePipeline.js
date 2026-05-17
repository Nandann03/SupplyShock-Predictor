/**
 * featurePipeline.js
 * Transforms raw shipment/context objects → numeric feature vectors.
 *
 * Keeps encoders/scalers consistent between training and inference.
 */

'use strict';

const { LabelEncoder, MinMaxScaler } = require('./mlPrimitives');

// ─── Categorical column definitions ──────────────────────────────────────────
const CATEGORICAL_COLS = [
  'origin_country',
  'destination_country',
  'port_of_origin',
  'port_of_destination',
  'route',
  'shipment_type',
  'supplier_country',
];

const NUMERIC_COLS = [
  'volume',
  'avg_delay_days_history',
  'weather_risk_score',
  'geopolitical_risk_score',
  'port_congestion_score',
  'port_throughput',
  'stock_cover_days',
  'demand_volatility',
  'supplier_risk_score',
];

// HIGH_RISK_ROUTES get a bonus indicator feature
const HIGH_RISK_ROUTES = new Set(['Red Sea', 'Gulf of Aden', 'Suez Canal', 'Strait of Malacca']);

class FeaturePipeline {
  constructor() {
    this.encoders   = {};   // { col: LabelEncoder }
    this.scaler     = new MinMaxScaler();
    this.fitted     = false;
    this.featureNames = [];
  }

  /**
   * Build feature matrix from an array of sample objects.
   * Returns { X, featureNames } — raw (unscaled) matrix.
   */
  _buildMatrix(samples) {
    return samples.map(s => {
      const row = [];

      // Encoded categoricals
      for (const col of CATEGORICAL_COLS) {
        row.push(this.encoders[col] ? (this.encoders[col].map[s[col]] ?? -1) : -1);
      }

      // Numeric cols
      for (const col of NUMERIC_COLS) {
        row.push(s[col] !== undefined ? +s[col] : 0);
      }

      // Derived indicator: high-risk route
      row.push(HIGH_RISK_ROUTES.has(s.route) ? 1 : 0);

      // Derived: route length proxy (waypoints count, capped 0-20)
      row.push(Math.min(s.route_waypoints_count || 8, 20) / 20);

      // Derived: inbound risk composite
      const inbound = (
        (s.weather_risk_score || 0) * 0.3 +
        (s.geopolitical_risk_score || 0) * 0.35 +
        (s.port_congestion_score || 0) * 0.25 +
        (s.supplier_risk_score || 0) * 0.1
      ) / 100;
      row.push(inbound);

      return row;
    });
  }

  _buildFeatureNames() {
    const names = [
      ...CATEGORICAL_COLS.map(c => `enc_${c}`),
      ...NUMERIC_COLS,
      'is_high_risk_route',
      'route_length_norm',
      'inbound_risk_composite',
    ];
    return names;
  }

  /**
   * Fit encoders + scaler on training data, return scaled X.
   */
  fitTransform(samples) {
    // Fit label encoders
    for (const col of CATEGORICAL_COLS) {
      this.encoders[col] = new LabelEncoder();
      this.encoders[col].fit(samples.map(s => s[col] || '__unknown__'));
    }

    const rawMatrix = this._buildMatrix(samples);
    const scaled    = this.scaler.fitTransform(rawMatrix);
    this.fitted     = true;
    this.featureNames = this._buildFeatureNames();
    return scaled;
  }

  /**
   * Transform new samples using fitted encoders + scaler.
   */
  transform(samples) {
    if (!this.fitted) throw new Error('FeaturePipeline not fitted yet. Call fitTransform first.');
    const rawMatrix = this._buildMatrix(samples);
    return this.scaler.transform(rawMatrix);
  }

  /**
   * Transform a single sample object to a feature vector.
   */
  transformOne(sample) {
    return this.transform([sample])[0];
  }

  /**
   * Normalize a raw shipment from coordinatorAgent format
   * into the canonical feature object expected by the pipeline.
   */
  static fromShipment(ship, context = {}) {
    const weatherRisk     = ship.weatherData?.riskLevel === 'High' ? 75
                          : ship.weatherData?.riskLevel === 'Medium' ? 45 : 15;
    const geoRisk         = ship.geoData?.riskScore || ship.geoData?.severity === 'High' ? 80
                          : ship.geoData?.severity === 'Medium' ? 50 : 15;
    const portCongestion  = ship.portData?.riskScore || ship.portData?.congestionLevel === 'High' ? 80
                          : ship.portData?.congestionLevel === 'Medium' ? 50 : 20;
    const portThroughput  = ship.portData?.throughput || 5000;
    const supplierRisk    = context.supplierRiskScore || 20;
    const stockCoverDays  = context.stockCoverDays   || 20;
    const demandVolatility = context.demandVolatility || 0.2;

    return {
      origin_country:          ship.origin || 'Unknown',
      destination_country:     ship.destination || 'Unknown',
      port_of_origin:          ship.portOfOrigin || ship.origin || 'Unknown',
      port_of_destination:     ship.portData?.name || ship.destination || 'Unknown',
      route:                   ship.route || 'Unknown',
      volume:                  ship.consignment?.totalWeightMT || 200,
      shipment_type:           (ship.cargo || ['Finished Goods'])[0],
      supplier_id:             ship.supplierId || 'SUP-001',
      supplier_country:        ship.supplierCountry || ship.origin || 'Unknown',
      avg_delay_days_history:  ship.delayDays || 0,
      weather_risk_score:      weatherRisk,
      geopolitical_risk_score: geoRisk,
      port_congestion_score:   portCongestion,
      port_throughput:         portThroughput,
      stock_cover_days:        stockCoverDays,
      demand_volatility:       demandVolatility,
      supplier_risk_score:     supplierRisk,
      route_waypoints_count:   (ship.routeWaypoints || []).length,
    };
  }
}

module.exports = { FeaturePipeline, CATEGORICAL_COLS, NUMERIC_COLS };
