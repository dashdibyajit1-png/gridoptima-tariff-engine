# SRS & Architecture Document — GridOptima Tariff & Demand Analyzer

**Version:** 1.0  
**Author:** GridOptima Engineering  
**Date:** October 2026  
**Status:** Approved

---

## 1. System Overview & Objectives

GridOptima Tariff & Demand Analyzer is an industrial electricity cost optimization tool that:

1. **Parses** piecewise utility tariff brackets to compute exact energy charges.
2. **Detects** contracted demand breaches via the Maximum Demand ratchet mechanism.
3. **Simulates** Time-of-Day (TOD) peak-to-off-peak load-shifting strategies.
4. **Sizes** Automatic Power Factor Correction (APFC) capacitor banks with THD derating.
5. **Estimates** Variable Frequency Drive (VFD) energy savings using the cubic affinity law.

The system comprises three equivalent engine implementations (C++, Java, JavaScript) and an interactive web dashboard for executive-level analytics.

---

## 2. Data Model — Star Schema

The analytical data model follows a **Star Schema** design pattern, with a central fact table connected to two dimension tables.

```
                    ┌──────────────────────┐
                    │   Dim_TariffZone     │
                    │──────────────────────│
                    │ ZoneID          (PK) │
                    │ Zone_Name            │
                    │ Peak_Start_Hour      │
                    │ Peak_End_Hour        │
                    │ Peak_Rate_INR        │
                    │ OffPeak_Rate_INR     │
                    │ Slab_1_Limit_kWh     │
                    │ Slab_1_Rate_INR      │
                    │ Slab_2_Limit_kWh     │
                    │ Slab_2_Rate_INR      │
                    │ Slab_3_Limit_kWh     │
                    │ Slab_3_Rate_INR      │
                    │ Slab_4_Rate_INR      │
                    │ Demand_Charge_kVA    │
                    │ OverDemand_Penalty   │
                    └──────────┬───────────┘
                               │
                               │ 1:N
                               │
┌──────────────────────────────┴─────────────────────────────────┐
│                        Fact_Billing                            │
│────────────────────────────────────────────────────────────────│
│ BillingID                 (PK)                                 │
│ Month                                                          │
│ ZoneID                    (FK → Dim_TariffZone)                │
│ EquipmentID               (FK → Dim_Equipment)                 │
│ Contracted_Demand_kVA                                          │
│ Recorded_MD_kVA                                                │
│ Active_Energy_kWh                                              │
│ Peak_TOD_kWh                                                   │
│ OffPeak_TOD_kWh                                                │
│ Lagging_PF                                                     │
│ THD_Percent                                                    │
│ Computed_Energy_Charge_INR                                     │
│ Computed_Demand_Charge_INR                                     │
│ Billed_Penalty_INR                                             │
│ Total_Invoice_INR                                              │
└──────────────────────────────┬─────────────────────────────────┘
                               │
                               │ 1:N
                               │
                    ┌──────────┴───────────┐
                    │   Dim_Equipment      │
                    │──────────────────────│
                    │ EquipmentID     (PK) │
                    │ Equipment_Type       │
                    │ Rated_Power_kW       │
                    │ Rated_Speed_RPM      │
                    │ Load_Type            │
                    │ VFD_Installed        │
                    │ APFC_Bank_kVAr       │
                    │ Detuned_Reactor      │
                    │ Operating_Hours_Year │
                    │ Cost_Per_Unit_INR    │
                    └──────────────────────┘
```

### 2.1 Fact_Billing

Each row represents **one month of billing** for an industrial consumer. The 12-month sample dataset (`data/sample_12month_utility_bills.csv`) populates this table with columns:

