/**
 * script.js — SupplyShock Predictor Frontend (with Auth + Satellite Map)
 */

// ── State ────────────────────────────────────────────────────────────────────
let authToken = sessionStorage.getItem('ssp_token') || null;
let currentCountry = sessionStorage.getItem('ssp_country') || null;
let currentFlag = sessionStorage.getItem('ssp_flag') || '';
let allShipments = [];
let shipMap = null, routeGroup = null, weatherGroup = null, heatGroup = null, portGroup = null, markerGroup = null;
let mapLayers = { routes: true, weather: true, heat: true, ports: true };
let selectedCountry = null;

const COUNTRY_CREDS = {
  India:  { userId: 'IN_OPERATOR', password: 'india@2026'  },
  Iran:   { userId: 'IR_OPERATOR', password: 'iran@2026'   },
  USA:    { userId: 'US_OPERATOR', password: 'usa@2026'    },
  Russia: { userId: 'RU_OPERATOR', password: 'russia@2026' },
};

const PIPELINE_STEPS = [
  { id:'ingest',   label:'Agent 1: Data Ingestion'         },
  { id:'enrich',   label:'Agent 2: Weather Enrichment'     },
  { id:'geo',      label:'Agent 3: Geopolitical Analysis'  },
  { id:'port',     label:'Agent 4: Port Congestion'        },
  { id:'predict',  label:'Agent 5: Risk Prediction'        },
  { id:'insight',  label:'Agent 6: Insight Generator'      },
];

// ── Boot ─────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  if (authToken && currentCountry) showApp();
  else showLogin();
});

function el(id) { return document.getElementById(id); }
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Login ─────────────────────────────────────────────────────────────────────
function showLogin() {
  el('loginPage').style.display = 'flex';
  el('appPage').style.display = 'none';
}

function selectCountry(country) {
  selectedCountry = country;
  document.querySelectorAll('.country-pill').forEach(p => p.classList.remove('active'));
  document.querySelector(`.country-pill[data-country="${country}"]`)?.classList.add('active');
  const creds = COUNTRY_CREDS[country];
  if (creds) {
    el('loginUserId').value = creds.userId;
    el('loginPassword').value = creds.password;
  }
}

function togglePw() {
  const inp = el('loginPassword');
  inp.type = inp.type === 'password' ? 'text' : 'password';
}

