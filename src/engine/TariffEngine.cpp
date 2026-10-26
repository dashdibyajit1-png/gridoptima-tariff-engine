// ============================================================================
// GridOptima Tariff Engine — Standalone C++17 Utility Bill Analysis Tool
// ============================================================================
//
// Compile:
//   g++ -std=c++17 -O2 -o TariffEngine src/engine/TariffEngine.cpp -lm
//
// Usage:
//   ./TariffEngine
//   Reads: data/sample_12month_utility_bills.csv  (relative to CWD)
//
// Description:
//   Reads 12 months of HT (High-Tension) industrial utility billing data and
//   performs five engineering analysis modules:
//
//     1. Piecewise Tariff Bracket Parser   — energy charge by slab
//     2. Demand Ratchet Calculator          — billing demand & over-demand penalty
//     3. TOD Load-Shift Simulator           — peak-to-off-peak savings estimate
//     4. Reactive Power & APFC Sizing       — capacitor bank kVAr with THD derating
//     5. VFD Affinity-Law Savings Estimator — centrifugal pump speed-reduction ROI
//
// CSV Header (12 data rows expected):
//   Month, Contracted_Demand_kVA, Recorded_MD_kVA, Active_Energy_kWh,
//   Peak_TOD_kWh, OffPeak_TOD_kWh, Lagging_PF, THD_Percent,
//   Billed_Penalty_INR, Total_Invoice_INR
//
// Author : GridOptima Analytics Team
// License: MIT
// ============================================================================

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

// ============================================================================
// Section 0 — Constants & Data Structures
// ============================================================================

// --- Tariff slab schedule (Module 1) ----------------------------------------
// Indian industrial HT tariff typically uses telescopic / piecewise brackets.
// Each slab defines an upper bound (kWh) and the rate (INR/kWh) applicable
// within that slab.  The last slab has an effectively infinite upper bound.
struct TariffSlab {
    double upperBound_kWh;  // Cumulative upper limit of this slab
    double rate_INR;        // Rate applied to units falling within this slab
};

