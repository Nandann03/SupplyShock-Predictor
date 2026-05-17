/* ═══════════════════════════════════════════════════════════════════════════
   ML INTELLIGENCE SUITE — frontend JS
   Paste at end of script.js (or include as ml.js before </body>)
   ════════════════════════════════════════════════════════════════════════ */

// ─── ML State ────────────────────────────────────────────────────────────────
let _mlShipments = [];   // enriched shipments with mlPrediction
let _mlMetrics   = {};
let _shockPresets = [];

// ─── Called after runAnalysis() resolves — wire into the existing callback ───
/**
 * Call this from your existing renderDashboard() / displayResults() function:
 *   renderMLPanel(data.shipments, data.mlMetrics, data.shockPresets);
 */
function renderMLPanel(shipments, mlMetrics, shockPresets) {
  _mlShipments = shipments || [];
  _mlMetrics   = mlMetrics || {};
  _shockPresets = shockPresets || [];

  const mlShips = _mlShipments.filter(s => s.mlPrediction);
  if (mlShips.length === 0) return;

  // Show sections
  document.getElementById('mlStatusBar')?.style && (document.getElementById('mlStatusBar').style.display = '');
  document.getElementById('mlSection')?.style    && (document.getElementById('mlSection').style.display = '');
  document.getElementById('scenarioSection')?.style && (document.getElementById('scenarioSection').style.display = '');

  _renderMLStatusBar(mlShips);
  _renderMLKpiRow(mlShips);
  _renderMLCards(mlShips);
  _populateScenarioShipSelect(mlShips);
}

// ─── Status bar ──────────────────────────────────────────────────────────────
function _renderMLStatusBar(ships) {
  const badge = document.getElementById('mlStatusBadge');
  const strip = document.getElementById('mlMetricsStrip');
  if (!badge || !strip) return;

  document.getElementById('mlStatusText').textContent = `ML Engine · ${ships.length} shipments scored`;

  const m = _mlMetrics;
  const chips = [
    { label: 'DELAY ACC', val: m.delay?.accuracy ? (m.delay.accuracy * 100).toFixed(1) + '%' : '—', cls: _accClass(m.delay?.accuracy) },
    { label: 'DELAY MAE', val: m.delay?.delay_days_mae != null ? m.delay.delay_days_mae + 'd' : '—', cls: 'mmc-val' },
    { label: 'SHORTAGE ACC', val: m.shortage?.accuracy ? (m.shortage.accuracy * 100).toFixed(1) + '%' : '—', cls: _accClass(m.shortage?.accuracy) },
    { label: 'ROUTE R²', val: m.route?.r2 != null ? m.route.r2 : '—', cls: _r2Class(m.route?.r2) },
    { label: 'SUPPLIER ACC', val: m.supplier?.accuracy ? (m.supplier.accuracy * 100).toFixed(1) + '%' : '—', cls: _accClass(m.supplier?.accuracy) },
  ];

  strip.innerHTML = chips.map(c =>
    `<div class="ml-metric-chip">
      <span class="mmc-label">${c.label}</span>
      <span class="${c.cls}">${c.val}</span>
    </div>`
  ).join('');
}

function _accClass(v) { if (!v) return 'mmc-val'; return v >= 0.80 ? 'mmc-good' : v >= 0.65 ? 'mmc-warn' : 'mmc-bad'; }
function _r2Class(v)  { if (!v) return 'mmc-val'; return v >= 0.70 ? 'mmc-good' : v >= 0.50 ? 'mmc-warn' : 'mmc-bad'; }

// ─── KPI row ─────────────────────────────────────────────────────────────────
function _renderMLKpiRow(ships) {
  const row = document.getElementById('mlKpiRow');
  if (!row) return;

  const n = ships.length || 1;
  const avgDelay     = (ships.reduce((s, sh) => s + (sh.mlPrediction.delay_probability || 0), 0) / n * 100).toFixed(1);
  const highShortage = ships.filter(s => s.mlPrediction.shortage_risk === 'High').length;
  const avgRoute     = Math.round(ships.reduce((s, sh) => s + (sh.mlPrediction.route_risk_score || 0), 0) / n);
  const avgReliability = Math.round(ships.reduce((s, sh) => s + (sh.mlPrediction.reliability_score || 0), 0) / n);
  const totalImpact  = ships.reduce((s, sh) => s + (sh.mlImpact?.total_estimated_impact || 0), 0);

  row.innerHTML = `
    <div class="ml-kpi-card kpi-delay">
      <div class="ml-kpi-label">Avg Delay Prob</div>
      <div class="ml-kpi-val">${avgDelay}%</div>
      <div class="ml-kpi-sub">across ${n} shipments</div>
    </div>
    <div class="ml-kpi-card kpi-shortage">
      <div class="ml-kpi-label">High Shortage Risk</div>
      <div class="ml-kpi-val">${highShortage}</div>
      <div class="ml-kpi-sub">shipments flagged</div>
    </div>
    <div class="ml-kpi-card kpi-route">
      <div class="ml-kpi-label">Avg Route Risk</div>
      <div class="ml-kpi-val">${avgRoute}</div>
      <div class="ml-kpi-sub">out of 100</div>
    </div>
    <div class="ml-kpi-card kpi-supplier">
      <div class="ml-kpi-label">Avg Supplier Reliability</div>
      <div class="ml-kpi-val">${avgReliability}</div>
      <div class="ml-kpi-sub">out of 100</div>
    </div>
    <div class="ml-kpi-card kpi-impact">
      <div class="ml-kpi-label">Total ML Impact Est.</div>
      <div class="ml-kpi-val">$${_fmt(totalImpact)}</div>
      <div class="ml-kpi-sub">estimated exposure</div>
    </div>`;
}