async function doLogin() {
  const userId   = el('loginUserId').value.trim();
  const password = el('loginPassword').value;
  const errEl    = el('loginError');
  errEl.style.display = 'none';

  if (!userId || !password) {
    errEl.textContent = 'Please enter your Operator ID and password.';
    errEl.style.display = 'block'; return;
  }

  el('loginBtn').disabled = true;
  el('loginBtnText').textContent = 'Signing in...';
  el('loginSpinner').style.display = 'inline-block';

  try {
    const res  = await fetch('/api/auth/login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({userId, password}) });
    const data = await res.json();
    if (!data.success) {
      errEl.textContent = data.error || 'Invalid credentials. Please try again.';
      errEl.style.display = 'block';
    } else {
      authToken = data.token;
      currentCountry = data.country;
      currentFlag = data.flag;
      sessionStorage.setItem('ssp_token', authToken);
      sessionStorage.setItem('ssp_country', currentCountry);
      sessionStorage.setItem('ssp_flag', currentFlag);
      showApp();
    }
  } catch(e) {
    errEl.textContent = 'Connection error. Is the server running?';
    errEl.style.display = 'block';
  } finally {
    el('loginBtn').disabled = false;
    el('loginBtnText').textContent = 'Sign In to Dashboard';
    el('loginSpinner').style.display = 'none';
  }
}

el('loginPassword')?.addEventListener('keydown', e => { if(e.key==='Enter') doLogin(); });

async function doLogout() {
  try { await fetch('/api/auth/logout',{method:'POST',headers:{'x-auth-token':authToken}}); } catch(e){}
  authToken = null; currentCountry = null; currentFlag = '';
  sessionStorage.clear();
  allShipments = [];
  if(shipMap){ shipMap.remove(); shipMap=null; }
  hideAllSections();
  el('emptyState').style.display = 'flex';
  showLogin();
}

function showApp() {
  el('loginPage').style.display = 'none';
  el('appPage').style.display = 'block';
  el('countryFlag').textContent = currentFlag;
  el('countryName').textContent = currentCountry;
  el('mapCountryLabel').textContent = currentCountry;
  el('emptyTitle').textContent = `Ready to Analyze ${currentFlag} ${currentCountry} Imports`;
  el('emptyDesc').innerHTML = `Click <strong>Run Analysis</strong> to track all vessels importing into ${currentCountry} — with live positions, route maps, and geopolitical risk intel.`;
  applyCountryTheme();
}

function applyCountryTheme() {
  const themes = {
    India:  { accent:'#FF9933', accent2:'#138808', light:'#fff8f0' },
    Iran:   { accent:'#239f40', accent2:'#da0000', light:'#f0fff4' },
    USA:    { accent:'#1d4ed8', accent2:'#dc2626', light:'#eff6ff' },
    Russia: { accent:'#1e40af', accent2:'#dc2626', light:'#eff6ff' },
  };
  const t = themes[currentCountry] || themes.India;
  document.documentElement.style.setProperty('--country-accent', t.accent);
  document.documentElement.style.setProperty('--country-accent2', t.accent2);
  document.documentElement.style.setProperty('--country-light', t.light);
}

// ── Analysis ─────────────────────────────────────────────────────────────────
async function runAnalysis() {
  const btn = el('analyzeBtn');
  btn.disabled = true;
  buildPipelineSteps();
  el('loadingOverlay').style.display = 'flex';
  el('loadingTitle').textContent = `Analyzing ${currentCountry} Imports`;
  setStatus('running','Running...');

  const [result] = await Promise.all([fetchAnalysis(), animatePipeline()]);

  el('loadingOverlay').style.display = 'none';
  btn.disabled = false;
  if (!result || !result.success) {
    setStatus('error','Error');
    alert('Pipeline error: ' + (result?.error || 'Unknown'));
    return;
  }
  setStatus('done','Complete');
  renderDashboard(result);
}

async function fetchAnalysis() {
  try {
    const res = await fetch('/api/analyze', { method:'POST', headers:{'x-auth-token':authToken} });
    return await res.json();
  } catch(e) { return { success:false, error:e.message }; }
}

function setStatus(state, text) {
  el('statusDot').className = 'status-dot ' + state;
  el('statusText').textContent = text;
}

function buildPipelineSteps() {
  el('pipelineSteps').innerHTML = PIPELINE_STEPS.map(s =>
    `<div class="ps-item" id="step-${s.id}"><div class="ps-dot"></div><span>${s.label}</span></div>`
  ).join('');
  el('loadingBar').style.width = '0%';
}

async function animatePipeline() {
  for (let i=0; i<PIPELINE_STEPS.length; i++) {
    const s = PIPELINE_STEPS[i];
    el('loadingStep').textContent = `Running ${s.label}...`;
    el('loadingBar').style.width = `${((i+1)/PIPELINE_STEPS.length)*100}%`;
    if (i>0) {
      const prev = el(`step-${PIPELINE_STEPS[i-1].id}`);
      prev.classList.remove('active'); prev.classList.add('done');
      prev.querySelector('span').textContent = '✓ ' + PIPELINE_STEPS[i-1].label;
    }
    el(`step-${s.id}`)?.classList.add('active');
    await delay(400);
  }
  const last = el(`step-${PIPELINE_STEPS.at(-1).id}`);
  last?.classList.remove('active'); last?.classList.add('done');
  el('loadingBar').style.width = '100%';
}

// ── Dashboard Render ─────────────────────────────────────────────────────────
function renderDashboard({ shipments, alerts, summary }) {
  allShipments = shipments;
  showAllSections();
  renderSummary(summary, shipments);
  renderNewsTicker(shipments);
  renderSatelliteMap(shipments);
  renderGeoDelays(shipments);
  renderAlerts(alerts);
  renderRiskTable(shipments);
  renderBackupRoutes(shipments);
  renderRecommendations(shipments);
  renderCharts(shipments);
  renderEventFeed(shipments);
  renderConsignmentSection(shipments);
  renderPriceSection(shipments);
  renderImpact(shipments);
}

function showAllSections() {
  ['summaryStrip','newsTicker','mapSection','geoDelaySection','alertsSection','riskSection',
   'backupSection','recoSection','chartsSection','feedSection','consignSection','priceSection','impactSection']
    .forEach(id => el(id).style.display='');
  el('emptyState').style.display = 'none';
}
function hideAllSections() {
  ['summaryStrip','newsTicker','mapSection','geoDelaySection','alertsSection','riskSection',
   'backupSection','recoSection','chartsSection','feedSection','consignSection','priceSection','impactSection']
    .forEach(id => { if(el(id)) el(id).style.display='none'; });
}

// ── Summary ───────────────────────────────────────────────────────────────────
function renderSummary(s, shipments) {
  el('totalCount').textContent  = s.total;
  el('highCount').textContent   = s.high;
  el('mediumCount').textContent = s.medium;
  el('lowCount').textContent    = s.low;
  el('avgScore').textContent    = s.avgScore;
  const totalDelay = shipments.reduce((a,sh) => a + (sh.delayDays||0), 0);
  el('totalDelayDays').textContent = totalDelay + 'd';
}

// ── News Ticker ────────────────────────────────────────────────────────────────
function renderNewsTicker(shipments) {
  const headlines = [];
  shipments.forEach(s => {
    (s.geoPoliticalDelays||[]).forEach(d => {
      if (d.newsHeadline) headlines.push({ headline: d.newsHeadline, severity: d.severity, ship: s.name });
    });
  });
  if (!headlines.length) { el('newsTicker').style.display='none'; return; }
  el('newsTicker').style.display = 'flex';
  const items = [...headlines, ...headlines].map(h =>
    `<span class="ticker-item sev-${h.severity.toLowerCase()}">
       <span class="ticker-sev">${h.severity === 'High' ? '🔴' : h.severity === 'Medium' ? '🟡' : '🟢'}</span>
       <strong>${h.ship}:</strong> ${h.headline}
     </span>`
  ).join('<span class="ticker-sep">·</span>');
  el('tickerTrack').innerHTML = items;
}

// ── Geo Delay Panel ────────────────────────────────────────────────────────────
function renderGeoDelays(shipments) {
  const allDelays = [];
  shipments.forEach(s => {
    (s.geoPoliticalDelays||[]).forEach(d => {
      allDelays.push({ ...d, ship: s.name, shipId: s.shipId, route: s.route });
    });
  });
  if (!allDelays.length) { el('geoDelaySection').style.display='none'; return; }
  el('geoDelaySection').style.display = '';
  el('geoDelayGrid').innerHTML = allDelays.map(d => `
    <div class="geo-card sev-${d.severity.toLowerCase()}">
      <div class="geo-card-top">
        <span class="geo-badge sev-${d.severity.toLowerCase()}">${d.severity === 'High' ? '🔴' : d.severity === 'Medium' ? '🟡' : '🟢'} ${d.severity}</span>
        <span class="geo-ship">${d.ship} · ${d.shipId}</span>
      </div>
      <p class="geo-headline">"${d.newsHeadline}"</p>
      <div class="geo-meta">
        <span>📌 ${d.cause}</span>
        <span class="geo-delay">+${d.addedDays}d added</span>
      </div>
    </div>`
  ).join('');
}

// ── Alerts ─────────────────────────────────────────────────────────────────────
function renderAlerts(alerts) {
  el('alertCount').textContent = alerts.length;
  el('alertsPanel').innerHTML = alerts.length === 0
    ? '<div class="alert-item ok">✅ No critical alerts — all import shipments within acceptable parameters.</div>'
    : alerts.map((a,i) => `<div class="alert-item ${a.includes('WARNING')?'medium':''}" style="animation-delay:${i*0.05}s">${a}</div>`).join('');
}

// ── Risk Table ─────────────────────────────────────────────────────────────────
function renderRiskTable(shipments) {
  el('riskTableBody').innerHTML = shipments.map(s => {
    const color = scoreColor(s.riskScore);
    const delayTag = s.delayDays > 0
      ? `<span class="delay-tag delayed">+${s.delayDays}d</span>`
      : `<span class="delay-tag ok">On time</span>`;
    const cargo = (s.cargo||[]).join(', ');
    const weather = s.weatherData?.riskLevel || 'Low';
    const geoEvents = (s.geoPoliticalDelays||[]).length;
    return `
      <tr data-risk="${s.riskLabel}">
        <td>
          <div class="ship-name-link" onclick="flyToShip('${s.shipId}')" title="Click to locate on map">
            <span class="ship-name">${s.name}</span>
            <span class="ship-locate-icon">📍</span>
          </div>
          <div class="ship-id">${s.shipId}</div>
        </td>
        <td>${s.route}</td>
        <td title="${cargo}">${cargo.length>30?cargo.slice(0,28)+'…':cargo}</td>
        <td>${delayTag}</td>
        <td>${geoEvents>0?`<span class="geo-pill">${geoEvents} event${geoEvents>1?'s':''}</span>`:'<span class="geo-pill none">None</span>'}</td>
        <td><span class="risk-pill ${weather}">${weather}</span></td>
        <td>
          <div class="score-bar-wrap">
            <div class="score-bar"><div class="score-bar-fill" style="width:${s.riskScore}%;background:${color}"></div></div>
            <span class="score-val" style="color:${color}">${s.riskScore}</span>
          </div>
        </td>
        <td><span class="risk-pill ${s.riskLabel}">${s.riskLabel}</span></td>
      </tr>`;
  }).join('');
}

function flyToShip(shipId) {
  const ship = allShipments.find(s => s.shipId === shipId);
  if (!ship || !ship.currentLocation) return;
  const { lat, lon } = ship.currentLocation;

  // Scroll to map section smoothly
  const mapSection = el('mapSection');
  if (mapSection) mapSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Fly the map to the ship after a short delay (for scroll to complete)
  setTimeout(() => {
    if (!shipMap) return;
    shipMap.flyTo([lat, lon], 6, { animate: true, duration: 1.4 });
    // Open ship sidebar after flight
    setTimeout(() => showShipSidebar(ship), 1500);
  }, 400);
}

function filterTable(level, event) {
  document.querySelectorAll('.filter-btn').forEach(b=>b.classList.remove('active'));
  event.target.classList.add('active');
  document.querySelectorAll('#riskTableBody tr').forEach(row => {
    row.classList.toggle('hidden', level!=='All' && row.dataset.risk!==level);
  });
}

function scoreColor(score) {
  if (score>=70) return '#dc2626';
  if (score>=40) return '#d97706';
  return '#16a34a';
}

// ── Recommendations ────────────────────────────────────────────────────────────
// ── Backup Routes ─────────────────────────────────────────────────────────────
function renderBackupRoutes(shipments) {
  const triggered = shipments.filter(s => s.backupTriggered && s.backupRoute);

  // Update badge
  const badge = el('backupCount');
  if (badge) badge.textContent = triggered.length;

  if (!triggered.length) {
    el('backupSection').style.display = 'none';
    return;
  }
  el('backupSection').style.display = '';

  el('backupGrid').innerHTML = triggered.map(ship => {
    const br = ship.backupRoute;
    const confColor = br.confidence === 'Very High' ? 'var(--high)' : br.confidence === 'High' ? 'var(--medium)' : 'var(--low)';

    const triggerBadges = br.triggerReasons.map(r => {
      const icons = { port_congestion:'⚓', geopolitical:'🌐', geo_event:'📰', risk_score:'📊' };
      const cols  = { port_congestion:'high', geopolitical:'high', geo_event:'medium', risk_score:'medium' };
      return `<span class="trigger-badge ${cols[r.type]||'medium'}">${icons[r.type]||'⚠'} ${r.type.replace('_',' ')}</span>`;
    }).join('');

    const altPortHtml = br.altPort ? `
      <div class="br-block">
        <div class="br-block-title">⚓ Backup Destination Port</div>
        <div class="br-port-card">
          <div class="br-port-name">${br.altPort.name}</div>
          <div class="br-port-meta">
            <span class="risk-pill Low">Load ${br.altPort.loadPercent}%</span>
            <span class="risk-pill Low">${br.altPort.avgWaitDays}d wait</span>
            <span class="risk-pill Low">${br.altPort.operationalStatus}</span>
          </div>
          <p class="br-port-note">${br.altPort.note}</p>
        </div>
      </div>` : '';

    const altRouteHtml = br.altRoute ? `
      <div class="br-block">
        <div class="br-block-title">🗺 Alternate Water Route</div>
        <div class="br-route-card">
          <div class="br-route-name">${br.altRoute.name}</div>
          <div class="br-route-avoid">Avoids: <strong>${br.altRoute.avoidZone}</strong></div>
          <div class="br-route-waypoints">
            ${br.altRoute.waypoints.map((w,i) =>
              `<span class="wp-step">${i===0?'🟢':i===br.altRoute.waypoints.length-1?'🔴':'🔵'} ${w.name}</span>`
            ).join('<span class="wp-arrow">→</span>')}
          </div>
          <div class="br-route-meta">
            <span>+${br.altRoute.extraDays} days transit</span>
            <span class="br-cost">~$${(br.altRoute.extraDays * 50000).toLocaleString()} extra</span>
          </div>
          <p class="br-route-reason">${br.altRoute.reason}</p>
        </div>
      </div>` : '';

    return `
    <div class="backup-card">
      <div class="backup-card-header">
        <div class="backup-ship-info">
          <span class="backup-ship-name">${ship.name}</span>
          <span class="ship-id">${ship.shipId}</span>
          <span class="risk-pill ${ship.riskLabel}">${ship.riskLabel} Risk · ${ship.riskScore}</span>
        </div>
        <div class="backup-confidence" style="color:${confColor}">
          Confidence: <strong>${br.confidence}</strong>
        </div>
      </div>
      <div class="trigger-badges">${triggerBadges}</div>
      <div class="br-recommendation">
        <span class="br-rec-icon">💡</span>
        <p>${br.recommendation}</p>
      </div>
      <div class="br-blocks-row">
        ${altPortHtml}
        ${altRouteHtml}
      </div>
    </div>`;
  }).join('');

  // Draw backup routes on map
  drawBackupRoutesOnMap(triggered);
}

function drawBackupRoutesOnMap(ships) {
  if (!shipMap || !routeGroup) return;
  ships.forEach(ship => {
    const br = ship.backupRoute;
    if (!br?.altRoute?.waypoints?.length) return;
    const lls = br.altRoute.waypoints.map(w => [w.lat, w.lon]);
    // Backup route — purple dashed, antimeridian safe
    addSafePolyline(routeGroup, lls, {
      color: '#7c3aed', weight: 3, opacity: 0.75, dashArray: '10,6'
    });
    const mid = lls[Math.floor(lls.length / 2)];
    const icon = L.divIcon({
      html: `<div class="backup-route-label">&#x1F500; BACKUP</div>`,
      className: '', iconSize:[80,18], iconAnchor:[40,9]
    });
    routeGroup.addLayer(L.marker(mid, { icon, interactive:false }));
  });
}

function renderRecommendations(shipments) {
  const items = [];
  shipments.forEach(s => (s.recommendations||[]).forEach(r => items.push({ship:s,rec:r})));
  const icons = { alternate_supplier:'🔄', stock_increase:'📦', route_change:'🗺️', early_reorder:'⏰', monitor:'👁', geopolitical_alert:'📰', backup_route:'🔀' };
  el('recoGrid').innerHTML = items.map(({ship,rec}) => `
    <div class="reco-card risk-${ship.riskLabel.toLowerCase()}">
      <div class="reco-ship">${ship.name} · <span class="risk-pill ${ship.riskLabel}" style="font-size:9px">${ship.riskLabel}</span></div>
      <div class="reco-action">${icons[rec.type]||'📌'} ${rec.message}</div>
    </div>`).join('');
}

// ── Impact ─────────────────────────────────────────────────────────────────────
function renderImpact(shipments) {
  el('impactGrid').innerHTML = shipments.filter(s=>s.impact).map(s=>`
    <div class="impact-card">
      <div class="impact-ship">${s.name} <span class="risk-pill ${s.riskLabel}" style="font-size:10px">${s.riskLabel}</span></div>
      <div class="impact-row"><span>Est. Delay</span><span>${s.impact.estimatedDelayDays} days</span></div>
      <div class="impact-row"><span>Revenue at Risk</span><span class="loss">$${s.impact.estimatedRevenueLoss.toLocaleString()}</span></div>
      <div class="impact-row"><span>Cargo Risk</span><span class="loss">$${s.impact.estimatedCargoRisk.toLocaleString()}</span></div>
      <div class="impact-row total"><span>Total Impact</span><span class="loss">$${s.impact.totalEstimatedImpact.toLocaleString()}</span></div>
    </div>`).join('');
}

// ══════════════════════════════════════════════════════════════════════════════
// PIE CHARTS
// ══════════════════════════════════════════════════════════════════════════════

let chartInstances = {};

function destroyChart(id) {
  if (chartInstances[id]) { chartInstances[id].destroy(); delete chartInstances[id]; }
}

function buildLegend(containerId, labels, colors, values) {
  const total = values.reduce((a,b) => a+b, 0);
  el(containerId).innerHTML = labels.map((l,i) => `
    <div class="cl-item">
      <span class="cl-dot" style="background:${colors[i]}"></span>
      <span class="cl-label">${l}</span>
      <span class="cl-pct">${total>0?Math.round(values[i]/total*100):0}%</span>
    </div>`).join('');
}

function makeDonut(canvasId, labels, data, colors, legendId) {
  destroyChart(canvasId);
  const ctx = el(canvasId).getContext('2d');
  chartInstances[canvasId] = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors,
        borderColor: '#ffffff',
        borderWidth: 3,
        hoverOffset: 8,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      cutout: '62%',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.label}: ${ctx.parsed} (${Math.round(ctx.parsed / ctx.dataset.data.reduce((a,b)=>a+b,0)*100)}%)`
          },
          backgroundColor: '#fff',
          titleColor: '#0f172a',
          bodyColor: '#334155',
          borderColor: '#e2e8f0',
          borderWidth: 1,
          padding: 10,
          boxPadding: 4,
        }
      },
      animation: { animateRotate: true, duration: 800, easing: 'easeInOutQuart' }
    }
  });
  buildLegend(legendId, labels, colors, data);
}

function makePolar(canvasId, labels, data, colors, legendId) {
  destroyChart(canvasId);
  const ctx = el(canvasId).getContext('2d');
  chartInstances[canvasId] = new Chart(ctx, {
    type: 'polarArea',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors.map(c => c + 'cc'),
        borderColor: colors,
        borderWidth: 2,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      scales: {
        r: {
          ticks: { display: false },
          grid: { color: '#e2e8f0' },
          pointLabels: { display: false }
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#fff',
          titleColor: '#0f172a',
          bodyColor: '#334155',
          borderColor: '#e2e8f0',
          borderWidth: 1,
          padding: 10,
        }
      },
      animation: { animateRotate: true, duration: 900, easing: 'easeInOutQuart' }
    }
  });
  buildLegend(legendId, labels, colors, data);
}

function renderCharts(shipments) {
  // ── Chart 1: Risk Distribution (donut) ────────────────────────────────────
  const high   = shipments.filter(s => s.riskLabel === 'High').length;
  const medium = shipments.filter(s => s.riskLabel === 'Medium').length;
  const low    = shipments.filter(s => s.riskLabel === 'Low').length;
  makeDonut('chartRisk',
    ['High Risk', 'Medium Risk', 'Low Risk'],
    [high, medium, low],
    ['#dc2626', '#d97706', '#16a34a'],
    'legendRisk'
  );

  // ── Chart 2: Cargo Categories (donut) ─────────────────────────────────────
  const cargoMap = {};
  shipments.forEach(s => (s.cargo||[]).forEach(c => { cargoMap[c] = (cargoMap[c]||0) + 1; }));
  const cargoLabels = Object.keys(cargoMap);
  const cargoVals   = Object.values(cargoMap);
  const cargoColors = [
    '#1d4ed8','#0ea5e9','#6366f1','#8b5cf6','#ec4899',
    '#f97316','#eab308','#10b981','#14b8a6','#06b6d4',
    '#64748b','#84cc16','#f43f5e','#a855f7','#22d3ee'
  ].slice(0, cargoLabels.length);
  makeDonut('chartCargo', cargoLabels, cargoVals, cargoColors, 'legendCargo');

  // ── Chart 3: Geopolitical Severity (donut) ────────────────────────────────
  let gHigh = 0, gMed = 0, gLow = 0;
  shipments.forEach(s => (s.geoPoliticalDelays||[]).forEach(d => {
    if (d.severity === 'High') gHigh++;
    else if (d.severity === 'Medium') gMed++;
    else gLow++;
  }));
  const hasGeo = gHigh + gMed + gLow > 0;
  makeDonut('chartGeo',
    hasGeo ? ['High Severity', 'Medium Severity', 'Low Severity'] : ['No Events'],
    hasGeo ? [gHigh, gMed, gLow].filter((_,i) => [gHigh,gMed,gLow][i]>0) : [1],
    hasGeo ? ['#dc2626','#d97706','#16a34a'].filter((_,i)=>[gHigh,gMed,gLow][i]>0) : ['#cbd5e1'],
    'legendGeo'
  );
  if (hasGeo) buildLegend('legendGeo',
    ['High Severity','Medium Severity','Low Severity'].filter((_,i)=>[gHigh,gMed,gLow][i]>0),
    ['#dc2626','#d97706','#16a34a'].filter((_,i)=>[gHigh,gMed,gLow][i]>0),
    [gHigh,gMed,gLow].filter(v=>v>0)
  );

  // ── Chart 4: Delay by Vessel (polar area) ─────────────────────────────────
  const delayed = shipments.filter(s => s.delayDays > 0);
  const ontime  = shipments.filter(s => s.delayDays === 0);
  if (delayed.length > 0) {
    const delayLabels = delayed.map(s => s.name.length > 16 ? s.name.slice(0,14)+'…' : s.name);
    const delayVals   = delayed.map(s => s.delayDays);
    const delayColors = ['#dc2626','#d97706','#f97316','#8b5cf6','#ec4899','#0ea5e9','#10b981','#eab308'].slice(0,delayed.length);
    makePolar('chartDelay', delayLabels, delayVals, delayColors, 'legendDelay');
  } else {
    // All on time – show a simple "All On Time" chart
    makeDonut('chartDelay', ['All Vessels On Time'], [1], ['#16a34a'], 'legendDelay');
    buildLegend('legendDelay', ['All Vessels On Time'], ['#16a34a'], [shipments.length]);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// SATELLITE MAP
// ══════════════════════════════════════════════════════════════════════════════

const TILE_LAYERS = {
  satellite: { url:'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attr:'Esri World Imagery' },
  terrain:   { url:'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', attr:'Esri World Topo' },
  street:    { url:'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attr:'OpenStreetMap contributors' },
};

// Risky shipping corridors — highlighted as warning zones on map
const RISKY_CORRIDORS = [
  {
    name: 'Red Sea / Houthi Zone',
    color: '#dc2626',
    opacity: 0.18,
    points: [[12.5,43.5],[15.0,42.5],[20.0,38.0],[25.0,35.0],[28.0,33.5],[30.0,32.5],[28.0,33.5],[25.0,35.0],[20.0,38.5],[15.0,43.0],[12.0,44.5],[12.5,43.5]],
    label: '🚀 Houthi Attack Zone'
  },
  {
    name: 'Strait of Hormuz',
    color: '#f97316',
    opacity: 0.20,
    points: [[26.5,56.0],[27.5,56.5],[27.8,57.5],[27.0,58.5],[26.0,58.0],[25.5,57.0],[26.5,56.0]],
    label: '⚓ Hormuz Chokepoint'
  },
  {
    name: 'Taiwan Strait',
    color: '#f97316',
    opacity: 0.15,
    points: [[22.0,119.5],[24.0,119.0],[26.0,120.0],[25.0,122.0],[23.0,121.5],[21.5,120.5],[22.0,119.5]],
    label: '⚠ Taiwan Strait Tension'
  },
  {
    name: 'Black Sea War Zone',
    color: '#dc2626',
    opacity: 0.18,
    points: [[41.5,28.0],[43.0,29.0],[45.5,32.5],[46.5,37.0],[45.0,38.5],[43.0,37.0],[41.5,35.0],[40.5,31.0],[41.5,28.0]],
    label: '💥 Black Sea War Zone'
  },
  {
    name: 'Gulf of Guinea Piracy',
    color: '#d97706',
    opacity: 0.14,
    points: [[3.0,0.0],[5.0,2.0],[4.0,6.0],[2.0,8.0],[1.0,5.0],[0.0,2.0],[3.0,0.0]],
    label: '🏴‍☠️ Piracy Risk Zone'
  },
  {
    name: 'Bay of Bengal Piracy',
    color: '#d97706',
    opacity: 0.12,
    points: [[7.0,83.0],[9.0,86.0],[12.0,88.0],[14.0,85.0],[12.0,82.0],[9.0,81.0],[7.0,83.0]],
    label: '⚠ Piracy Alert'
  },
];

let corridorGroup = null;

let currentTile = 'satellite';
let baseTileLayer = null;

const WEATHER_ZONES = [
  { center:[12.5,45.0],  radius:400000, label:'Tropical Storm', level:'High',   color:'rgba(220,38,38,0.15)',   border:'#dc2626' },
  { center:[29.9,32.5],  radius:250000, label:'Sandstorm',      level:'Medium', color:'rgba(217,119,6,0.13)',   border:'#d97706' },
  { center:[1.3,103.8],  radius:200000, label:'Heavy Rain',      level:'Medium', color:'rgba(217,119,6,0.13)',   border:'#d97706' },
  { center:[35.1,140.2], radius:350000, label:'Clear',           level:'Low',    color:'rgba(22,163,74,0.08)',   border:'#16a34a' },
  { center:[41.5,29.5],  radius:180000, label:'Fog',             level:'Medium', color:'rgba(217,119,6,0.13)',   border:'#d97706' },
  { center:[69.8,64.3],  radius:300000, label:'Blizzard',        level:'High',   color:'rgba(220,38,38,0.15)',   border:'#dc2626' },
  { center:[38.2,-148.6],radius:280000, label:'Swell',           level:'Medium', color:'rgba(217,119,6,0.10)',   border:'#d97706' },
  { center:[42.8,-38.5], radius:260000, label:'Rough Seas',      level:'Medium', color:'rgba(217,119,6,0.10)',   border:'#d97706' },
];

const PORT_MARKERS = [
  { name:'Nhava Sheva',         lat:18.9,  lon:72.8,   load:82, level:'Medium', countries:['India'] },
  { name:'Chennai',             lat:13.1,  lon:80.3,   load:70, level:'Low',    countries:['India'] },
  { name:'Kochi',               lat:9.9,   lon:76.3,   load:65, level:'Low',    countries:['India'] },
  { name:'Kolkata',             lat:22.5,  lon:88.3,   load:75, level:'Medium', countries:['India'] },
  { name:'Bandar Abbas',        lat:27.2,  lon:56.3,   load:88, level:'High',   countries:['Iran','India'] },
  { name:'Imam Khomeini Port',  lat:30.4,  lon:49.1,   load:90, level:'High',   countries:['Iran'] },
  { name:'Chabahar',            lat:25.3,  lon:60.6,   load:60, level:'Low',    countries:['Iran'] },
  { name:'Los Angeles',         lat:33.7,  lon:-118.2, load:95, level:'High',   countries:['USA'] },
  { name:'Houston',             lat:29.7,  lon:-95.0,  load:82, level:'Medium', countries:['USA'] },
  { name:'New York',            lat:40.7,  lon:-74.0,  load:78, level:'Medium', countries:['USA'] },
  { name:'Baltimore',           lat:39.3,  lon:-76.6,  load:70, level:'Low',    countries:['USA'] },
  { name:'Saint Petersburg',    lat:60.0,  lon:30.3,   load:85, level:'High',   countries:['Russia'] },
  { name:'Novorossiysk',        lat:44.7,  lon:37.8,   load:80, level:'Medium', countries:['Russia'] },
  { name:'Vladivostok',         lat:43.1,  lon:131.9,  load:72, level:'Medium', countries:['Russia'] },
  { name:'Murmansk',            lat:68.9,  lon:33.1,   load:65, level:'Low',    countries:['Russia'] },
];

// ── Antimeridian-safe polyline ─────────────────────────────────────────────────
// Splits a latlng array wherever longitude jumps > 180 degrees (crosses date line)
// so Leaflet doesn't draw a line through Eurasia instead of across the Pacific.
function splitAtAntimeridian(latlngs) {
  if (!latlngs || latlngs.length < 2) return [latlngs || []];
  const segs = [];
  let cur = [latlngs[0]];
  for (let i = 1; i < latlngs.length; i++) {
    const dLon = latlngs[i][1] - cur[cur.length - 1][1];
    if (Math.abs(dLon) > 180) { segs.push(cur); cur = [latlngs[i]]; }
    else cur.push(latlngs[i]);
  }
  segs.push(cur);
  return segs;
}

function addSafePolyline(group, latlngs, opts) {
  splitAtAntimeridian(latlngs).forEach(seg => {
    if (seg.length >= 2) group.addLayer(L.polyline(seg, opts));
  });
}

function renderSatelliteMap(shipments) {
  if (shipMap) { shipMap.remove(); shipMap = null; }

  shipMap = L.map('shipMap', {
    center: [20, 20],
    zoom: 3,
    zoomControl: true,
    worldCopyJump: true,
  });

  const tl = TILE_LAYERS[currentTile];
  baseTileLayer = L.tileLayer(tl.url, { attribution:tl.attr, maxZoom:18 }).addTo(shipMap);

  routeGroup   = L.layerGroup().addTo(shipMap);
  weatherGroup = L.layerGroup().addTo(shipMap);
  heatGroup    = L.layerGroup().addTo(shipMap);
  portGroup    = L.layerGroup().addTo(shipMap);
  markerGroup  = L.layerGroup().addTo(shipMap);
  corridorGroup = L.layerGroup().addTo(shipMap);

  // Draw risky shipping corridors
  RISKY_CORRIDORS.forEach(c => {
    const poly = L.polygon(c.points, {
      color: c.color, fillColor: c.color, fillOpacity: c.opacity, weight: 1.5, dashArray: '4,4'
    });
    poly.bindTooltip(`<div class="ssp-tooltip"><strong>${c.label}</strong><br><span style="color:${c.color}">High Risk Corridor</span></div>`, { className:'ssp-tt', sticky:true });
    corridorGroup.addLayer(poly);
    // Label at centroid
    const lats = c.points.map(p=>p[0]), lons = c.points.map(p=>p[1]);
    const cLat = (Math.min(...lats)+Math.max(...lats))/2;
    const cLon = (Math.min(...lons)+Math.max(...lons))/2;
    const lIcon = L.divIcon({ html:`<div class="corridor-label">${c.label}</div>`, className:'', iconSize:[160,16], iconAnchor:[80,8] });
    corridorGroup.addLayer(L.marker([cLat,cLon],{icon:lIcon,interactive:false}));
  });

  // Weather zones
  WEATHER_ZONES.forEach(z => {
    const circle = L.circle(z.center, {
      radius:z.radius, color:z.border, fillColor:z.color, fillOpacity:1, weight:1.5, dashArray:'6,5'
    });
    circle.bindTooltip(`<div class="ssp-tooltip"><strong>${z.label}</strong><br>Weather risk: ${z.level}</div>`, { className:'ssp-tt', sticky:true });
    weatherGroup.addLayer(circle);
    const wIcon = L.divIcon({ html:`<div class="w-label ${z.level.toLowerCase()}">${z.label}</div>`, className:'', iconSize:[90,18], iconAnchor:[45,9] });
    weatherGroup.addLayer(L.marker(z.center, { icon:wIcon, interactive:false }));
  });

  // Port markers
  PORT_MARKERS.filter(p => p.countries.includes(currentCountry) || true).forEach(p => {
    const col = p.level==='High'?'#dc2626':p.level==='Medium'?'#d97706':'#16a34a';
    const pIcon = L.divIcon({ html:`<div class="port-marker" style="border-color:${col}">⚓</div>`, className:'', iconSize:[24,24], iconAnchor:[12,12] });
    const pm = L.marker([p.lat,p.lon], { icon:pIcon });
    pm.bindTooltip(`<div class="ssp-tooltip"><strong>⚓ ${p.name}</strong><br>Load: ${p.load}%<br>Congestion: ${p.level}</div>`, { className:'ssp-tt', direction:'top' });
    portGroup.addLayer(pm);
    const lIcon = L.divIcon({ html:`<div class="port-label">${p.name}</div>`, className:'', iconSize:[100,16], iconAnchor:[50,-6] });
    portGroup.addLayer(L.marker([p.lat,p.lon], { icon:lIcon, interactive:false }));
  });

  // Heatmap circles (risk density)
  shipments.forEach(s => {
    if (!s.currentLocation) return;
    const { lat, lon } = s.currentLocation;
    const col = s.riskScore>=70?'rgba(220,38,38,':s.riskScore>=40?'rgba(217,119,6,':'rgba(22,163,74,';
    for (let r=1; r<=3; r++) {
      const heat = L.circle([lat,lon], {
        radius: 120000 * r * (s.riskScore/80),
        color:'transparent', fillColor:col+(0.08/r)+')', fillOpacity:1, weight:0
      });
      heatGroup.addLayer(heat);
    }
  });

  // Route lines + ship markers
  shipments.forEach(s => {
    if (!s.currentLocation) return;
    if (s.routeWaypoints?.length > 1) {
      const lls = s.routeWaypoints.map(w => [w.lat, w.lon]);
      const col = getShipColor(s);
      // Glow shadow — antimeridian safe
      addSafePolyline(routeGroup, lls, { color:col, weight:6, opacity:0.12 });
      // Route line — antimeridian safe
      addSafePolyline(routeGroup, lls, { color:col, weight:2, opacity:0.8, dashArray:'8,5' });
      // Waypoints
      s.routeWaypoints.forEach((w,i) => {
        if(i===0||i===s.routeWaypoints.length-1) return;
        const dot = L.circleMarker([w.lat,w.lon],{radius:3,color:col,fillColor:col,fillOpacity:0.6,weight:1});
        dot.bindTooltip(`<div class="ssp-tooltip">${w.name}</div>`,{className:'ssp-tt'});
        routeGroup.addLayer(dot);
      });
      // Origin
      const ori = s.routeWaypoints[0];
      routeGroup.addLayer(L.circleMarker([ori.lat,ori.lon],{radius:5,color:col,fillColor:'white',fillOpacity:1,weight:2}));
      // Destination
      const dest = s.routeWaypoints.at(-1);
      routeGroup.addLayer(L.circleMarker([dest.lat,dest.lon],{radius:6,color:col,fillColor:col,fillOpacity:0.9,weight:2}));
    }

    // Ship marker with progress indicator
    const { lat, lon } = s.currentLocation;
    // Calculate route progress %
    let progressPct = 50;
    if (s.routeWaypoints && s.routeWaypoints.length >= 2) {
      const wps = s.routeWaypoints;
      const curIdx = wps.findIndex(w => w.name && w.name.toLowerCase().includes('current'));
      progressPct = curIdx >= 0 ? Math.round((curIdx / (wps.length - 1)) * 100) : 50;
    }
    const sIcon = createShipIcon(s, progressPct);
    const marker = L.marker([lat, lon], { icon:sIcon });
    marker.on('click', () => showShipSidebar(s));
    marker.bindTooltip(
      `<div class="ssp-tooltip"><strong>🚢 ${s.name}</strong><br>${s.origin} → ${s.destination}<br>Risk: <strong>${s.riskLabel||'?'}</strong>${s.delayDays>0?`<br>Delay: +${s.delayDays}d`:''}${(s.geoPoliticalDelays||[]).length>0?`<br>⚠ ${s.geoPoliticalDelays.length} geo event(s)`:''}</div>`,
      { className:'ssp-tt', direction:'top' }
    );
    markerGroup.addLayer(marker);
  });

  // Fit bounds using all route waypoints (not just current positions)
  const allCoords = [];
  shipments.forEach(s => {
    if (s.currentLocation) allCoords.push([s.currentLocation.lat, s.currentLocation.lon]);
    (s.routeWaypoints || []).forEach(w => allCoords.push([w.lat, w.lon]));
  });
  // Exclude extreme antimeridian coords to prevent a broken world-zoom
  const safeBounds = allCoords.filter(c => c[1] > -175 && c[1] < 175);
  if (safeBounds.length) shipMap.fitBounds(safeBounds, { padding:[40,40], maxZoom:5 });

  // Apply layer visibility
  Object.entries(mapLayers).forEach(([k,v]) => {
    const g = { routes:routeGroup, weather:weatherGroup, heat:heatGroup, ports:portGroup }[k];
    if(g) v ? shipMap.addLayer(g) : shipMap.removeLayer(g);
  });
}

function getShipColor(ship) {
  if (ship.riskScore>=70) return '#dc2626';
  if (ship.riskScore>=40) return '#d97706';
  return '#16a34a';
}

function createShipIcon(ship, progress) {
  const col = getShipColor(ship);
  const geoEvents = (ship.geoPoliticalDelays||[]).length;
  const pct = progress || 50;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="42" height="42" viewBox="0 0 42 42">
    <circle cx="21" cy="21" r="19" fill="white" stroke="${col}" stroke-width="2" opacity="0.95"/>
    <!-- Progress arc -->
    <circle cx="21" cy="21" r="15" fill="none" stroke="${col}" stroke-width="2.5" opacity="0.25"/>
    <circle cx="21" cy="21" r="15" fill="none" stroke="${col}" stroke-width="2.5"
      stroke-dasharray="${Math.round(pct/100*94.2)} 94.2"
      stroke-linecap="round" transform="rotate(-90 21 21)" opacity="0.8"/>
    <text x="21" y="25" text-anchor="middle" font-size="14">🚢</text>
    ${geoEvents>0?`<circle cx="31" cy="11" r="7" fill="#f59e0b" stroke="white" stroke-width="1.5"/>
    <text x="31" y="15" text-anchor="middle" font-size="8" fill="white" font-weight="bold">${geoEvents}</text>`:''}
  </svg>`;
  return L.divIcon({ html:svg, className:'', iconSize:[42,42], iconAnchor:[21,21], popupAnchor:[0,-22] });
}

