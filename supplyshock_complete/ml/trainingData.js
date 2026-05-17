/**
 * trainingData.js
 * Synthetic training data generator for SupplyShock ML models.
 * Generates N samples with realistic correlations between features and labels.
 */

'use strict';

const ORIGIN_COUNTRIES     = ['China', 'India', 'Germany', 'USA', 'Japan', 'South Korea', 'Brazil', 'UAE', 'Turkey', 'Malaysia'];
const DEST_COUNTRIES       = ['India', 'USA', 'Germany', 'UK', 'France', 'Japan', 'Australia', 'Canada', 'Netherlands', 'Singapore'];
const PORTS_OF_ORIGIN      = ['Shanghai', 'Shenzhen', 'Mumbai', 'Hamburg', 'Los Angeles', 'Yokohama', 'Busan', 'Dubai', 'Port Klang', 'Santos'];
const PORTS_OF_DEST        = ['Rotterdam', 'Nhava Sheva', 'New York', 'Felixstowe', 'Le Havre', 'Tokyo', 'Melbourne', 'Vancouver', 'Antwerp', 'Singapore'];
const ROUTE_TAGS           = ['Suez Canal', 'Cape of Good Hope', 'Trans-Pacific', 'Trans-Atlantic', 'Strait of Malacca', 'Panama Canal', 'Arctic Route', 'Red Sea', 'Gulf of Aden', 'Mediterranean'];
const SHIPMENT_TYPES       = ['Raw Material', 'Finished Goods', 'Semi-finished', 'Perishable', 'Hazardous', 'Consumer Goods'];
const SUPPLIER_IDS         = Array.from({ length: 30 }, (_, i) => `SUP-${String(i + 1).padStart(3, '0')}`);
const HIGH_RISK_COUNTRIES  = ['Yemen', 'Ukraine', 'Russia', 'Myanmar', 'Sudan', 'Iran', 'Syria', 'Libya'];

// Seeded PRNG for reproducibility
function seededRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s ^ (s << 13)) >>> 0;
    s = (s ^ (s >> 7))  >>> 0;
    s = (s ^ (s << 17)) >>> 0;
    return (s >>> 0) / 4294967296;
  };
}