function _fmt(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K';
  return String(n);
}

// ─── Per-shipment ML cards ────────────────────────────────────────────────────
function _renderMLCards(ships) {
  const grid = document.getElementById('mlCardsGrid');
  if (!grid) return;

  grid.innerHTML = ships.map(ship => {
    const ml = ship.mlPrediction;
    const imp = ship.mlImpact;
    const sc = ship.mlWorstScenario;

    const delayPct     = Math.round(ml.delay_probability * 100);
    const shortageNum  = { Low: 15, Medium: 50, High: 90 }[ml.shortage_risk] || 15;
    const supplierPct  = ml.reliability_score || 50;
    const routeScore   = ml.route_risk_score || 0;

    const shortageTag = _tagClass(ml.shortage_risk);
    const supplierTag = _tagClass(ml.supplier_risk_tier);
    const routeTag    = _tagClass(ml.route_risk_label);

    const impactHtml = imp ? `
      <div class="ml-impact-row">
        <div>
          <div class="ml-impact-label">Est. Financial Impact</div>
          <div class="ml-impact-val">$${_fmt(imp.total_estimated_impact)}</div>
        </div>
        <span class="ml-impact-sev">${imp.impact_severity}</span>
      </div>` : '';

    const scenarioHtml = sc ? `
      <div class="ml-scenario-pill">
        ⚡ Worst scenario: <strong>${sc.shockLabel}</strong> → +${sc.delta.ml_risk_score} risk score
      </div>` : '';

    return `
      <div class="ml-card">
        <div class="ml-card-header">
          <div>
            <div class="ml-card-ship">${ship.name || ship.shipId}</div>
            <div class="ml-card-route">${ship.route || '—'} · ${ship.origin || ''} → ${ship.destination || ''}</div>
          </div>
          <span class="ml-risk-badge ${ml.ml_risk_label}">${ml.ml_risk_label}</span>
        </div>
        <div class="ml-card-body">
          <div class="ml-gauge-row">
            <div class="ml-gauge">
              <span class="ml-gauge-name">Delay Prob</span>
              <div class="ml-gauge-bar"><div class="ml-gauge-fill delay" style="width:${delayPct}%"></div></div>
              <span class="ml-gauge-num">${delayPct}%</span>
            </div>
            <div class="ml-gauge">
              <span class="ml-gauge-name">Shortage</span>
              <div class="ml-gauge-bar"><div class="ml-gauge-fill shortage" style="width:${shortageNum}%"></div></div>
              <span class="ml-gauge-num">${ml.shortage_risk}</span>
            </div>
            <div class="ml-gauge">
              <span class="ml-gauge-name">Route Risk</span>
              <div class="ml-gauge-bar"><div class="ml-gauge-fill route" style="width:${routeScore}%"></div></div>
              <span class="ml-gauge-num">${routeScore}/100</span>
            </div>
            <div class="ml-gauge">
              <span class="ml-gauge-name">Supplier</span>
              <div class="ml-gauge-bar"><div class="ml-gauge-fill supplier" style="width:${supplierPct}%"></div></div>
              <span class="ml-gauge-num">${supplierPct}/100</span>
            </div>
          </div>
          <div class="ml-tags">
            <span class="ml-tag">🕒 +${ml.predicted_delay_days}d predicted</span>
            <span class="ml-tag ${shortageTag}">📦 ${ml.shortage_risk} shortage</span>
            <span class="ml-tag ${routeTag}">🗺 ${ml.route_risk_label} route</span>
            <span class="ml-tag ${supplierTag}">🏭 ${ml.supplier_risk_tier} supplier</span>
            <span class="ml-tag">📅 ${ml.predicted_stock_cover_days}d stock cover</span>
          </div>
          ${impactHtml}
          ${scenarioHtml}
        </div>
      </div>`;
  }).join('');
}

function _tagClass(label) {
  if (label === 'High')   return 'tag-high';
  if (label === 'Medium') return 'tag-medium';
  return 'tag-low';
}