| Column | Type | Description |
|--------|------|-------------|
| `Month` | String | Three-letter month abbreviation (Jan–Dec) |
| `Contracted_Demand_kVA` | Float | Sanctioned maximum demand from utility |
| `Recorded_MD_kVA` | Float | Actual recorded maximum demand for the billing period |
| `Active_Energy_kWh` | Float | Total active energy consumption |
| `Peak_TOD_kWh` | Float | Energy consumed during peak tariff hours |
| `OffPeak_TOD_kWh` | Float | Energy consumed during off-peak hours |
| `Lagging_PF` | Float | Measured lagging power factor (0–1) |
| `THD_Percent` | Float | Total harmonic distortion as percentage |
| `Billed_Penalty_INR` | Float | Utility-assessed penalties |
| `Total_Invoice_INR` | Float | Total monthly electricity invoice |

### 2.2 Dim_TariffZone

Defines the tariff structure including:
- **Piecewise energy slabs** (4 slabs for the MSEDCL HT-I schedule)
- **TOD peak/off-peak** windows and rate differentials
- **Demand charges** and over-demand penalty rates

### 2.3 Dim_Equipment

Captures the installed motor/drive base for VFD and APFC analysis:
- Motor ratings (kW, RPM), load type (centrifugal/positive displacement)
- Existing APFC bank ratings and detuned reactor presence
- Cost parameters for ROI calculations

---

## 3. Engineering Formulas

### 3.1 Piecewise Tariff Computation

Energy charges are computed by iterating through progressive tariff slabs:

$$
C_{energy} = \sum_{i=1}^{n} \min(E_{remaining}, W_i) \times R_i
$$

Where:
- $W_i$ = width of slab $i$ (kWh)
- $R_i$ = rate for slab $i$ (₹/kWh)
- $E_{remaining}$ = unconsumed energy carried to next slab

**Configured Slabs:**

| Slab | Range (kWh) | Rate (₹/kWh) |
|------|-------------|---------------|
| 1 | 0 – 100,000 | 3.50 |
| 2 | 100,001 – 300,000 | 4.50 |
| 3 | 300,001 – 500,000 | 5.50 |
| 4 | > 500,000 | 6.50 |

### 3.2 Demand Ratchet Logic

The billing demand is determined by comparing the Recorded Maximum Demand (MD) against the Contracted Demand (CD):

```
                    ┌──────────────┐
                    │  Input: CD,  │
                    │    MD        │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │  MD > CD ?   │
                    └───┬──────┬───┘
                     Yes│      │No
                 ┌──────▼──┐   │
                 │Bill = MD│   │
                 │Penalty: │ ┌─▼────────────┐
                 │(MD-CD)× │ │ MD < 75%×CD? │
                 │₹500/kVA │ └──┬────────┬──┘
                 └─────────┘  Yes│        │No
                          ┌─────▼──┐  ┌──▼───────────┐
                          │Bill =  │  │ MD < 85%×CD? │
                          │75%×CD  │  └──┬────────┬──┘
                          └────────┘   Yes│        │No
                                   ┌─────▼──┐  ┌──▼──────┐
                                   │Bill =  │  │Bill = CD│
                                   │85%×CD  │  │(Normal) │
                                   └────────┘  └─────────┘
```

$$
D_{billed} = \begin{cases}
MD & \text{if } MD > CD \quad (\text{+ penalty}) \\
0.75 \times CD & \text{if } MD < 0.75 \times CD \\
0.85 \times CD & \text{if } 0.75 \times CD \leq MD < 0.85 \times CD \\
CD & \text{if } 0.85 \times CD \leq MD \leq CD
\end{cases}
$$

$$
P_{overdemand} = \max(0, \; MD - CD) \times 500 \; \text{₹/kVA}
$$

### 3.3 TOD Load Shifting Model

Savings from shifting a fraction $f$ of peak consumption to off-peak:

$$
S_{TOD} = f \times E_{peak} \times (R_{peak\_premium} + R_{offpeak\_discount})
$$

Where:
- $f$ = shift fraction (0–0.50)
- $E_{peak}$ = peak period energy (kWh)
- $R_{peak\_premium}$ = ₹1.50/kWh (peak surcharge)
- $R_{offpeak\_discount}$ = ₹1.00/kWh (off-peak rebate)