function showShipSidebar(ship) {
  el('sidebarPlaceholder').style.display = 'none';
  const card = el('sidebarCard');
  card.style.display = 'block';
  const col = getShipColor(ship);
  const geoHtml = (ship.geoPoliticalDelays||[]).map(d=>`
    <div class="sd-geo sev-${d.severity.toLowerCase()}">
      <div class="sd-geo-badge">${d.severity==='High'?'🔴':d.severity==='Medium'?'🟡':'🟢'} ${d.severity} +${d.addedDays}d</div>
      <p>${d.newsHeadline}</p>
    </div>`).join('');

  card.innerHTML = `
    <div class="sd-header" style="border-left:4px solid ${col}">
      <div class="sd-name">${ship.name}</div>
      <div class="sd-id">${ship.shipId}</div>
      <span class="risk-pill ${ship.riskLabel}">${ship.riskLabel} Risk</span>
    </div>
    <div class="sd-body">
      <div class="sd-row"><span>Origin</span><strong>${ship.origin}</strong></div>
      <div class="sd-row"><span>Destination</span><strong>${ship.destination}</strong></div>
      <div class="sd-row"><span>Status</span><strong>${ship.status}</strong></div>
      <div class="sd-row"><span>Delay</span><strong class="${ship.delayDays>0?'loss':''}">${ship.delayDays>0?'+'+ship.delayDays+' days':'On time'}</strong></div>
      <div class="sd-row"><span>Cargo</span><strong>${(ship.cargo||[]).join(', ')}</strong></div>
      <div class="sd-row"><span>Position</span><strong class="mono">${ship.currentLocation.lat.toFixed(2)}°, ${ship.currentLocation.lon.toFixed(2)}°</strong></div>
      <div class="sd-row"><span>Risk Score</span>
        <div class="sd-score-wrap">
          <div class="score-bar"><div class="score-bar-fill" style="width:${ship.riskScore}%;background:${col}"></div></div>
          <strong style="color:${col}">${ship.riskScore}</strong>
        </div>
      </div>
      ${geoHtml.length?`<div class="sd-geo-section"><div class="sd-geo-title">⚠ Geopolitical Events</div>${geoHtml}</div>`:'<div class="sd-no-geo">✅ No active geopolitical delays</div>'}
    </div>`;
}

