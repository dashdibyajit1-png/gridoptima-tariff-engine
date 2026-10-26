# ⚡ GridOptima — Tariff & Demand Analyzer

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![GitHub Pages](https://img.shields.io/badge/demo-live-brightgreen.svg)](#live-demo)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-zero-orange.svg)](#)

> Industrial electricity cost optimization engine with interactive analytics dashboard.  
> Analyzes 12 months of utility billing data to identify demand breaches, power factor penalties,  
> and quantify savings from APFC capacitor banks, VFD motor drives, and TOD load-shifting strategies.

---

## 🚀 Live Demo

Open `index.html` directly in any modern browser — no server required.  
For full CSV loading: `python3 -m http.server 8080` → visit `http://localhost:8080`

---

## ✨ Features

| Module | Description |
|--------|-------------|
| **Piecewise Tariff Parser** | 4-slab progressive energy charge computation (MSEDCL HT-I inspired) |
| **Demand Ratchet Calculator** | Contracted vs. Recorded Max Demand with 75%–85% billing floors and over-demand penalty |
| **TOD Load Shifting** | Simulate moving peak consumption to off-peak hours with instant savings projection |
| **APFC Capacitor Sizing** | Reactive power compensation with THD derating and detuned reactor alert |
| **VFD Energy Savings** | Cubic affinity law estimator for centrifugal pump/fan motor speed reduction |

---

## 📁 Repository Structure

```
gridoptima-tariff-engine/
├── index.html                          # Dashboard entry (GitHub Pages root)
├── styles.css                          # Executive-grade responsive styling
├── app.js                              # All engine logic + Chart.js wiring
├── README.md                           # This file
├── data/
│   └── sample_12month_utility_bills.csv  # 12-month industrial billing dataset
├── src/engine/
│   ├── TariffEngine.cpp                # Standalone C++17 implementation
│   └── TariffEngine.java              # Standalone Java implementation
└── docs/
    └── SRS_Architecture.md             # Star schema, formulas, architecture
```

**Zero dependencies** — no npm, no node_modules, no build step. Chart.js is loaded via CDN.

---

## 📐 Engineering Formulas

### Piecewise Tariff
$$C_{energy} = \sum_{i=1}^{n} \min(E_{remaining},\, W_i) \times R_i$$

### Demand Ratchet

| Condition | Billed Demand | Penalty |
|-----------|---------------|---------|
| MD > CD | MD | (MD − CD) × ₹500/kVA |
| MD < 75% × CD | 75% × CD | None |
| 75% ≤ MD < 85% × CD | 85% × CD | None |
| 85% ≤ MD ≤ CD | CD | None |

### Reactive Power & APFC Sizing
$$Q_{kVAr} = P_{kW} \times (\tan\varphi_1 - \tan\varphi_2)$$

**THD Derating:**
$$PF_{true} = PF_{displacement} \times \frac{1}{\sqrt{1 + THD^2}}$$

> ⚠️ **Detuned reactor required when THD > 5%** to prevent harmonic resonance with capacitor banks.

### VFD Cubic Affinity Law
$$P_2 = P_1 \times \left(\frac{N_2}{N_1}\right)^3$$

Annual savings: $(P_1 - P_2) \times t_{hours} \times R_{avg}$

---

## 📊 Data Schema

The billing dataset follows a **Star Schema** design:

- **`Fact_Billing`** — 12 monthly billing records (the CSV)
- **`Dim_TariffZone`** — Tariff slab rates, TOD windows, demand charges
- **`Dim_Equipment`** — Motor ratings, VFD/APFC specifications

Full schema documentation: [`docs/SRS_Architecture.md`](docs/SRS_Architecture.md)

---

## 🔧 Building the Engines

### C++

```bash
g++ -std=c++17 -O2 -o TariffEngine src/engine/TariffEngine.cpp -lm
./TariffEngine
```

### Java

```bash
javac src/engine/TariffEngine.java
java -cp src/engine TariffEngine
```

Both engines read `data/sample_12month_utility_bills.csv` and print a tabular analysis to stdout.

---

## 🖥️ Running the Dashboard

### Option A: Direct File Open (simplest)

Double-click `index.html` — the dashboard uses an **embedded fallback dataset** so it works perfectly via `file://` protocol without any server.

### Option B: Local Development Server

```bash
python3 -m http.server 8080
# or
npx serve .
```

Visit `http://localhost:8080` — this enables CSV file loading via `fetch()`.

### Option C: GitHub Pages

1. Push the repository to GitHub
2. Go to Settings → Pages → Source: `main` branch, root `/`
3. Access at `https://<username>.github.io/gridoptima-tariff-engine/`

### Dashboard Features

- **4 KPI Cards** — Demand breaches, PF penalties, APFC recommendation, VFD savings
- **3 Interactive Sliders** — Target PF (0.80–0.99), VFD speed reduction (0–30%), TOD shift (0–50%)
- **4 Chart.js Graphs** — Demand bar chart, PF/THD dual-axis trend, TOD stacked bar, cumulative savings
- **ROI Calculator** — Real-time payback period in months based on slider values
- **CSV Upload** — Drag-and-drop custom billing data

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.