### 3.4 Reactive Power Compensation & APFC Sizing

#### 3.4.1 Basic kVAr Requirement

$$
Q_{kVAr} = P_{kW} \times (\tan\varphi_1 - \tan\varphi_2)
$$

Where:
- $P_{kW}$ = average active power = $E_{kWh} / t_{hours}$
- $\varphi_1 = \cos^{-1}(PF_{current})$
- $\varphi_2 = \cos^{-1}(PF_{target})$

#### 3.4.2 THD Derating

In the presence of harmonic distortion, the **true power factor** differs from the displacement power factor:

$$
PF_{distortion} = \frac{1}{\sqrt{1 + THD^2}}
$$

$$
PF_{true} = PF_{displacement} \times PF_{distortion}
$$

The APFC calculation uses $PF_{true}$ instead of the raw metered PF.

#### 3.4.3 Detuned Reactor Criteria

When $THD > 5\%$, standard capacitor banks risk **harmonic resonance**. A detuned reactor (typically 5.67% or 7% detuning factor) must be installed in series with the capacitor bank to shift the resonant frequency safely below the dominant harmonic order.

> **Rule:** If any month's THD exceeds 5%, flag **"DETUNED REACTOR REQUIRED"**.

### 3.5 VFD Affinity Law Savings

For centrifugal loads (pumps, fans, compressors), power consumption follows the **cubic affinity law**:

$$
P_2 = P_1 \times \left(\frac{N_2}{N_1}\right)^3
$$

Where:
- $P_1$ = power at rated speed (kW)
- $P_2$ = power at reduced speed (kW)
- $N_1$ = rated speed (RPM)
- $N_2$ = reduced speed (RPM)

Annual savings:

$$
S_{VFD} = (P_1 - P_2) \times t_{hours/year} \times R_{avg}
$$

**Default parameters:**
- Rated motor: 200 kW centrifugal pump
- Operating hours: 8,000 hrs/year
- Average energy rate: ₹5.00/kWh

---

## 4. Module Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    GridOptima System                         │
├──────────────┬──────────────┬───────────────────────────────┤
│  C++ Engine  │  Java Engine │  JavaScript Dashboard Engine  │
│  (CLI)       │  (CLI)       │  (Browser)                    │
├──────────────┴──────────────┴───────────────────────────────┤
│                   5 Core Modules                            │
│  ┌───────────┬──────────┬──────┬──────────┬──────────────┐  │
│  │ Tariff    │ Demand   │ TOD  │ APFC     │ VFD Savings  │  │
│  │ Brackets  │ Ratchet  │ Sim  │ Sizing   │ Estimator    │  │
│  └───────────┴──────────┴──────┴──────────┴──────────────┘  │
├─────────────────────────────────────────────────────────────┤
│                   Data Layer                                │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  CSV Parser  │  Embedded Fallback  │  File Uploader  │   │
│  └──────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────┤
│                   Presentation Layer (JS only)              │
│  ┌──────────┬──────────┬───────────────┬────────────────┐   │
│  │ KPI Cards│ Sliders  │ Chart Manager │ ROI Calculator │   │
│  └──────────┴──────────┴───────────────┴────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## 5. API / Function Signatures

### 5.1 C++ (`TariffEngine.cpp`)

```cpp
double computeEnergyCharge(double kWh);
DemandResult computeDemandRatchet(double cd, double md);
TODResult computeTODSavings(double peakKWh, double offPeakKWh, double shiftFraction);
APFCResult computeAPFC(double kW, double currentPF, double targetPF, double thdPercent);
VFDResult computeVFDSavings(double ratedPowerKW, double speedReduction);
```

### 5.2 Java (`TariffEngine.java`)

```java
static double computeEnergyCharge(double kWh);
static DemandResult computeDemandRatchet(double cd, double md);
static TODResult computeTODSavings(double peakKWh, double offPeakKWh, double shiftFraction);
static APFCResult computeAPFC(double kW, double currentPF, double targetPF, double thdPercent);
static VFDResult computeVFDSavings(double ratedPowerKW, double speedReduction);
```