static const std::vector<TariffSlab> TARIFF_SLABS = {
    {100'000.0,                   3.50},  // 0       – 100,000 kWh
    {300'000.0,                   4.50},  // 100,001 – 300,000 kWh
    {500'000.0,                   5.50},  // 300,001 – 500,000 kWh
    {1e15,                        6.50},  // >500,000 kWh  (practically infinite)
};

// --- Demand ratchet parameters (Module 2) -----------------------------------
// Many state electricity regulatory commissions enforce a "ratchet" so that
// consumers cannot significantly under-utilise contracted capacity while
// reserving grid headroom.
static constexpr double DEMAND_CHARGE_RATE       = 250.0;   // INR per kVA per month
static constexpr double MIN_BILLING_THRESHOLD    = 0.75;    // 75% of CD
static constexpr double MID_BILLING_THRESHOLD    = 0.85;    // 85% of CD
static constexpr double OVER_DEMAND_PENALTY_RATE = 500.0;   // INR per excess kVA

// --- TOD parameters (Module 3) ----------------------------------------------
// Time-of-Day metering incentivises consumers to shift load away from system
// peak hours.  The premium and discount are applied on top of the base slab
// rate (we use a weighted average base for simplicity).
static constexpr double PEAK_PREMIUM_INR   = 1.50;  // Additional charge during peak
static constexpr double OFFPEAK_DISCOUNT_INR = 1.00; // Rebate during off-peak
static constexpr double SHIFT_FRACTION     = 0.20;   // Simulate shifting 20% peak→off-peak

// --- Reactive power / APFC parameters (Module 4) ----------------------------
// Industrial plants with lagging power factor draw excess reactive current,
// increasing line losses.  APFC (Automatic Power Factor Correction) panels
// inject leading kVAr to compensate.  High harmonic distortion (THD) from
// VFDs, UPS, and arc furnaces requires detuned reactors to prevent capacitor
// resonance and premature failure.
static constexpr double OPERATING_HOURS_PER_MONTH = 720.0;   // ~30 days × 24 h
static constexpr double TARGET_PF                 = 0.95;    // Utility-mandated target
static constexpr double THD_DETUNED_THRESHOLD     = 5.0;     // % THD above which detuning is needed

// --- VFD cubic affinity law parameters (Module 5) ---------------------------
// For centrifugal loads (pumps, fans, blowers) the power drawn varies with the
// cube of the shaft speed ratio.  A VFD (Variable Frequency Drive) that
// reduces speed by even 15% can cut energy consumption dramatically.
static constexpr double VFD_MOTOR_RATED_kW    = 200.0;  // Rated motor power
static constexpr double VFD_SPEED_RATIO       = 0.85;   // N2/N1 = 85% speed
static constexpr double VFD_OPERATING_HOURS   = 8000.0;  // Hours per year
static constexpr double VFD_ENERGY_RATE_INR   = 5.00;   // Weighted avg tariff

// --- CSV-row data structure -------------------------------------------------
struct MonthlyRecord {
    std::string month;
    double contractedDemand_kVA;
    double recordedMD_kVA;
    double activeEnergy_kWh;
    double peakTOD_kWh;
    double offPeakTOD_kWh;
    double laggingPF;
    double thdPercent;
    double billedPenalty_INR;
    double totalInvoice_INR;
};

// ============================================================================
// Section 1 — CSV Parsing Utility
// ============================================================================

/// Trim leading and trailing whitespace/CR from a string (handles Windows CRLF).
static std::string trim(const std::string& s) {
    const char* ws = " \t\r\n";
    size_t start = s.find_first_not_of(ws);
    if (start == std::string::npos) return "";
    size_t end = s.find_last_not_of(ws);
    return s.substr(start, end - start + 1);
}

/// Parse a single CSV line into a MonthlyRecord.
/// Expects exactly 10 comma-separated fields per the header spec.
static bool parseCSVLine(const std::string& line, MonthlyRecord& rec) {
    std::istringstream ss(line);
    std::string token;
    std::vector<std::string> fields;

    while (std::getline(ss, token, ',')) {
        fields.push_back(trim(token));
    }

    if (fields.size() < 10) return false;

    rec.month                = fields[0];
    rec.contractedDemand_kVA = std::stod(fields[1]);
    rec.recordedMD_kVA       = std::stod(fields[2]);
    rec.activeEnergy_kWh     = std::stod(fields[3]);
    rec.peakTOD_kWh          = std::stod(fields[4]);
    rec.offPeakTOD_kWh       = std::stod(fields[5]);
    rec.laggingPF            = std::stod(fields[6]);
    rec.thdPercent           = std::stod(fields[7]);
    rec.billedPenalty_INR    = std::stod(fields[8]);
    rec.totalInvoice_INR     = std::stod(fields[9]);

    return true;
}

/// Read the entire CSV file and return a vector of MonthlyRecords.
/// Skips the header row.
static std::vector<MonthlyRecord> loadCSV(const std::string& path) {
    std::vector<MonthlyRecord> records;
    std::ifstream file(path);
    if (!file.is_open()) {
        std::cerr << "[ERROR] Cannot open CSV file: " << path << "\n";
        return records;
    }

    std::string line;
    // Skip header row
    if (!std::getline(file, line)) {
        std::cerr << "[ERROR] CSV file is empty: " << path << "\n";
        return records;
    }

    int lineNum = 1;
    while (std::getline(file, line)) {
        ++lineNum;
        if (trim(line).empty()) continue;  // Skip blank lines

        MonthlyRecord rec;
        if (parseCSVLine(line, rec)) {
            records.push_back(rec);
        } else {
            std::cerr << "[WARN] Malformed CSV line " << lineNum
                      << ", skipping: " << line << "\n";
        }
    }
    return records;
}

// ============================================================================
// Section 2 — Formatting Helpers
// ============================================================================

/// Print a horizontal separator line of a given width.
static void printSeparator(int width = 100) {
    std::cout << std::string(width, '=') << "\n";
}

static void printThinSeparator(int width = 100) {
    std::cout << std::string(width, '-') << "\n";
}

// ============================================================================
// Module 1 — Piecewise Tariff Bracket Parser
// ============================================================================
//
// Industrial tariffs in India are typically telescopic: the first N kWh are
// charged at a lower rate, the next M kWh at a higher rate, and so on.
// This function walks through the defined slab schedule and accumulates the
// energy charge for a given month's consumption.
//
// Example:
//   If a consumer uses 250,000 kWh in a month:
//     First 100,000 kWh  × ₹3.50 = ₹3,50,000
//     Next  150,000 kWh  × ₹4.50 = ₹6,75,000
//     Total energy charge          = ₹10,25,000
// ============================================================================

/// Compute the piecewise energy charge for a given consumption (kWh).
static double computeEnergyCharge(double consumption_kWh) {
    double remaining = consumption_kWh;
    double charge    = 0.0;
    double prevUpper = 0.0;

    for (const auto& slab : TARIFF_SLABS) {
        if (remaining <= 0.0) break;

        // Width of this slab bracket
        double slabWidth = slab.upperBound_kWh - prevUpper;

        // Units consumed within this slab
        double unitsInSlab = std::min(remaining, slabWidth);

        charge    += unitsInSlab * slab.rate_INR;
        remaining -= unitsInSlab;
        prevUpper  = slab.upperBound_kWh;
    }

    return charge;
}

/// Determine which slab the last kWh falls into (for TOD base-rate reference).
static double getBaseRate(double consumption_kWh) {
    double prevUpper = 0.0;
    double rate      = TARIFF_SLABS.front().rate_INR;

    for (const auto& slab : TARIFF_SLABS) {
        if (consumption_kWh <= slab.upperBound_kWh) {
            rate = slab.rate_INR;
            break;
        }
        prevUpper = slab.upperBound_kWh;
        rate      = slab.rate_INR;
    }
    return rate;
}

static void runModule1(const std::vector<MonthlyRecord>& data) {
    printSeparator();
    std::cout << "  MODULE 1: Piecewise Tariff Bracket Parser — Energy Charge Computation\n";
    printSeparator();
    std::cout << std::left  << std::setw(12) << "Month"
              << std::right << std::setw(18) << "Consumption(kWh)"
              << std::setw(22) << "Energy Charge(INR)"
              << std::setw(18) << "Eff. Rate(INR)"
              << "\n";
    printThinSeparator();

    double totalConsumption = 0.0;
    double totalCharge      = 0.0;

    for (const auto& rec : data) {
        double charge = computeEnergyCharge(rec.activeEnergy_kWh);
        double effRate = (rec.activeEnergy_kWh > 0.0)
                             ? (charge / rec.activeEnergy_kWh)
                             : 0.0;
        totalConsumption += rec.activeEnergy_kWh;
        totalCharge      += charge;

        std::cout << std::left  << std::setw(12) << rec.month
                  << std::right << std::setw(18) << std::fixed << std::setprecision(0) << rec.activeEnergy_kWh
                  << std::setw(22) << std::setprecision(2) << charge
                  << std::setw(18) << std::setprecision(4) << effRate
                  << "\n";
    }

    printThinSeparator();
    double avgEffRate = (totalConsumption > 0.0) ? (totalCharge / totalConsumption) : 0.0;
    std::cout << std::left  << std::setw(12) << "ANNUAL"
              << std::right << std::setw(18) << std::setprecision(0) << totalConsumption
              << std::setw(22) << std::setprecision(2) << totalCharge
              << std::setw(18) << std::setprecision(4) << avgEffRate
              << "\n\n";
}

// ============================================================================
// Module 2 — Demand Ratchet Calculator
// ============================================================================
//
// Electricity boards allocate transformer and feeder capacity based on
// Contracted Demand (CD).  The demand ratchet mechanism ensures consumers pay
// a minimum demand charge even if actual usage (Recorded Maximum Demand, MD)
// falls below the contracted level.
//
// Billing demand rules:
//   • If MD < 75% of CD  → Billing demand = 75% of CD  (floor)
//   • If 75% ≤ MD < 85%  → Billing demand = 85% of CD  (intermediate step)
//   • If 85% ≤ MD ≤ CD   → Billing demand = MD          (normal)
//   • If MD > CD          → Billing demand = MD  + over-demand penalty
//
// Over-demand penalty = (MD − CD) × ₹500/kVA  (punitive surcharge)
// ============================================================================

struct DemandResult {
    double billingDemand_kVA;
    double demandCharge_INR;
    double overDemandPenalty_INR;
    std::string ratchetCategory;
};

static DemandResult computeDemandCharges(double cd, double md) {
    DemandResult res{};

    double ratio = md / cd;

    if (ratio < MIN_BILLING_THRESHOLD) {
        // MD is well below contracted — consumer pays for at least 75% of CD
        res.billingDemand_kVA = MIN_BILLING_THRESHOLD * cd;
        res.ratchetCategory   = "<75% CD (Floor)";
    } else if (ratio < MID_BILLING_THRESHOLD) {
        // MD is between 75% and 85% — bumped up to 85% of CD
        res.billingDemand_kVA = MID_BILLING_THRESHOLD * cd;
        res.ratchetCategory   = "75-85% CD (Step)";
    } else if (ratio <= 1.0) {
        // Normal operation: billed at Contracted Demand
        res.billingDemand_kVA = cd;
        res.ratchetCategory   = "85-100% CD (Normal)";
    } else {
        // Over-demand: penalised for exceeding contracted capacity
        res.billingDemand_kVA     = md;
        res.overDemandPenalty_INR = (md - cd) * OVER_DEMAND_PENALTY_RATE;
        res.ratchetCategory       = ">100% CD (PENALTY)";
    }

    res.demandCharge_INR = res.billingDemand_kVA * DEMAND_CHARGE_RATE;

    return res;
}

static void runModule2(const std::vector<MonthlyRecord>& data) {
    printSeparator();
    std::cout << "  MODULE 2: Demand Ratchet Calculator — Billing Demand & Penalties\n";
    printSeparator();
    std::cout << std::left  << std::setw(10) << "Month"
              << std::right << std::setw(10) << "CD(kVA)"
              << std::setw(10) << "MD(kVA)"
              << std::setw(14) << "Bill.D(kVA)"
              << std::setw(18) << "Demand(INR)"
              << std::setw(18) << "Penalty(INR)"
              << std::left   << "  " << "Category"
              << "\n";
    printThinSeparator();

    double totalDemandCharge = 0.0;
    double totalPenalty      = 0.0;

    for (const auto& rec : data) {
        auto res = computeDemandCharges(rec.contractedDemand_kVA, rec.recordedMD_kVA);
        totalDemandCharge += res.demandCharge_INR;
        totalPenalty      += res.overDemandPenalty_INR;

        std::cout << std::left  << std::setw(10) << rec.month
                  << std::right << std::setw(10) << std::fixed << std::setprecision(0) << rec.contractedDemand_kVA
                  << std::setw(10) << rec.recordedMD_kVA
                  << std::setw(14) << std::setprecision(1) << res.billingDemand_kVA
                  << std::setw(18) << std::setprecision(2) << res.demandCharge_INR
                  << std::setw(18) << res.overDemandPenalty_INR
                  << "  " << res.ratchetCategory
                  << "\n";
    }

    printThinSeparator();
    std::cout << std::left  << std::setw(10) << "ANNUAL"
              << std::right << std::setw(10) << ""
              << std::setw(10) << ""
              << std::setw(14) << ""
              << std::setw(18) << std::setprecision(2) << totalDemandCharge
              << std::setw(18) << totalPenalty
              << "\n\n";
}

// ============================================================================
// Module 3 — TOD Peak-to-Off-Peak Load Shift Simulator
// ============================================================================
//
// Time-of-Day (TOD) metering divides the day into peak and off-peak windows.
// During peak hours, a premium is added to the base energy rate; during
// off-peak hours, a discount is applied.  By shifting flexible loads (e.g.,
// ice storage, EV charging, batch processing) from peak to off-peak, a
// consumer can reduce their blended energy cost.
//
// This module simulates shifting 20% of peak-period consumption to off-peak
// and calculates the resulting monthly and annual savings.
// ============================================================================

struct TODResult {
    double currentPeakCost;
    double currentOffPeakCost;
    double shiftedPeakCost;
    double shiftedOffPeakCost;
    double monthlySavings;
};

static TODResult computeTODSavings(double peakKWh, double offPeakKWh, double baseRate) {
    TODResult r{};

    double peakRate    = baseRate + PEAK_PREMIUM_INR;
    double offPeakRate = baseRate - OFFPEAK_DISCOUNT_INR;

    // Current costs
    r.currentPeakCost    = peakKWh    * peakRate;
    r.currentOffPeakCost = offPeakKWh * offPeakRate;

    // After shifting 20% of peak load to off-peak
    double shiftedKWh    = peakKWh * SHIFT_FRACTION;
    double newPeakKWh    = peakKWh    - shiftedKWh;
    double newOffPeakKWh = offPeakKWh + shiftedKWh;

    r.shiftedPeakCost    = newPeakKWh    * peakRate;
    r.shiftedOffPeakCost = newOffPeakKWh * offPeakRate;

    // Savings = (old total) − (new total)
    double oldTotal = r.currentPeakCost + r.currentOffPeakCost;
    double newTotal = r.shiftedPeakCost + r.shiftedOffPeakCost;
    r.monthlySavings = oldTotal - newTotal;

    return r;
}

static void runModule3(const std::vector<MonthlyRecord>& data) {
    printSeparator();
    std::cout << "  MODULE 3: TOD Peak-to-Off-Peak Load Shift Simulator (20% Shift)\n";
    printSeparator();
    std::cout << std::left  << std::setw(10) << "Month"
              << std::right << std::setw(14) << "Peak(kWh)"
              << std::setw(14) << "OffPk(kWh)"
              << std::setw(14) << "BaseRate"
              << std::setw(18) << "Before(INR)"
              << std::setw(18) << "After(INR)"
              << std::setw(16) << "Savings(INR)"
              << "\n";
    printThinSeparator();

    double totalSavings = 0.0;

    for (const auto& rec : data) {
        double baseRate = getBaseRate(rec.activeEnergy_kWh);
        auto   r        = computeTODSavings(rec.peakTOD_kWh, rec.offPeakTOD_kWh, baseRate);
        totalSavings   += r.monthlySavings;

        double before = r.currentPeakCost + r.currentOffPeakCost;
        double after  = r.shiftedPeakCost + r.shiftedOffPeakCost;

        std::cout << std::left  << std::setw(10) << rec.month
                  << std::right << std::setw(14) << std::fixed << std::setprecision(0) << rec.peakTOD_kWh
                  << std::setw(14) << rec.offPeakTOD_kWh
                  << std::setw(14) << std::setprecision(2) << baseRate
                  << std::setw(18) << std::setprecision(2) << before
                  << std::setw(18) << after
                  << std::setw(16) << r.monthlySavings
                  << "\n";
    }

    printThinSeparator();
    std::cout << std::left  << std::setw(10) << "ANNUAL"
              << std::right << std::setw(14) << ""
              << std::setw(14) << ""
              << std::setw(14) << ""
              << std::setw(18) << ""
              << std::setw(18) << ""
              << std::setw(16) << std::setprecision(2) << totalSavings
              << "\n\n";
}

// ============================================================================
// Module 4 — Reactive Power & APFC Capacitor Bank Sizing
// ============================================================================
//
// When a load draws current that lags behind the voltage (inductive loads
// such as motors, transformers), the apparent power (kVA) exceeds the useful
// active power (kW).  The difference is reactive power (kVAr).  Poor power
// factor increases losses in the distribution network and attracts utility
// penalties.
//
// An APFC (Automatic Power Factor Correction) panel injects leading kVAr via
// switched capacitor banks to bring the net power factor closer to unity.
//
// Key formulae:
//   kW   = Active_Energy_kWh / operating_hours
//   φ₁   = acos(current_PF)       — present phase angle
//   φ₂   = acos(target_PF)        — desired phase angle
//   kVAr = kW × (tan(φ₁) − tan(φ₂))
//
// THD Derating:
//   True PF  = PF_displacement × PF_distortion
//   PF_distortion = 1 / sqrt(1 + THD²)
//   When THD > 5%, detuned reactors (typically 7% or 14% tuning) must be
//   installed in series with the capacitors to prevent harmonic resonance.
//
// The sizing recommendation is based on the peak-month values.
// ============================================================================

struct APFCResult {
    double kW;
    double phi1_rad;
    double phi2_rad;
    double kVAr_required;
    double truePF;
    double pfDistortion;
    bool   detunedRequired;
};

static APFCResult computeAPFC(double energyKWh, double laggingPF, double thdPercent) {
    APFCResult r{};

    // Average load in kW over the month
    r.kW = energyKWh / OPERATING_HOURS_PER_MONTH;

    // THD derating: convert percentage to fraction, compute distortion PF
    double thdFraction = thdPercent / 100.0;
    r.pfDistortion     = 1.0 / std::sqrt(1.0 + thdFraction * thdFraction);

    // True (total) power factor accounts for both displacement and distortion
    r.truePF = laggingPF * r.pfDistortion;

    // Phase angles: use the TRUE (derated) PF for φ₁
    // Clamp to valid acos domain [0, 1]
    double clampedTruePF   = std::min(std::max(r.truePF, 0.0), 1.0);
    double clampedTargetPF = std::min(std::max(TARGET_PF, 0.0), 1.0);

    r.phi1_rad = std::acos(clampedTruePF);
    r.phi2_rad = std::acos(clampedTargetPF);

    // Required capacitor kVAr to move from φ₁ to φ₂
    r.kVAr_required = r.kW * (std::tan(r.phi1_rad) - std::tan(r.phi2_rad));
    if (r.kVAr_required < 0.0) r.kVAr_required = 0.0;  // Already at or above target

    // Flag detuned reactor requirement
    r.detunedRequired = (thdPercent > THD_DETUNED_THRESHOLD);

    return r;
}

static void runModule4(const std::vector<MonthlyRecord>& data) {
    printSeparator();
    std::cout << "  MODULE 4: Reactive Power & APFC Capacitor Bank Sizing\n";
    printSeparator();
    std::cout << std::left  << std::setw(10) << "Month"
              << std::right << std::setw(10) << "kW(avg)"
              << std::setw(10) << "Disp.PF"
              << std::setw(10) << "THD(%)"
              << std::setw(12) << "Dist.PF"
              << std::setw(12) << "True PF"
              << std::setw(14) << "kVAr Req."
              << std::left   << "  " << "Notes"
              << "\n";
    printThinSeparator();

    // Track the peak-month for sizing recommendation
    double peakKVAr     = 0.0;
    std::string peakMonth;
    APFCResult peakResult{};
    bool anyDetuned = false;

    for (const auto& rec : data) {
        auto r = computeAPFC(rec.activeEnergy_kWh, rec.laggingPF, rec.thdPercent);

        std::string notes;
        if (r.detunedRequired) {
            notes = "DETUNED REACTOR REQUIRED";
            anyDetuned = true;
        }

        // Track peak month (highest kVAr requirement for capacitor sizing)
        if (r.kVAr_required > peakKVAr) {
            peakKVAr   = r.kVAr_required;
            peakMonth  = rec.month;
            peakResult = r;
        }

        std::cout << std::left  << std::setw(10) << rec.month
                  << std::right << std::setw(10) << std::fixed << std::setprecision(1) << r.kW
                  << std::setw(10) << std::setprecision(3) << rec.laggingPF
                  << std::setw(10) << std::setprecision(2) << rec.thdPercent
                  << std::setw(12) << std::setprecision(4) << r.pfDistortion
                  << std::setw(12) << std::setprecision(4) << r.truePF
                  << std::setw(14) << std::setprecision(1) << r.kVAr_required
                  << "  " << notes
                  << "\n";
    }

    printThinSeparator();
    std::cout << "\n  SIZING RECOMMENDATION (based on peak month: " << peakMonth << ")\n";
    printThinSeparator();
    std::cout << "    Average Load (kW)       : " << std::fixed << std::setprecision(1)
              << peakResult.kW << " kW\n";
    std::cout << "    Displacement PF         : " << std::setprecision(4)
              << peakResult.truePF / peakResult.pfDistortion << "\n";
    std::cout << "    True PF (THD-derated)   : " << std::setprecision(4)
              << peakResult.truePF << "\n";
    std::cout << "    Target PF               : " << std::setprecision(2)
              << TARGET_PF << "\n";
    std::cout << "    Required Capacitor Bank  : " << std::setprecision(1)
              << peakKVAr << " kVAr\n";
    if (peakResult.detunedRequired) {
        std::cout << "    *** DETUNED REACTOR REQUIRED (THD > "
                  << THD_DETUNED_THRESHOLD << "%) ***\n";
    }
    std::cout << "\n";
}

// ============================================================================
// Module 5 — VFD Cubic Affinity Law Savings Estimator
// ============================================================================
//
// The Affinity Laws for centrifugal machines (pumps, fans, compressors) state:
//
//   Flow  ∝  N           (speed)
//   Head  ∝  N²
//   Power ∝  N³
//
// Therefore:  P₂ = P₁ × (N₂/N₁)³
//
// A VFD allows continuous speed adjustment, avoiding throttle-valve or damper
// losses.  Even a modest speed reduction yields large energy savings because
// of the cubic relationship.
//
// This module calculates the theoretical savings for a single 200 kW rated
// centrifugal pump motor operating 8,000 hours/year with a 15% speed reduction.
// ============================================================================

static void runModule5(const std::vector<MonthlyRecord>& /*data*/) {
    printSeparator();
    std::cout << "  MODULE 5: VFD Cubic Affinity Law Savings Estimator\n";
    printSeparator();

    // Cube of speed ratio gives the power ratio
    double speedRatioCubed = std::pow(VFD_SPEED_RATIO, 3.0);

    // Power at reduced speed
    double P2_kW = VFD_MOTOR_RATED_kW * speedRatioCubed;

    // Energy consumption at full speed vs reduced speed
    double energyFull_kWh    = VFD_MOTOR_RATED_kW * VFD_OPERATING_HOURS;
    double energyReduced_kWh = P2_kW              * VFD_OPERATING_HOURS;
    double energySaved_kWh   = energyFull_kWh - energyReduced_kWh;

    // Monetary savings
    double savingsINR = energySaved_kWh * VFD_ENERGY_RATE_INR;

    // Power saving percentage
    double savingPercent = (1.0 - speedRatioCubed) * 100.0;

    std::cout << "  Assumptions:\n";
    std::cout << "    Motor Rated Power       : " << std::fixed << std::setprecision(0)
              << VFD_MOTOR_RATED_kW << " kW (centrifugal pump)\n";
    std::cout << "    Speed Reduction         : "
              << std::setprecision(0) << (1.0 - VFD_SPEED_RATIO) * 100.0
              << "% (N2/N1 = " << std::setprecision(2) << VFD_SPEED_RATIO << ")\n";
    std::cout << "    Operating Hours         : " << std::setprecision(0)
              << VFD_OPERATING_HOURS << " hrs/year\n";
    std::cout << "    Energy Rate             : INR " << std::setprecision(2)
              << VFD_ENERGY_RATE_INR << "/kWh (weighted avg)\n";
    printThinSeparator();

    std::cout << "  Results:\n";
    std::cout << "    Power at full speed     : " << std::setprecision(1)
              << VFD_MOTOR_RATED_kW << " kW\n";
    std::cout << "    Power at " << std::setprecision(0)
              << VFD_SPEED_RATIO * 100.0 << "% speed   : "
              << std::setprecision(1) << P2_kW << " kW\n";
    std::cout << "    Power saving            : " << std::setprecision(1)
              << savingPercent << "%\n";
    std::cout << "    Annual energy (full)    : " << std::setprecision(0)
              << energyFull_kWh << " kWh\n";
    std::cout << "    Annual energy (reduced) : " << std::setprecision(0)
              << energyReduced_kWh << " kWh\n";
    std::cout << "    Annual kWh saved        : " << std::setprecision(0)
              << energySaved_kWh << " kWh\n";
    std::cout << "    Annual savings          : INR " << std::setprecision(2)
              << savingsINR << "\n\n";
}

// ============================================================================
// Final Summary
// ============================================================================

static void runFinalSummary(const std::vector<MonthlyRecord>& data) {
    printSeparator();
    std::cout << "  FINAL SUMMARY — GridOptima Tariff Analysis\n";
    printSeparator();

    // --- Module 1 aggregates ---
    double totalEnergyCharge = 0.0;
    double totalConsumption  = 0.0;
    for (const auto& rec : data) {
        totalEnergyCharge += computeEnergyCharge(rec.activeEnergy_kWh);
        totalConsumption  += rec.activeEnergy_kWh;
    }

    // --- Module 2 aggregates ---
    double totalDemandCharge = 0.0;
    double totalPenalty      = 0.0;
    for (const auto& rec : data) {
        auto res = computeDemandCharges(rec.contractedDemand_kVA, rec.recordedMD_kVA);
        totalDemandCharge += res.demandCharge_INR;
        totalPenalty      += res.overDemandPenalty_INR;
    }

    // --- Module 3 aggregates ---
    double totalTODSavings = 0.0;
    for (const auto& rec : data) {
        double baseRate = getBaseRate(rec.activeEnergy_kWh);
        auto   r        = computeTODSavings(rec.peakTOD_kWh, rec.offPeakTOD_kWh, baseRate);
        totalTODSavings += r.monthlySavings;
    }

    // --- Module 4 peak sizing ---
    double peakKVAr     = 0.0;
    std::string peakMonth;
    bool detunedNeeded  = false;
    for (const auto& rec : data) {
        auto r = computeAPFC(rec.activeEnergy_kWh, rec.laggingPF, rec.thdPercent);
        if (r.kVAr_required > peakKVAr) {
            peakKVAr  = r.kVAr_required;
            peakMonth = rec.month;
        }
        if (r.detunedRequired) detunedNeeded = true;
    }

    // --- Module 5 ---
    double speedRatioCubed = std::pow(VFD_SPEED_RATIO, 3.0);
    double vfdSavedKWh     = VFD_MOTOR_RATED_kW * (1.0 - speedRatioCubed) * VFD_OPERATING_HOURS;
    double vfdSavedINR     = vfdSavedKWh * VFD_ENERGY_RATE_INR;

    // --- Print ---
    std::cout << std::fixed;
    std::cout << "  1. Annual Energy Charge (slab-based)     : INR "
              << std::setw(16) << std::setprecision(2) << totalEnergyCharge << "\n";
    std::cout << "     Total Consumption                     : "
              << std::setw(16) << std::setprecision(0) << totalConsumption << " kWh\n";
    std::cout << "     Effective Blended Rate                : INR "
              << std::setw(16) << std::setprecision(4)
              << (totalConsumption > 0.0 ? totalEnergyCharge / totalConsumption : 0.0)
              << "/kWh\n\n";

    std::cout << "  2. Annual Demand Charges                 : INR "
              << std::setw(16) << std::setprecision(2) << totalDemandCharge << "\n";
    std::cout << "     Over-Demand Penalties                 : INR "
              << std::setw(16) << std::setprecision(2) << totalPenalty << "\n\n";

    std::cout << "  3. Potential TOD Shift Savings (20% shift): INR "
              << std::setw(15) << std::setprecision(2) << totalTODSavings << "/year\n\n";

    std::cout << "  4. APFC Capacitor Bank Sizing            : "
              << std::setw(16) << std::setprecision(1) << peakKVAr
              << " kVAr (peak month: " << peakMonth << ")\n";
    std::cout << "     Detuned Reactor Required              : "
              << (detunedNeeded ? "YES" : "NO") << "\n\n";

    std::cout << "  5. VFD Annual Savings (200kW pump @85%)  : "
              << std::setw(16) << std::setprecision(0) << vfdSavedKWh << " kWh\n";
    std::cout << "                                           : INR "
              << std::setw(16) << std::setprecision(2) << vfdSavedINR << "\n";

    printSeparator();
    std::cout << "\n";
}

// ============================================================================
// Main Entry Point
// ============================================================================

int main() {
    const std::string csvPath = "data/sample_12month_utility_bills.csv";

    std::cout << "\n";
    printSeparator();
    std::cout << "  GridOptima Tariff Engine v1.0\n";
    std::cout << "  Industrial HT Utility Bill Optimisation Toolkit\n";
    printSeparator();
    std::cout << "  Loading data from: " << csvPath << "\n\n";

    // Load CSV data
    std::vector<MonthlyRecord> data = loadCSV(csvPath);

    if (data.empty()) {
        std::cerr << "[FATAL] No valid records loaded. Exiting.\n";
        return 1;
    }

    std::cout << "  Records loaded: " << data.size() << " months\n\n";

    // Execute all five analysis modules
    runModule1(data);
    runModule2(data);
    runModule3(data);
    runModule4(data);
    runModule5(data);

    // Print consolidated summary
    runFinalSummary(data);

    return 0;
}