function pick(arr, rng) { return arr[Math.floor(rng() * arr.length)]; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function gaussianNoise(rng, mean = 0, std = 1) {
  // Box-Muller
  const u1 = Math.max(rng(), 1e-10);
  const u2 = rng();
  return mean + std * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * Generate a single synthetic shipment sample with realistic feature correlations.
 * Labels are derived from features + noise so that a model can genuinely learn signal.
 */
function generateSample(idx, rng) {
  const originCountry      = pick(ORIGIN_COUNTRIES, rng);
  const destCountry        = pick(DEST_COUNTRIES, rng);
  const portOfOrigin       = pick(PORTS_OF_ORIGIN, rng);
  const portOfDest         = pick(PORTS_OF_DEST, rng);
  const route              = pick(ROUTE_TAGS, rng);
  const shipmentType       = pick(SHIPMENT_TYPES, rng);
  const supplierId         = pick(SUPPLIER_IDS, rng);
  const supplierCountry    = pick([...ORIGIN_COUNTRIES, ...HIGH_RISK_COUNTRIES.slice(0, 3)], rng);

  // Core risk drivers (0-100)
  const weatherRisk        = clamp(gaussianNoise(rng, 40, 20), 0, 100);
  const geoRisk            = clamp(gaussianNoise(rng, 35, 25), 0, 100);
  const portCongestion     = clamp(gaussianNoise(rng, 45, 22), 0, 100);
  const portThroughput     = clamp(gaussianNoise(rng, 5000, 2000), 500, 15000); // TEUs/day

  // Volume in TEUs
  const volume             = clamp(Math.round(gaussianNoise(rng, 200, 100)), 10, 800);

  // Historical delay days — skewed positive
  const avgDelayHistory    = clamp(Math.abs(gaussianNoise(rng, 3, 3)), 0, 20);

  // Supplier reliability 0-1
  const supplierCountryRisk = HIGH_RISK_COUNTRIES.includes(supplierCountry) ? 0.25 : 0;
  const supplierReliability = clamp(gaussianNoise(rng, 0.82 - supplierCountryRisk, 0.12), 0.3, 1);
  const supplierRiskScore   = clamp((1 - supplierReliability) * 100, 0, 100);

  // Inventory features
  const stockCoverDays      = clamp(Math.round(gaussianNoise(rng, 20, 12)), 2, 90);
  const demandVolatility    = clamp(gaussianNoise(rng, 0.25, 0.15), 0, 1); // coefficient of variation

  // ── Derive labels from features + noise ────────────────────────────────────

  // Delay probability: logistic function of weighted risk drivers
  // Intercept tuned so ~45% of samples are delayed (realistic distribution)
  const delayLogit = -3.8
    + 0.030 * weatherRisk
    + 0.025 * geoRisk
    + 0.020 * portCongestion
    + 0.15  * avgDelayHistory
    + 0.012 * supplierRiskScore
    + (route === 'Red Sea' || route === 'Gulf of Aden' ? 1.2 : 0)
    + gaussianNoise(rng, 0, 0.5);

  const delayProbability = 1 / (1 + Math.exp(-delayLogit));
  const delayed          = delayProbability >= 0.5 ? 1 : 0;

  // Predicted delay days (regression): only meaningful if delayed
  const predictedDelayDays = delayed
    ? clamp(Math.round(Math.abs(gaussianNoise(rng, avgDelayHistory + (geoRisk / 20), 3))), 1, 25)
    : 0;

  // Shortage risk: depends on stock cover, inbound risk, demand volatility
  const inboundRisk          = delayProbability * 0.5 + (portCongestion / 100) * 0.3 + supplierRiskScore / 100 * 0.2;
  const projectedCoverAfterDelay = stockCoverDays - predictedDelayDays * (1 + demandVolatility);

  let shortageRiskLabel;
  if (projectedCoverAfterDelay <= 5 || inboundRisk > 0.75)        shortageRiskLabel = 'High';
  else if (projectedCoverAfterDelay <= 14 || inboundRisk > 0.45)  shortageRiskLabel = 'Medium';
  else                                                              shortageRiskLabel = 'Low';

  const shortageRiskNum  = shortageRiskLabel === 'High' ? 2 : shortageRiskLabel === 'Medium' ? 1 : 0;
  const predictedStockCoverDays = clamp(Math.round(projectedCoverAfterDelay + gaussianNoise(rng, 0, 2)), 0, 90);

  // Route risk score (0-100 regression target)
  const routeRiskScore = clamp(Math.round(
    weatherRisk * 0.30 +
    geoRisk     * 0.35 +
    portCongestion * 0.25 +
    (route === 'Red Sea' || route === 'Gulf of Aden' ? 15 : 0) +
    (route === 'Suez Canal' ? 8 : 0) +
    gaussianNoise(rng, 0, 5)
  ), 0, 100);

  // Supplier reliability label (binary)
  const supplierReliabilityLabel = supplierReliability >= 0.75 ? 1 : 0;

  return {
    shipment_id:               `SYN-${String(idx).padStart(5, '0')}`,
    origin_country:            originCountry,
    destination_country:       destCountry,
    port_of_origin:            portOfOrigin,
    port_of_destination:       portOfDest,
    route,
    volume,
    shipment_type:             shipmentType,
    supplier_id:               supplierId,
    supplier_country:          supplierCountry,

    // Features
    avg_delay_days_history:    +avgDelayHistory.toFixed(2),
    weather_risk_score:        +weatherRisk.toFixed(1),
    geopolitical_risk_score:   +geoRisk.toFixed(1),
    port_congestion_score:     +portCongestion.toFixed(1),
    port_throughput:           Math.round(portThroughput),
    stock_cover_days:          stockCoverDays,
    demand_volatility:         +demandVolatility.toFixed(3),
    supplier_risk_score:       +supplierRiskScore.toFixed(1),
    supplier_reliability:      +supplierReliability.toFixed(3),

    // Labels
    delayed,
    delay_probability:         +delayProbability.toFixed(4),
    predicted_delay_days:      predictedDelayDays,
    shortage_risk_label:       shortageRiskLabel,
    shortage_risk_num:         shortageRiskNum,
    predicted_stock_cover_days: predictedStockCoverDays,
    route_risk_score:          routeRiskScore,
    supplier_reliability_label: supplierReliabilityLabel,
  };
}

/**
 * Generate N synthetic training samples.
 * @param {number} n - number of samples (default 2000)
 * @param {number} seed - PRNG seed for reproducibility
 */
function generateTrainingData(n = 2000, seed = 42) {
  const rng = seededRng(seed);
  return Array.from({ length: n }, (_, i) => generateSample(i, rng));
}

module.exports = { generateTrainingData, seededRng, pick, clamp, gaussianNoise };