### 5.3 JavaScript (`app.js`)

```javascript
function computeTariffBrackets(kWh) → number;
function computeDemandRatchet(cd, md) → {billedDemand, demandCharge, penalty, isBreach};
function computeTODSavings(peakKWh, offPeakKWh, shiftPct) → {shiftedKWh, savingsINR, ...};
function computeAPFC(kW, currentPF, targetPF, thdPct) → {kVAr, truePF, needsDetunedReactor, ...};
function computeVFDSavings(ratedPowerKW, speedReductionPct) → {savedKWh, savedINR, ...};
```

---

## 6. Dashboard Wireframe

```
┌─────────────────────────────────────────────────────────────┐
│  HEADER: GridOptima — Tariff & Demand Analyzer              │
├─────────────────────────────────────────────────────────────┤
│  [📁 CSV Upload / Drop Zone                    ] [Status]   │
├─────────────────────────────────────────────────────────────┤
│  KPI Cards:                                                 │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │ Demand   │ │ Total    │ │ APFC     │ │ VFD      │       │
│  │ Breaches │ │ Penalties│ │ kVAr     │ │ Savings  │       │
│  │ 4 / 12   │ │ ₹4.38L  │ │ 285 kVAr │ │ 98K kWh  │       │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
├─────────────────────────────────────────────────────────────┤
│  Simulation Sliders:                                        │
│  [Target PF: ═══════●══ 0.95]                               │
│  [VFD Speed: ═════●════ 15% ]                               │
│  [TOD Shift: ═══●══════ 20% ]                               │
├───────────────────────┬─────────────────────────────────────┤
│  Chart 1: Demand      │  Chart 2: PF & THD Trend            │
│  (Grouped Bar)        │  (Dual-axis Line)                   │
├───────────────────────┼─────────────────────────────────────┤
│  Chart 3: TOD Split   │  Chart 4: Cumulative Savings        │
│  (Stacked Bar)        │  (Area / Line)                      │
├───────────────────────┴─────────────────────────────────────┤
│  ROI Card:                                                  │
│  [CapEx] [Annual Savings] [Payback Period] [Net 1st Year]   │
├─────────────────────────────────────────────────────────────┤
│  FOOTER                                                     │
└─────────────────────────────────────────────────────────────┘
```

---

## 7. Compilation & Deployment

### 7.1 C++ Engine

```bash
g++ -std=c++17 -O2 -o TariffEngine src/engine/TariffEngine.cpp -lm
./TariffEngine
```

### 7.2 Java Engine

```bash
javac src/engine/TariffEngine.java
java -cp src/engine TariffEngine
```

### 7.3 Web Dashboard

**Option A — Direct file open (no server):**
```
Open index.html in any modern browser (uses embedded fallback data)
```

**Option B — Local server (enables CSV fetch):**
```bash
python3 -m http.server 8080
# Visit http://localhost:8080
```

**Option C — GitHub Pages:**
Push to a GitHub repository; enable GitHub Pages from the `main` branch root.

---

## 8. Glossary

| Term | Definition |
|------|-----------|
| **APFC** | Automatic Power Factor Correction — capacitor banks that dynamically compensate reactive power |
| **CD** | Contracted Demand — the maximum demand (kVA) sanctioned by the utility |
| **kVA** | Kilovolt-Ampere — unit of apparent power |
| **kVAr** | Kilovolt-Ampere Reactive — unit of reactive power |
| **kW** | Kilowatt — unit of active (real) power |
| **kWh** | Kilowatt-hour — unit of energy |
| **MD** | Maximum Demand — highest recorded demand during billing period |
| **PF** | Power Factor — ratio of active power to apparent power |
| **THD** | Total Harmonic Distortion — measure of waveform distortion |
| **TOD** | Time-of-Day — tariff structure with different rates for peak/off-peak |
| **VFD** | Variable Frequency Drive — motor speed controller for energy savings |