function toggleMapLayer(layer, btn) {
  mapLayers[layer] = !mapLayers[layer];
  btn.classList.toggle('active', mapLayers[layer]);
  const g = { routes:routeGroup, weather:weatherGroup, heat:heatGroup, ports:portGroup, corridors:corridorGroup }[layer];
  if (!g || !shipMap) return;
  mapLayers[layer] ? shipMap.addLayer(g) : shipMap.removeLayer(g);
}

function changeMapTile(type) {
  currentTile = type;
  if (!shipMap || !baseTileLayer) return;
  shipMap.removeLayer(baseTileLayer);
  const tl = TILE_LAYERS[type];
  baseTileLayer = L.tileLayer(tl.url, { attribution:tl.attr, maxZoom:18 }).addTo(shipMap);
  baseTileLayer.bringToBack();
}

// ══════════════════════════════════════════════════════════════════════════════
// LIVE IMPORT / EXPORT FEED
// ══════════════════════════════════════════════════════════════════════════════

let allFeedEvents = [];

function renderEventFeed(shipments) {
  allFeedEvents = [];
  shipments.forEach(s => {
    (s.eventFeed || []).forEach(ev => {
      allFeedEvents.push({ ...ev, shipName: s.name, shipId: s.shipId, importCountry: s.importCountry });
    });
  });
  // Sort newest first
  allFeedEvents.sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
  displayFeedEvents(allFeedEvents);
}

