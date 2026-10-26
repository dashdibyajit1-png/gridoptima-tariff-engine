/* ============================================================
   GridOptima Tariff & Demand Analyzer — Dashboard Application
   Pure Vanilla JS + Chart.js (CDN) — zero build dependencies
   ============================================================ */

(function () {
  'use strict';

  /* ==========================================================
     SECTION 1: CONFIGURATION & CONSTANTS
     ========================================================== */

  const CONFIG = {
    // Piecewise energy tariff slabs (Maharashtra MSEDCL HT-I inspired)
    tariffSlabs: [
      { limit: 100000, rate: 3.50 },  // 0–100,000 kWh
      { limit: 300000, rate: 4.50 },  // 100,001–300,000 kWh
      { limit: 500000, rate: 5.50 },  // 300,001–500,000 kWh
      { limit: Infinity, rate: 6.50 } // >500,000 kWh
    ],
    demandChargeRate: 250,           // INR per kVA per month
    overDemandPenaltyRate: 500,      // INR per excess kVA (2× normal)
    todPeakPremium: 1.50,            // INR/kWh above base
    todOffPeakDiscount: 1.00,        // INR/kWh below base
    pfTarget: 0.90,                  // Utility PF target (penalty threshold)
    pfPenaltyPerPoint: 0.01,         // 1% of energy bill per 0.01 below target
    operatingHoursPerMonth: 720,     // Assumed monthly operating hours
    vfdRatedPowerKW: 200,            // Reference VFD motor rated power
    vfdOperatingHoursYear: 8000,     // Annual operating hours for VFD
    weightedAvgEnergyRate: 5.00,     // INR/kWh for savings calculations
    apfcCostPerKVAr: 800,            // INR per kVAr (APFC bank installed cost)
    vfdCostPerKW: 6000,              // INR per kW (VFD drive installed cost)
    detunedReactorThreshold: 0.05    // 5% THD threshold
  };

  /* ==========================================================
     SECTION 2: EMBEDDED FALLBACK DATASET
     Works when opening index.html directly via file://
     ========================================================== */

  const FALLBACK_DATA = [
    { Month: "Jan", Contracted_Demand_kVA: 1500, Recorded_MD_kVA: 1320, Active_Energy_kWh: 520000, Peak_TOD_kWh: 208000, OffPeak_TOD_kWh: 312000, Lagging_PF: 0.91, THD_Percent: 3.8, Billed_Penalty_INR: 0, Total_Invoice_INR: 1875000 },
    { Month: "Feb", Contracted_Demand_kVA: 1500, Recorded_MD_kVA: 1280, Active_Energy_kWh: 498000, Peak_TOD_kWh: 199200, OffPeak_TOD_kWh: 298800, Lagging_PF: 0.92, THD_Percent: 3.5, Billed_Penalty_INR: 0, Total_Invoice_INR: 1795000 },
    { Month: "Mar", Contracted_Demand_kVA: 1500, Recorded_MD_kVA: 1410, Active_Energy_kWh: 565000, Peak_TOD_kWh: 232650, OffPeak_TOD_kWh: 332350, Lagging_PF: 0.89, THD_Percent: 4.2, Billed_Penalty_INR: 15200, Total_Invoice_INR: 2125000 },
    { Month: "Apr", Contracted_Demand_kVA: 1500, Recorded_MD_kVA: 1540, Active_Energy_kWh: 625000, Peak_TOD_kWh: 256250, OffPeak_TOD_kWh: 368750, Lagging_PF: 0.87, THD_Percent: 4.8, Billed_Penalty_INR: 48500, Total_Invoice_INR: 2520000 },
    { Month: "May", Contracted_Demand_kVA: 1500, Recorded_MD_kVA: 1620, Active_Energy_kWh: 710000, Peak_TOD_kWh: 298200, OffPeak_TOD_kWh: 411800, Lagging_PF: 0.84, THD_Percent: 6.2, Billed_Penalty_INR: 95800, Total_Invoice_INR: 3150000 },
    { Month: "Jun", Contracted_Demand_kVA: 1500, Recorded_MD_kVA: 1650, Active_Energy_kWh: 745000, Peak_TOD_kWh: 312900, OffPeak_TOD_kWh: 432100, Lagging_PF: 0.82, THD_Percent: 7.1, Billed_Penalty_INR: 112400, Total_Invoice_INR: 3480000 },
    { Month: "Jul", Contracted_Demand_kVA: 1500, Recorded_MD_kVA: 1580, Active_Energy_kWh: 698000, Peak_TOD_kWh: 286180, OffPeak_TOD_kWh: 411820, Lagging_PF: 0.83, THD_Percent: 8.5, Billed_Penalty_INR: 89600, Total_Invoice_INR: 3185000 },
    { Month: "Aug", Contracted_Demand_kVA: 1500, Recorded_MD_kVA: 1490, Active_Energy_kWh: 652000, Peak_TOD_kWh: 267320, OffPeak_TOD_kWh: 384680, Lagging_PF: 0.85, THD_Percent: 7.8, Billed_Penalty_INR: 54200, Total_Invoice_INR: 2870000 },
    { Month: "Sep", Contracted_Demand_kVA: 1500, Recorded_MD_kVA: 1420, Active_Energy_kWh: 590000, Peak_TOD_kWh: 241900, OffPeak_TOD_kWh: 348100, Lagging_PF: 0.88, THD_Percent: 5.5, Billed_Penalty_INR: 22800, Total_Invoice_INR: 2380000 },
    { Month: "Oct", Contracted_Demand_kVA: 1500, Recorded_MD_kVA: 1380, Active_Energy_kWh: 548000, Peak_TOD_kWh: 219200, OffPeak_TOD_kWh: 328800, Lagging_PF: 0.90, THD_Percent: 4.5, Billed_Penalty_INR: 0, Total_Invoice_INR: 2095000 },
    { Month: "Nov", Contracted_Demand_kVA: 1500, Recorded_MD_kVA: 1290, Active_Energy_kWh: 505000, Peak_TOD_kWh: 197000, OffPeak_TOD_kWh: 308000, Lagging_PF: 0.93, THD_Percent: 3.6, Billed_Penalty_INR: 0, Total_Invoice_INR: 1830000 },
    { Month: "Dec", Contracted_Demand_kVA: 1500, Recorded_MD_kVA: 1350, Active_Energy_kWh: 530000, Peak_TOD_kWh: 212000, OffPeak_TOD_kWh: 318000, Lagging_PF: 0.91, THD_Percent: 3.2, Billed_Penalty_INR: 0, Total_Invoice_INR: 1920000 }
  ];

  /* ==========================================================
     SECTION 3: DATA LAYER — CSV PARSER & LOADER
     ========================================================== */

  /**
   * Parses a CSV string into an array of objects.
   * Handles quoted fields and trims whitespace.
   */
  function parseCSV(text) {
    var lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return [];
    var headers = lines[0].split(',').map(function (h) { return h.trim(); });
    var data = [];
    for (var i = 1; i < lines.length; i++) {
      var vals = lines[i].split(',').map(function (v) { return v.trim(); });
      if (vals.length < headers.length) continue;
      var row = {};
      for (var j = 0; j < headers.length; j++) {
        var num = parseFloat(vals[j]);
        row[headers[j]] = isNaN(num) ? vals[j] : num;
      }
      data.push(row);
    }
    return data;
  }

  /**
   * Loads billing data: tries fetching CSV, falls back to embedded array.
   * Returns a Promise resolving to the data array.
   */
  function loadData() {
    return fetch('data/sample_12month_utility_bills.csv')
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.text();
      })
      .then(function (text) {
        var data = parseCSV(text);
        if (data.length === 0) throw new Error('Empty CSV');
        setDataSourceBadge('loaded');
        return data;
      })
      .catch(function () {
        console.info('GridOptima: CSV fetch failed, using embedded fallback data.');
        setDataSourceBadge('fallback');
        return FALLBACK_DATA.slice(); // return a copy
      });
  }

  /** Updates the upload zone badge to show data source */
  function setDataSourceBadge(mode) {
    var badge = document.getElementById('data-source-badge');
    if (!badge) return;
    if (mode === 'loaded') {
      badge.className = 'upload-zone__status upload-zone__status--loaded';
      badge.textContent = '✓ CSV Loaded';
    } else {
      badge.className = 'upload-zone__status upload-zone__status--fallback';
      badge.textContent = '⚡ Embedded Data';
    }
  }

  /* ==========================================================
     SECTION 4: ENGINE — TARIFF & DEMAND CALCULATIONS
     Mirrors C++/Java TariffEngine logic
     ========================================================== */

  /**
   * Module 1: Piecewise tariff bracket energy charge
   * @param {number} kWh — Total active energy consumed
   * @returns {number} Energy charge in INR
   */
  function computeTariffBrackets(kWh) {
    var charge = 0;
    var remaining = kWh;
    var prevLimit = 0;
    for (var i = 0; i < CONFIG.tariffSlabs.length; i++) {
      var slab = CONFIG.tariffSlabs[i];
      var slabWidth = slab.limit - prevLimit;
      var consumed = Math.min(remaining, slabWidth);
      charge += consumed * slab.rate;
      remaining -= consumed;
      prevLimit = slab.limit;
      if (remaining <= 0) break;
    }
    return charge;
  }

  /**
   * Module 2: Demand ratchet calculator
   * @param {number} cd — Contracted Demand (kVA)
   * @param {number} md — Recorded Maximum Demand (kVA)
   * @returns {{billedDemand: number, demandCharge: number, penalty: number, isBreach: boolean}}
   */
  function computeDemandRatchet(cd, md) {
    var billedDemand;
    var penalty = 0;
    var isBreach = false;

    if (md > cd) {
      // Over-demand: bill at actual MD + levy penalty on excess
      billedDemand = md;
      penalty = (md - cd) * CONFIG.overDemandPenaltyRate;
      isBreach = true;
    } else if (md < cd * 0.75) {
      // Below 75% of CD: minimum billing at 75%
      billedDemand = cd * 0.75;
    } else if (md < cd * 0.85) {
      // Between 75%–85%: billing at 85%
      billedDemand = cd * 0.85;
    } else {
      // 85%–100%: bill at CD (normal)
      billedDemand = cd;
    }

    var demandCharge = billedDemand * CONFIG.demandChargeRate;
    return { billedDemand: billedDemand, demandCharge: demandCharge, penalty: penalty, isBreach: isBreach };
  }

  /**
   * Module 3: TOD load-shifting savings
   * @param {number} peakKWh — Peak period consumption
   * @param {number} offPeakKWh — Off-peak period consumption
   * @param {number} shiftPct — Fraction of peak load to shift (0.0–0.5)
   * @returns {{shiftedKWh: number, savingsINR: number, newPeakKWh: number, newOffPeakKWh: number}}
   */
  function computeTODSavings(peakKWh, offPeakKWh, shiftPct) {
    var shiftedKWh = peakKWh * shiftPct;
    var newPeakKWh = peakKWh - shiftedKWh;
    var newOffPeakKWh = offPeakKWh + shiftedKWh;
    // Savings = shifted kWh × (peak premium + off-peak discount)
    var savingsINR = shiftedKWh * (CONFIG.todPeakPremium + CONFIG.todOffPeakDiscount);
    return { shiftedKWh: shiftedKWh, savingsINR: savingsINR, newPeakKWh: newPeakKWh, newOffPeakKWh: newOffPeakKWh };
  }

  /**
   * Module 4: Reactive power & APFC capacitor bank sizing
   * @param {number} kW — Average active power draw
   * @param {number} currentPF — Measured lagging power factor (displacement)
   * @param {number} targetPF — Desired power factor
   * @param {number} thdPct — Total harmonic distortion in percent
   * @returns {{kVAr: number, truePF: number, needsDetunedReactor: boolean, pfDistortion: number}}
   */
  function computeAPFC(kW, currentPF, targetPF, thdPct) {
    var thdFraction = thdPct / 100.0;
    // PF_distortion = 1 / sqrt(1 + THD^2)
    var pfDistortion = 1.0 / Math.sqrt(1 + thdFraction * thdFraction);
    // PF_true = PF_displacement × PF_distortion
    var truePF = currentPF * pfDistortion;

    // Required capacitor bank kVAr
    var phi1 = Math.acos(Math.min(truePF, 1.0));
    var phi2 = Math.acos(Math.min(targetPF, 1.0));
    var kVAr = kW * (Math.tan(phi1) - Math.tan(phi2));
    kVAr = Math.max(0, kVAr);

    var needsDetunedReactor = thdFraction > CONFIG.detunedReactorThreshold;

    return { kVAr: kVAr, truePF: truePF, needsDetunedReactor: needsDetunedReactor, pfDistortion: pfDistortion };
  }

  /**
   * Module 5: VFD cubic affinity-law energy savings
   * @param {number} ratedPowerKW — Motor rated power (kW)
   * @param {number} speedReductionPct — Speed reduction as fraction (0.0–0.3)
   * @returns {{savedKWh: number, savedINR: number, newPowerKW: number, speedRatio: number}}
   */
  function computeVFDSavings(ratedPowerKW, speedReductionPct) {
    var speedRatio = 1.0 - speedReductionPct;
    // Affinity law: P2 = P1 × (N2/N1)^3
    var newPowerKW = ratedPowerKW * Math.pow(speedRatio, 3);
    var savedPowerKW = ratedPowerKW - newPowerKW;
    var savedKWh = savedPowerKW * CONFIG.vfdOperatingHoursYear;
    var savedINR = savedKWh * CONFIG.weightedAvgEnergyRate;
    return { savedKWh: savedKWh, savedINR: savedINR, newPowerKW: newPowerKW, speedRatio: speedRatio };
  }

  /* ==========================================================
     SECTION 5: PROCESS ALL DATA — AGGREGATE ENGINE RESULTS
     ========================================================== */

  /**
   * Runs all 5 engine modules across the full dataset with given simulation parameters.
   * @param {Array} data — Array of monthly billing records
   * @param {number} targetPF — Simulation target PF (0.80–0.99)
   * @param {number} vfdSpeedReduction — Fraction (0–0.30)
   * @param {number} todShiftPct — Fraction of peak shifted (0–0.50)
   * @returns {Object} Processed results for KPI cards and charts
   */
  function processAll(data, targetPF, vfdSpeedReduction, todShiftPct) {
    var months = [];
    var cdValues = [];
    var mdValues = [];
    var pfValues = [];
    var thdValues = [];
    var peakValues = [];
    var offPeakValues = [];

    var totalPenalty = 0;
    var breachCount = 0;
    var maxOvershootPct = 0;
    var totalTODSavings = 0;
    var peakAPFCkVAr = 0;
    var anyDetunedReactor = false;
    var totalEnergyCharge = 0;

    var demandResults = [];
    var todResults = [];
    var apfcResults = [];
    var cumulativeSavingsAPFC = [];
    var cumulativeSavingsTOD = [];
    var cumulativeSavingsVFD = [];

    for (var i = 0; i < data.length; i++) {
      var row = data[i];
      months.push(row.Month);
      cdValues.push(row.Contracted_Demand_kVA);
      mdValues.push(row.Recorded_MD_kVA);
      pfValues.push(row.Lagging_PF);
      thdValues.push(row.THD_Percent);

      // Module 1: Tariff
      var energyCharge = computeTariffBrackets(row.Active_Energy_kWh);
      totalEnergyCharge += energyCharge;

      // Module 2: Demand Ratchet
      var dr = computeDemandRatchet(row.Contracted_Demand_kVA, row.Recorded_MD_kVA);
      demandResults.push(dr);
      if (dr.isBreach) {
        breachCount++;
        var overshoot = ((row.Recorded_MD_kVA - row.Contracted_Demand_kVA) / row.Contracted_Demand_kVA) * 100;
        if (overshoot > maxOvershootPct) maxOvershootPct = overshoot;
      }
      totalPenalty += dr.penalty + row.Billed_Penalty_INR;

      // Module 3: TOD Shift
      var tod = computeTODSavings(row.Peak_TOD_kWh, row.OffPeak_TOD_kWh, todShiftPct);
      todResults.push(tod);
      totalTODSavings += tod.savingsINR;
      peakValues.push(tod.newPeakKWh);
      offPeakValues.push(tod.newOffPeakKWh);

      // Module 4: APFC
      var avgKW = row.Active_Energy_kWh / CONFIG.operatingHoursPerMonth;
      var apfc = computeAPFC(avgKW, row.Lagging_PF, targetPF, row.THD_Percent);
      apfcResults.push(apfc);
      if (apfc.kVAr > peakAPFCkVAr) peakAPFCkVAr = apfc.kVAr;
      if (apfc.needsDetunedReactor) anyDetunedReactor = true;
    }

    // Module 5: VFD (annual, not per-month)
    var vfd = computeVFDSavings(CONFIG.vfdRatedPowerKW, vfdSpeedReduction);

    // Cumulative savings build (monthly pro-rata for APFC and VFD)
    var apfcMonthlySaving = (totalPenalty > 0) ? totalPenalty / 12 : 0;
    var vfdMonthlySaving = vfd.savedINR / 12;
    var runningAPFC = 0, runningTOD = 0, runningVFD = 0;
    for (var k = 0; k < data.length; k++) {
      runningAPFC += apfcMonthlySaving;
      runningTOD += todResults[k].savingsINR;
      runningVFD += vfdMonthlySaving;
      cumulativeSavingsAPFC.push(Math.round(runningAPFC));
      cumulativeSavingsTOD.push(Math.round(runningTOD));
      cumulativeSavingsVFD.push(Math.round(runningVFD));
    }

    // ROI / Payback
    var apfcCapex = peakAPFCkVAr * CONFIG.apfcCostPerKVAr;
    var vfdCapex = CONFIG.vfdRatedPowerKW * CONFIG.vfdCostPerKW;
    var totalCapex = apfcCapex + vfdCapex;
    var totalAnnualSavings = totalTODSavings + vfd.savedINR + totalPenalty; // penalties avoided = savings
    var paybackMonths = totalAnnualSavings > 0 ? (totalCapex / totalAnnualSavings) * 12 : Infinity;

    return {
      months: months,
      cdValues: cdValues,
      mdValues: mdValues,
      pfValues: pfValues,
      thdValues: thdValues,
      peakValues: peakValues,
      offPeakValues: offPeakValues,
      demandResults: demandResults,
      todResults: todResults,
      apfcResults: apfcResults,
      breachCount: breachCount,
      maxOvershootPct: maxOvershootPct,
      totalPenalty: totalPenalty,
      peakAPFCkVAr: peakAPFCkVAr,
      anyDetunedReactor: anyDetunedReactor,
      vfd: vfd,
      totalTODSavings: totalTODSavings,
      totalAnnualSavings: totalAnnualSavings,
      totalCapex: totalCapex,
      apfcCapex: apfcCapex,
      vfdCapex: vfdCapex,
      paybackMonths: paybackMonths,
      targetPF: targetPF,
      cumulativeSavingsAPFC: cumulativeSavingsAPFC,
      cumulativeSavingsTOD: cumulativeSavingsTOD,
      cumulativeSavingsVFD: cumulativeSavingsVFD
    };
  }

  /* ==========================================================
     SECTION 6: FORMATTING UTILITIES
     ========================================================== */

  /** Formats a number in Indian numbering system with ₹ prefix */
  function formatINR(value) {
    if (value == null || isNaN(value)) return '₹0';
    return '₹' + Math.round(value).toLocaleString('en-IN');
  }

  /** Formats a large number with Indian commas (no currency symbol) */
  function formatNum(value) {
    if (value == null || isNaN(value)) return '0';
    return Math.round(value).toLocaleString('en-IN');
  }

  /** Formats to 1 decimal place */
  function fmt1(value) {
    return value != null ? value.toFixed(1) : '0.0';
  }

  /* ==========================================================
     SECTION 7: KPI CARD UPDATER
     ========================================================== */

  function updateKPICards(results) {
    // Card 1: Demand Breaches
    var breachEl = document.getElementById('kpi-breach-value');
    var breachDetail = document.getElementById('kpi-breach-detail');
    if (breachEl) breachEl.textContent = results.breachCount + ' / 12';
    if (breachDetail) {
      breachDetail.textContent = results.breachCount > 0
        ? 'Max overshoot: ' + fmt1(results.maxOvershootPct) + '% above contracted kVA'
        : 'All months within contracted demand';
    }

    // Card 2: Total PF Penalties
    var penaltyEl = document.getElementById('kpi-penalty-value');
    var penaltyDetail = document.getElementById('kpi-penalty-detail');
    if (penaltyEl) penaltyEl.textContent = formatINR(results.totalPenalty);
    if (penaltyDetail) penaltyDetail.textContent = 'Demand surcharge + power factor penalties (annual)';

    // Card 3: APFC Recommendation
    var apfcEl = document.getElementById('kpi-apfc-value');
    var apfcDetail = document.getElementById('kpi-apfc-detail');
    var apfcBadge = document.getElementById('kpi-apfc-badge');
    if (apfcEl) apfcEl.textContent = fmt1(results.peakAPFCkVAr) + ' kVAr';
    if (apfcDetail) apfcDetail.textContent = 'Recommended capacitor bank rating (peak month sizing)';
    if (apfcBadge) {
      if (results.anyDetunedReactor) {
        apfcBadge.className = 'alert-badge alert-badge--warning';
        apfcBadge.textContent = '⚠ Detuned Reactor Required (THD > 5%)';
        apfcBadge.style.display = 'inline-flex';
      } else {
        apfcBadge.className = 'alert-badge alert-badge--ok';
        apfcBadge.textContent = '✓ Standard APFC Sufficient';
        apfcBadge.style.display = 'inline-flex';
      }
    }

    // Card 4: VFD Annual Savings
    var vfdEl = document.getElementById('kpi-vfd-value');
    var vfdDetail = document.getElementById('kpi-vfd-detail');
    if (vfdEl) vfdEl.textContent = formatNum(results.vfd.savedKWh) + ' kWh';
    if (vfdDetail) vfdDetail.textContent = formatINR(results.vfd.savedINR) + ' annual savings (' + CONFIG.vfdRatedPowerKW + ' kW motor)';

    // ROI Card
    var roiCapex = document.getElementById('roi-capex');
    var roiSavings = document.getElementById('roi-savings');
    var roiPayback = document.getElementById('roi-payback');
    var roiNet = document.getElementById('roi-net');
    if (roiCapex) roiCapex.textContent = formatINR(results.totalCapex);
    if (roiSavings) roiSavings.textContent = formatINR(results.totalAnnualSavings) + '/yr';
    if (roiPayback) {
      roiPayback.textContent = isFinite(results.paybackMonths)
        ? fmt1(results.paybackMonths) + ' mo'
        : '—';
    }
    if (roiNet) {
      var netFirstYear = results.totalAnnualSavings - results.totalCapex;
      roiNet.textContent = formatINR(netFirstYear);
    }
  }

  /* ==========================================================
     SECTION 8: CHART MANAGER
     ========================================================== */

  var charts = {};

  function initCharts(results) {
    var gridColor = '#e2e8f0';
    var fontColor = '#64748b';

    // Common defaults
    Chart.defaults.font.family = "'Inter', -apple-system, BlinkMacSystemFont, sans-serif";
    Chart.defaults.font.size = 12;
    Chart.defaults.color = fontColor;

    // Chart 1: Contracted vs Recorded Demand (grouped bar)
    var ctx1 = document.getElementById('chart-demand').getContext('2d');
    charts.demand = new Chart(ctx1, {
      type: 'bar',
      data: {
        labels: results.months,
        datasets: [
          {
            label: 'Contracted Demand (kVA)',
            data: results.cdValues,
            backgroundColor: '#93c5fd',
            borderColor: '#3b82f6',
            borderWidth: 1,
            borderRadius: 4
          },
          {
            label: 'Recorded Max Demand (kVA)',
            data: results.mdValues,
            backgroundColor: results.mdValues.map(function (md, i) {
              return md > results.cdValues[i] ? '#fca5a5' : '#86efac';
            }),
            borderColor: results.mdValues.map(function (md, i) {
              return md > results.cdValues[i] ? '#ef4444' : '#22c55e';
            }),
            borderWidth: 1,
            borderRadius: 4
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top' },
          tooltip: {
            callbacks: {
              label: function (ctx) { return ctx.dataset.label + ': ' + formatNum(ctx.parsed.y) + ' kVA'; }
            }
          }
        },
        scales: {
          y: {
            beginAtZero: false,
            min: 1000,
            title: { display: true, text: 'kVA' },
            grid: { color: gridColor }
          },
          x: { grid: { display: false } }
        }
      }
    });

    // Chart 2: PF & THD trend (dual-axis)
    var ctx2 = document.getElementById('chart-pf-thd').getContext('2d');
    charts.pfThd = new Chart(ctx2, {
      type: 'line',
      data: {
        labels: results.months,
        datasets: [
          {
            label: 'Power Factor',
            data: results.pfValues,
            borderColor: '#3b82f6',
            backgroundColor: 'rgba(59,130,246,0.1)',
            fill: true,
            tension: 0.3,
            pointRadius: 5,
            pointHoverRadius: 7,
            yAxisID: 'y'
          },
          {
            label: 'PF Target (' + (results.targetPF != null ? results.targetPF.toFixed(2) : '0.95') + ')',
            data: Array(results.months.length).fill(results.targetPF != null ? results.targetPF : 0.95),
            borderColor: '#ef4444',
            borderDash: [6, 4],
            pointRadius: 0,
            borderWidth: 2,
            yAxisID: 'y'
          },
          {
            label: 'THD %',
            data: results.thdValues,
            borderColor: '#f59e0b',
            backgroundColor: 'rgba(245,158,11,0.1)',
            fill: true,
            tension: 0.3,
            pointRadius: 5,
            pointHoverRadius: 7,
            yAxisID: 'y1'
          },
          {
            label: 'THD Limit (5%)',
            data: Array(12).fill(5.0),
            borderColor: '#ef4444',
            borderDash: [3, 3],
            pointRadius: 0,
            borderWidth: 1.5,
            yAxisID: 'y1'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { position: 'top' } },
        scales: {
          y: {
            position: 'left',
            title: { display: true, text: 'Power Factor' },
            min: 0.75,
            max: 1.0,
            grid: { color: gridColor }
          },
          y1: {
            position: 'right',
            title: { display: true, text: 'THD (%)' },
            min: 0,
            max: 12,
            grid: { drawOnChartArea: false }
          },
          x: { grid: { display: false } }
        }
      }
    });

    // Chart 3: TOD energy split (stacked bar)
    var ctx3 = document.getElementById('chart-tod').getContext('2d');
    charts.tod = new Chart(ctx3, {
      type: 'bar',
      data: {
        labels: results.months,
        datasets: [
          {
            label: 'Peak TOD (kWh)',
            data: results.peakValues,
            backgroundColor: '#f97316',
            borderRadius: { topLeft: 4, topRight: 4 }
          },
          {
            label: 'Off-Peak TOD (kWh)',
            data: results.offPeakValues,
            backgroundColor: '#06b6d4',
            borderRadius: { bottomLeft: 4, bottomRight: 4 }
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top' },
          tooltip: {
            callbacks: {
              label: function (ctx) { return ctx.dataset.label + ': ' + formatNum(ctx.parsed.y) + ' kWh'; }
            }
          }
        },
        scales: {
          y: {
            stacked: true,
            title: { display: true, text: 'kWh' },
            grid: { color: gridColor }
          },
          x: {
            stacked: true,
            grid: { display: false }
          }
        }
      }
    });

    // Chart 4: Cumulative savings waterfall
    var ctx4 = document.getElementById('chart-savings').getContext('2d');
    charts.savings = new Chart(ctx4, {
      type: 'line',
      data: {
        labels: results.months,
        datasets: [
          {
            label: 'APFC Savings (₹)',
            data: results.cumulativeSavingsAPFC,
            borderColor: '#3b82f6',
            backgroundColor: 'rgba(59,130,246,0.08)',
            fill: true,
            tension: 0.2,
            pointRadius: 4
          },
          {
            label: 'TOD Shift Savings (₹)',
            data: results.cumulativeSavingsTOD,
            borderColor: '#8b5cf6',
            backgroundColor: 'rgba(139,92,246,0.08)',
            fill: true,
            tension: 0.2,
            pointRadius: 4
          },
          {
            label: 'VFD Savings (₹)',
            data: results.cumulativeSavingsVFD,
            borderColor: '#22c55e',
            backgroundColor: 'rgba(34,197,94,0.08)',
            fill: true,
            tension: 0.2,
            pointRadius: 4
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top' },
          tooltip: {
            callbacks: {
              label: function (ctx) { return ctx.dataset.label + ': ' + formatINR(ctx.parsed.y); }
            }
          }
        },
        scales: {
          y: {
            title: { display: true, text: 'Cumulative Savings (₹)' },
            grid: { color: gridColor }
          },
          x: { grid: { display: false } }
        }
      }
    });
  }

  /** Updates existing charts with new processed data */
  function updateCharts(results) {
    // Chart 1: Demand
    charts.demand.data.datasets[1].data = results.mdValues;
    charts.demand.data.datasets[1].backgroundColor = results.mdValues.map(function (md, i) {
      return md > results.cdValues[i] ? '#fca5a5' : '#86efac';
    });
    charts.demand.data.datasets[1].borderColor = results.mdValues.map(function (md, i) {
      return md > results.cdValues[i] ? '#ef4444' : '#22c55e';
    });
    charts.demand.update('none');

    // Chart 2: PF & THD (dynamically update Target PF reference line)
    if (results.targetPF != null) {
      charts.pfThd.data.datasets[1].label = 'PF Target (' + results.targetPF.toFixed(2) + ')';
      charts.pfThd.data.datasets[1].data = Array(results.months.length).fill(results.targetPF);
    }
    charts.pfThd.update('none');

    // Chart 3: TOD
    charts.tod.data.datasets[0].data = results.peakValues;
    charts.tod.data.datasets[1].data = results.offPeakValues;
    charts.tod.update('none');

    // Chart 4: Cumulative Savings
    charts.savings.data.datasets[0].data = results.cumulativeSavingsAPFC;
    charts.savings.data.datasets[1].data = results.cumulativeSavingsTOD;
    charts.savings.data.datasets[2].data = results.cumulativeSavingsVFD;
    charts.savings.update('none');
  }

  /* ==========================================================
     SECTION 9: SIMULATION CONTROLLER
     ========================================================== */

  var currentData = null;

  function readSliders() {
    var pfSlider = document.getElementById('slider-pf');
    var vfdSlider = document.getElementById('slider-vfd');
    var todSlider = document.getElementById('slider-tod');
    return {
      targetPF: pfSlider ? parseFloat(pfSlider.value) : 0.95,
      vfdSpeedReduction: vfdSlider ? parseFloat(vfdSlider.value) / 100 : 0.15,
      todShiftPct: todSlider ? parseFloat(todSlider.value) / 100 : 0.20
    };
  }

  function updateSliderBadges() {
    var pfSlider = document.getElementById('slider-pf');
    var vfdSlider = document.getElementById('slider-vfd');
    var todSlider = document.getElementById('slider-tod');

    var pfBadge = document.getElementById('badge-pf');
    var vfdBadge = document.getElementById('badge-vfd');
    var todBadge = document.getElementById('badge-tod');

    if (pfSlider && pfBadge) pfBadge.textContent = parseFloat(pfSlider.value).toFixed(2);
    if (vfdSlider && vfdBadge) vfdBadge.textContent = vfdSlider.value + '%';
    if (todSlider && todBadge) todBadge.textContent = todSlider.value + '%';
  }

  function onSimulationChange() {
    if (!currentData) return;
    var params = readSliders();
    updateSliderBadges();
    var results = processAll(currentData, params.targetPF, params.vfdSpeedReduction, params.todShiftPct);
    updateKPICards(results);
    updateCharts(results);
  }

  function bindSliders() {
    var sliders = ['slider-pf', 'slider-vfd', 'slider-tod'];
    for (var i = 0; i < sliders.length; i++) {
      var el = document.getElementById(sliders[i]);
      if (el) {
        el.addEventListener('input', onSimulationChange);
      }
    }
  }

  /* ==========================================================
     SECTION 10: CSV UPLOAD HANDLER
     ========================================================== */

  function bindUpload() {
    var zone = document.getElementById('upload-zone');
    var input = document.getElementById('csv-input');
    if (!zone || !input) return;

    zone.addEventListener('click', function () { input.click(); });

    zone.addEventListener('dragover', function (e) {
      e.preventDefault();
      zone.classList.add('dragover');
    });

    zone.addEventListener('dragleave', function () {
      zone.classList.remove('dragover');
    });

    zone.addEventListener('drop', function (e) {
      e.preventDefault();
      zone.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) {
        handleFile(e.dataTransfer.files[0]);
      }
    });

    input.addEventListener('change', function () {
      if (input.files.length > 0) {
        handleFile(input.files[0]);
      }
    });
  }

  function handleFile(file) {
    if (!file.name.endsWith('.csv')) {
      alert('Please upload a .csv file');
      return;
    }
    var reader = new FileReader();
    reader.onload = function (e) {
      var data = parseCSV(e.target.result);
      if (data.length > 0) {
        currentData = data;
        setDataSourceBadge('loaded');
        var params = readSliders();
        var results = processAll(currentData, params.targetPF, params.vfdSpeedReduction, params.todShiftPct);
        updateKPICards(results);
        updateCharts(results);
      } else {
        alert('CSV appears empty or malformed. Check format.');
      }
    };
    reader.readAsText(file);
  }

  /* ==========================================================
     SECTION 11: INITIALIZATION
     ========================================================== */

  document.addEventListener('DOMContentLoaded', function () {
    loadData().then(function (data) {
      currentData = data;

      // Initial processing with default slider values
      var params = readSliders();
      updateSliderBadges();
      var results = processAll(data, params.targetPF, params.vfdSpeedReduction, params.todShiftPct);

      // Render
      initCharts(results);
      updateKPICards(results);
      bindSliders();
      bindUpload();

      console.info('GridOptima Tariff & Demand Analyzer initialized with ' + data.length + ' months of data.');
    });
  });

})();