// ─── Scenario Simulator ───────────────────────────────────────────────────────
function _populateScenarioShipSelect(ships) {
  const sel = document.getElementById('scenarioShipSelect');
  if (!sel) return;
  sel.innerHTML = ships.map(s =>
    `<option value="${s.shipId || s.name}">${s.name || s.shipId} (${s.route || '—'})</option>`
  ).join('');
}

async function runScenario() {
  const shipSel  = document.getElementById('scenarioShipSelect');
  const shockSel = document.getElementById('scenarioShockSelect');
  const btn      = document.getElementById('btnRunScenario');
  const results  = document.getElementById('scenarioResults');
  if (!shipSel || !shockSel || !results) return;

  const shipId  = shipSel.value;
  const shock   = shockSel.value;
  const ship    = _mlShipments.find(s => (s.shipId || s.name) === shipId);
  if (!ship) return;

  btn.disabled = true;
  btn.textContent = 'Simulating…';
  results.innerHTML = '<div class="scenario-placeholder">Running ML simulation…</div>';

  try {
    const token = localStorage.getItem('ssp_token') || sessionStorage.getItem('ssp_token');
    const res   = await fetch('/api/ml/scenario', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-auth-token': token },
      body: JSON.stringify({
        ship,
        shock,
        context: {
          stockCoverDays:   ship.cargoRisks?.[0]?.stockCoverDays || 20,
          demandVolatility: 0.2,
          ruleBasedScore:   ship.riskScore,
        },
      }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    _renderScenarioResult(data, ship);
  } catch (err) {
    results.innerHTML = `<div class="scenario-placeholder" style="color:#ef4444">Error: ${err.message}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Run Simulation';
  }
}

function _renderScenarioResult(data, ship) {
  const results = document.getElementById('scenarioResults');
  if (!results) return;

  const { baseline, shocked, delta, shockLabel } = data;

  const dRow = (name, base, shock, d, unit = '') => {
    const cls = d > 0 ? 'pos' : d < 0 ? 'neg' : 'zero';
    const sign = d > 0 ? '+' : '';
    return `
      <div class="scenario-metric">
        <span class="scenario-metric-name">${name}</span>
        <span style="display:flex;gap:12px;align-items:center">
          <span class="scenario-metric-val">${base}${unit} → ${shock}${unit}</span>
          <span class="scenario-delta ${cls}">${sign}${d}${unit}</span>
        </span>
      </div>`;
  };

  results.innerHTML = `
    <div class="scenario-shock-label">⚡ Shock Applied: ${shockLabel}</div>
    <div class="scenario-grid">
      <div class="scenario-col">
        <div class="scenario-col-title">Risk Metrics</div>
        ${dRow('ML Risk Score',    baseline.ml_risk_score,  shocked.ml_risk_score,  delta.ml_risk_score)}
        ${dRow('Route Risk',       baseline.route_risk_score, shocked.route_risk_score, delta.route_risk_score)}
        ${dRow('Delay Prob',       (baseline.delay_probability*100).toFixed(1), (shocked.delay_probability*100).toFixed(1),
                                   (delta.delay_probability*100).toFixed(1), '%')}
        ${dRow('Delay Days',       baseline.predicted_delay_days, shocked.predicted_delay_days, delta.predicted_delay_days, 'd')}
      </div>
      <div class="scenario-col">
        <div class="scenario-col-title">Inventory / Supply</div>
        ${dRow('Shortage Risk',    baseline.shortage_risk,   shocked.shortage_risk, '')}
        ${dRow('Stock Cover',      baseline.predicted_stock_cover_days, shocked.predicted_stock_cover_days,
                                   shocked.predicted_stock_cover_days - baseline.predicted_stock_cover_days, 'd')}
        ${dRow('Supplier Tier',    baseline.supplier_risk_tier, shocked.supplier_risk_tier, '')}
        ${dRow('ML Label',         baseline.ml_risk_label, shocked.ml_risk_label, '')}
      </div>
    </div>`;
}

// ─── Hook into existing analysis response ────────────────────────────────────
// Monkey-patch: call renderMLPanel after the existing pipeline response renders.
// Find wherever you call displayResults(data) or similar in script.js and add:
//   renderMLPanel(data.shipments, data.mlMetrics, data.shockPresets);
//
// OR if using a global result variable, add this at end of the success handler:
(function patchExistingAnalysis() {
  const origFetch = window.fetch;
  window.fetch = async function(...args) {
    const response = await origFetch.apply(this, args);
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
    if (url.includes('/api/analyze')) {
      // Clone so the original consumer can still read the body
      const clone = response.clone();
      clone.json().then(data => {
        if (data?.success && Array.isArray(data.shipments)) {
          // Delay slightly to let existing render complete first
          setTimeout(() => renderMLPanel(data.shipments, data.mlMetrics, data.shockPresets), 100);
        }
      }).catch(() => {});
    }
    return response;
  };
})();