function displayFeedEvents(events) {
  const icons = {
    DEPARTURE:       '🛳',
    WAYPOINT_PASSED: '📍',
    DELAY_REPORTED:  '⏱',
    GEO_ALERT:       '📰',
    ARRIVAL:         '⚓',
  };
  const container = el('feedList');
  if (!events.length) {
    container.innerHTML = '<div class="feed-empty">No events to display</div>';
    return;
  }
  container.innerHTML = events.slice(0, 80).map(ev => {
    const ts  = new Date(ev.timestamp);
    const fmt = ts.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}) +
                ' ' + ts.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
    const icon = icons[ev.type] || '📌';
    const sevClass = ev.severity === 'danger' ? 'feed-danger' :
                     ev.severity === 'warning' ? 'feed-warning' : 'feed-info';
    return `
    <div class="feed-item ${sevClass}">
      <div class="feed-icon">${icon}</div>
      <div class="feed-body">
        <div class="feed-header-row">
          <span class="feed-ship">${ev.shipName}</span>
          <span class="feed-type-badge ${ev.type.toLowerCase()}">${ev.type.replace('_',' ')}</span>
          ${ev.addedDays ? `<span class="feed-delay-tag">+${ev.addedDays}d</span>` : ''}
        </div>
        <div class="feed-desc">${ev.description}</div>
        <div class="feed-meta">
          <span class="feed-location">📍 ${ev.location}</span>
          <span class="feed-time">🕐 ${fmt}</span>
        </div>
      </div>
    </div>`;
  }).join('');
}

function filterFeed(type) {
  const filtered = type === 'ALL' ? allFeedEvents : allFeedEvents.filter(e => e.type === type);
  displayFeedEvents(filtered);
}

// ══════════════════════════════════════════════════════════════════════════════
// CONSIGNMENT DRILL-DOWN
// ══════════════════════════════════════════════════════════════════════════════

function renderConsignmentSection(shipments) {
  // Build ship selector pills
  el('consignSelector').innerHTML = shipments.map(s =>
    `<button class="consign-pill" onclick="showConsignment('${s.shipId}')" id="cpill-${s.shipId}">
       🚢 ${s.name}
     </button>`
  ).join('');
  // Auto-show first ship
  if (shipments.length) showConsignment(shipments[0].shipId);
}

function showConsignment(shipId) {
  const ship = allShipments.find(s => s.shipId === shipId);
  if (!ship || !ship.consignment) return;

  // Highlight pill
  document.querySelectorAll('.consign-pill').forEach(p => p.classList.remove('active'));
  const pill = document.getElementById(`cpill-${shipId}`);
  if (pill) pill.classList.add('active');

  const c = ship.consignment;
  const riskCol = ship.riskLabel === 'High' ? '#dc2626' : ship.riskLabel === 'Medium' ? '#d97706' : '#16a34a';
  const excClass = c.exceptionStatus === 'None' ? 'exc-ok' : c.exceptionStatus.includes('Risk') ? 'exc-danger' : 'exc-warning';

  const itemsHtml = c.items.map(item => `
    <tr>
      <td><strong>${item.itemName}</strong></td>
      <td class="mono">${item.quantity.toLocaleString()} ${item.unit}</td>
      <td class="mono">${item.weightMT.toLocaleString()} MT</td>
      <td class="mono">$${item.valueUSD.toLocaleString()}</td>
      <td class="mono">${item.hsCode}</td>
    </tr>`).join('');

  el('consignDetail').innerHTML = `
  <div class="consign-card">
    <div class="consign-top">
      <div class="consign-id-block">
        <div class="consign-id">${c.consignmentId}</div>
        <div class="consign-bl">B/L: ${c.billOfLading}</div>
      </div>
      <div class="consign-badges">
        <span class="risk-pill ${ship.riskLabel}">${ship.riskLabel} Risk</span>
        <span class="exc-badge ${excClass}">${c.exceptionStatus}</span>
        <span class="inco-badge">${c.incoterms}</span>
      </div>
    </div>

    <div class="consign-meta-grid">
      <div class="cm-item"><span>Vessel</span><strong>${ship.name}</strong></div>
      <div class="cm-item"><span>Carrier</span><strong>${c.carrier}</strong></div>
      <div class="cm-item"><span>Origin Port</span><strong>${c.portOfLoading}</strong></div>
      <div class="cm-item"><span>Destination Port</span><strong>${c.portOfDischarge}</strong></div>
      <div class="cm-item"><span>Departure</span><strong>${c.departureDate}</strong></div>
      <div class="cm-item"><span>ETA</span><strong class="${ship.delayDays>0?'loss':''}">${c.expectedArrival}${ship.delayDays>0?' (+'+ship.delayDays+'d)':''}</strong></div>
      <div class="cm-item"><span>Total Weight</span><strong>${c.totalWeightMT.toLocaleString()} MT</strong></div>
      <div class="cm-item"><span>Total Value</span><strong>$${c.totalValueUSD.toLocaleString()}</strong></div>
      <div class="cm-item"><span>Customs Status</span><strong>${c.customsStatus}</strong></div>
      <div class="cm-item"><span>Insurance</span><strong>${c.insuranceCover}</strong></div>
    </div>

    <div class="consign-containers">
      <div class="cc-label">Container Numbers</div>
      <div class="cc-list">${c.containerNumbers.map(n=>`<span class="container-num">${n}</span>`).join('')}</div>
    </div>

    ${c.exceptionStatus !== 'None' ? `
    <div class="exception-banner">
      <span>⚠ Exception:</span> ${c.exceptionDetail}
    </div>` : `
    <div class="exception-ok">
      <span>✅ No exceptions — shipment on track</span>
    </div>`}

    <div class="consign-items-table">
      <div class="cc-label">Line Items</div>
      <table class="items-table">
        <thead><tr><th>Item</th><th>Quantity</th><th>Weight</th><th>Value</th><th>HS Code</th></tr></thead>
        <tbody>${itemsHtml}</tbody>
      </table>
    </div>
  </div>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// CARGO PRICE PREDICTION
// ══════════════════════════════════════════════════════════════════════════════

function renderPriceSection(shipments) {
  const sel = el('priceShipSelect');
  sel.innerHTML = '<option value="">Select vessel...</option>' +
    shipments.map(s => `<option value="${s.shipId}">${s.name}</option>`).join('');
  // Auto-load first ship
  if (shipments.length) {
    sel.value = shipments[0].shipId;
    renderPriceForShip(shipments[0].shipId);
  }
}

function renderPriceForShip(shipId) {
  const ship = allShipments.find(s => s.shipId === shipId);
  if (!ship || !ship.pricePrediction) return;

  const pp = ship.pricePrediction;
  el('priceGrid').innerHTML = Object.entries(pp).map(([cargo, data]) => {
    const change = Number(data.priceChange14d);
    const trendIcon = change > 2 ? '↗' : change < -2 ? '↘' : '→';
    const trendClass = change > 2 ? 'price-up' : change < -2 ? 'price-down' : 'price-flat';
    const recClass = data.recommendation.includes('BUY') ? 'rec-buy' :
                     data.recommendation.includes('WAIT') ? 'rec-wait' : 'rec-stable';

    // Build mini sparkline from forecast
    const prices = data.forecast.map(f => f.price);
    const minP = Math.min(...prices);
    const maxP = Math.max(...prices);
    const range = maxP - minP || 1;
    const pts = prices.map((p, i) => {
      const x = (i / (prices.length-1)) * 240;
      const y = 50 - ((p - minP) / range) * 45;
      return `${x},${y}`;
    }).join(' ');

    const areaPath = `M0,50 L${pts.split(' ').map((p,i) => i===0?`0,50 L${p}`:p).join(' L')} L240,50 Z`;

    return `
    <div class="price-card">
      <div class="price-card-header">
        <div>
          <div class="price-cargo-name">${cargo}</div>
          <div class="price-unit">${data.unit}</div>
        </div>
        <div class="price-change-badge ${trendClass}">
          ${trendIcon} ${change > 0 ? '+' : ''}${change}% / 14d
        </div>
      </div>
      <div class="price-current">
        <span class="price-label">Current</span>
        <span class="price-val">$${data.currentPrice.toLocaleString()}</span>
      </div>
      <div class="price-chart">
        <svg viewBox="0 0 240 55" width="100%" height="55" preserveAspectRatio="none">
          <defs>
            <linearGradient id="pg-${cargo.replace(/\s/g,'')}" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="${change>=0?'#16a34a':'#dc2626'}" stop-opacity="0.25"/>
              <stop offset="100%" stop-color="${change>=0?'#16a34a':'#dc2626'}" stop-opacity="0"/>
            </linearGradient>
          </defs>
          <path d="${areaPath}" fill="url(#pg-${cargo.replace(/\s/g,'')})" />
          <polyline points="${pts}" fill="none" stroke="${change>=0?'#16a34a':'#dc2626'}" stroke-width="1.5"/>
        </svg>
      </div>
      <div class="price-forecast-row">
        <div class="pf-item">
          <span>7-day</span>
          <strong>$${data.forecast[6].price.toLocaleString()}</strong>
        </div>
        <div class="pf-item">
          <span>14-day</span>
          <strong>$${data.forecast[13].price.toLocaleString()}</strong>
        </div>
        <div class="pf-item">
          <span>Volatility</span>
          <strong>${data.volatility}%</strong>
        </div>
      </div>
      <div class="price-recommendation ${recClass}">${data.recommendation}</div>
    </div>`;
  }).join('');
}
