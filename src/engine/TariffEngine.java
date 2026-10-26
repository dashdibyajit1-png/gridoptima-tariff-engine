/**
 * GridOptima Tariff Engine — Industrial Electricity Tariff Analyser
 *
 * <p>A standalone, single-file Java programme that reads twelve months of
 * utility-bill data from a CSV and runs five engineering analysis modules:
 * <ol>
 *   <li>Piecewise energy-tariff bracket calculation</li>
 *   <li>Demand-ratchet billing with over-demand penalties</li>
 *   <li>Time-of-Day peak-to-off-peak load-shift simulation</li>
 *   <li>Reactive-power compensation &amp; APFC capacitor-bank sizing</li>
 *   <li>VFD cubic-affinity-law energy-savings estimation</li>
 * </ol>
 *
 * <p><b>Compile &amp; Run (from project root):</b>
 * <pre>
 *   javac src/engine/TariffEngine.java
 *   java -cp src/engine TariffEngine
 * </pre>
 *
 * <p>No external dependencies — uses only the Java Standard Library.
 *
 * @author  GridOptima Engineering Team
 * @version 1.0
 */

import java.io.BufferedReader;
import java.io.FileReader;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

public class TariffEngine {

    // ──────────────────────────────────────────────────────────────────────
    //  CSV field indices (0-based, matching the header order)
    // ──────────────────────────────────────────────────────────────────────
    private static final int COL_MONTH               = 0;
    private static final int COL_CONTRACTED_DEMAND    = 1;
    private static final int COL_RECORDED_MD          = 2;
    private static final int COL_ACTIVE_ENERGY        = 3;
    private static final int COL_PEAK_TOD             = 4;
    private static final int COL_OFFPEAK_TOD          = 5;
    private static final int COL_LAGGING_PF           = 6;
    private static final int COL_THD_PERCENT          = 7;
    private static final int COL_BILLED_PENALTY       = 8;
    private static final int COL_TOTAL_INVOICE        = 9;

    // ──────────────────────────────────────────────────────────────────────
    //  Module 1 constants — Piecewise energy-tariff slab rates (INR/kWh)
    // ──────────────────────────────────────────────────────────────────────
    /** Upper boundary of each tariff slab in kWh.  The last slab is unbounded. */
    private static final double[] SLAB_LIMITS = {100_000, 300_000, 500_000, Double.MAX_VALUE};
    /** Corresponding rate for each slab (INR per kWh). */
    private static final double[] SLAB_RATES  = {3.50, 4.50, 5.50, 6.50};

    // ──────────────────────────────────────────────────────────────────────
    //  Module 2 constants — Demand-ratchet rules
    // ──────────────────────────────────────────────────────────────────────
    /** Rate per kVA of billing demand (INR/kVA/month). */
    private static final double DEMAND_CHARGE_RATE       = 250.0;
    /** Minimum billing threshold as a fraction of Contracted Demand. */
    private static final double MIN_BILLING_FRACTION     = 0.75;
    /** Intermediate ratchet fraction (MD between 75 % and 85 % of CD). */
    private static final double INTERMEDIATE_FRACTION    = 0.85;
    /** Penalty rate for demand exceeding Contracted Demand (INR/kVA). */
    private static final double OVER_DEMAND_PENALTY_RATE = 500.0;

    // ──────────────────────────────────────────────────────────────────────
    //  Module 3 constants — Time-of-Day (TOD) load-shift parameters
    // ──────────────────────────────────────────────────────────────────────
    /** Premium above base energy rate charged during peak hours (INR/kWh). */
    private static final double PEAK_PREMIUM   = 1.50;
    /** Discount below base energy rate during off-peak hours (INR/kWh). */
    private static final double OFFPEAK_DISCOUNT = 1.00;
    /** Fraction of peak load assumed shiftable to off-peak. */
    private static final double SHIFT_FRACTION = 0.20;

    // ──────────────────────────────────────────────────────────────────────
    //  Module 4 constants — Reactive-power / APFC sizing
    // ──────────────────────────────────────────────────────────────────────
    /** Target power factor after capacitor-bank installation. */
    private static final double TARGET_PF     = 0.95;
    /** Assumed operating hours per month for kW derivation. */
    private static final double OPERATING_HOURS_PER_MONTH = 720.0;
    /** THD threshold above which a detuned reactor is recommended (%). */
    private static final double THD_DETUNE_THRESHOLD = 5.0;

    // ──────────────────────────────────────────────────────────────────────
    //  Module 5 constants — VFD affinity-law savings estimator
    // ──────────────────────────────────────────────────────────────────────
    /** Rated motor power for the centrifugal pump (kW). */
    private static final double VFD_MOTOR_KW       = 200.0;
    /** Speed ratio N₂/N₁ after VFD speed reduction. */
    private static final double VFD_SPEED_RATIO    = 0.85;
    /** Annual operating hours of the pump motor. */
    private static final double VFD_OPERATING_HOURS = 8000.0;
    /** Weighted-average energy rate for VFD savings (INR/kWh). */
    private static final double VFD_ENERGY_RATE    = 5.00;

    // ──────────────────────────────────────────────────────────────────────
    //  CSV path (relative to project root)
    // ──────────────────────────────────────────────────────────────────────
    private static final String CSV_PATH = "data/sample_12month_utility_bills.csv";

    // ──────────────────────────────────────────────────────────────────────
    //  Row data holder — a lightweight inner class to avoid Map overhead
    // ──────────────────────────────────────────────────────────────────────
    /**
     * Holds the parsed values for a single monthly row from the CSV.
     * All numeric fields are stored as doubles for arithmetic convenience.
     */
    private static class MonthRecord {
        final String month;
        final double contractedDemandKVA;
        final double recordedMdKVA;
        final double activeEnergyKWh;
        final double peakTodKWh;
        final double offPeakTodKWh;
        final double laggingPF;
        final double thdPercent;
        final double billedPenaltyINR;
        final double totalInvoiceINR;

        MonthRecord(String[] tokens) {
            this.month              = tokens[COL_MONTH].trim();
            this.contractedDemandKVA = Double.parseDouble(tokens[COL_CONTRACTED_DEMAND].trim());
            this.recordedMdKVA       = Double.parseDouble(tokens[COL_RECORDED_MD].trim());
            this.activeEnergyKWh     = Double.parseDouble(tokens[COL_ACTIVE_ENERGY].trim());
            this.peakTodKWh          = Double.parseDouble(tokens[COL_PEAK_TOD].trim());
            this.offPeakTodKWh       = Double.parseDouble(tokens[COL_OFFPEAK_TOD].trim());
            this.laggingPF           = Double.parseDouble(tokens[COL_LAGGING_PF].trim());
            this.thdPercent          = Double.parseDouble(tokens[COL_THD_PERCENT].trim());
            this.billedPenaltyINR    = Double.parseDouble(tokens[COL_BILLED_PENALTY].trim());
            this.totalInvoiceINR     = Double.parseDouble(tokens[COL_TOTAL_INVOICE].trim());
        }
    }

    // ====================================================================
    //  MAIN
    // ====================================================================

    /**
     * Entry point.  Reads the CSV, runs all five analysis modules, and
     * prints the consolidated report to {@code stdout}.
     *
     * @param args command-line arguments (unused)
     */
    public static void main(String[] args) {
        List<MonthRecord> records = loadCsv(CSV_PATH);
        if (records.isEmpty()) {
            System.err.println("ERROR: No data rows found in " + CSV_PATH);
            return;
        }

        printBanner();

        // Run each module and accumulate annual totals for the final summary
        double annualEnergyCharge  = runModule1_PiecewiseTariff(records);
        double annualDemandCharge  = runModule2_DemandRatchet(records);
        double annualTodSavings    = runModule3_TodLoadShift(records);
        double[] apfcResults       = runModule4_ReactivePower(records);
        double[] vfdResults        = runModule5_VfdAffinityLaw();

        printFinalSummary(annualEnergyCharge, annualDemandCharge, annualTodSavings,
                          apfcResults, vfdResults);
    }

    // ====================================================================
    //  CSV LOADER
    // ====================================================================

    /**
     * Reads the CSV file at the given path, skipping the header row,
     * and returns a list of {@link MonthRecord} objects.
     *
     * @param path relative or absolute path to the CSV file
     * @return list of parsed monthly records (empty on I/O error)
     */
    private static List<MonthRecord> loadCsv(String path) {
        List<MonthRecord> records = new ArrayList<>();
        try (BufferedReader br = new BufferedReader(new FileReader(path))) {
            String line;
            boolean headerSkipped = false;
            while ((line = br.readLine()) != null) {
                line = line.trim();
                if (line.isEmpty()) continue;           // skip blank lines
                if (!headerSkipped) {                   // skip header row
                    headerSkipped = true;
                    continue;
                }
                String[] tokens = line.split(",");
                if (tokens.length < 10) {
                    System.err.println("WARN: Skipping malformed row: " + line);
                    continue;
                }
                records.add(new MonthRecord(tokens));
            }
        } catch (IOException e) {
            System.err.println("ERROR reading CSV: " + e.getMessage());
        }
        return records;
    }

    // ====================================================================
    //  MODULE 1 — Piecewise Tariff Bracket Parser
    // ====================================================================

    /**
     * Computes the energy charge for a given consumption by walking through
     * the tariff slabs in ascending order.
     *
     * <p>Each kWh is billed at the rate of the slab it falls into:
     * <ul>
     *   <li>0 – 100,000 kWh   → ₹3.50/kWh</li>
     *   <li>100,001 – 300,000 kWh → ₹4.50/kWh</li>
     *   <li>300,001 – 500,000 kWh → ₹5.50/kWh</li>
     *   <li>&gt; 500,000 kWh   → ₹6.50/kWh</li>
     * </ul>
     *
     * @param kWh total active energy consumed in the month
     * @return energy charge in INR
     */
    private static double computeSlabCharge(double kWh) {
        double remaining = kWh;
        double charge    = 0.0;
        double prevLimit = 0.0;       // lower boundary of the current slab

        for (int i = 0; i < SLAB_LIMITS.length && remaining > 0; i++) {
            // Width of the current slab (capped by remaining consumption)
            double slabWidth = Math.min(remaining, SLAB_LIMITS[i] - prevLimit);
            charge    += slabWidth * SLAB_RATES[i];
            remaining -= slabWidth;
            prevLimit  = SLAB_LIMITS[i];
        }
        return charge;
    }

    /**
     * Runs Module 1 for every month: applies the piecewise tariff slabs
     * to each month's Active_Energy_kWh and prints a tabulated report.
     *
     * @param records the twelve monthly records
     * @return total annual energy charge (INR)
     */
    private static double runModule1_PiecewiseTariff(List<MonthRecord> records) {
        printModuleHeader(1, "Piecewise Tariff Bracket Parser");

        System.out.printf("  %-6s %14s %18s%n", "Month", "Energy (kWh)", "Energy Charge (₹)");
        System.out.println("  " + "-".repeat(42));

        double annualTotal = 0.0;
        for (MonthRecord r : records) {
            double charge = computeSlabCharge(r.activeEnergyKWh);
            annualTotal += charge;
            System.out.printf("  %-6s %,14.0f %,18.2f%n", r.month, r.activeEnergyKWh, charge);
        }
        System.out.println("  " + "-".repeat(42));
        System.out.printf("  %-6s %14s %,18.2f%n", "TOTAL", "", annualTotal);
        System.out.println();
        return annualTotal;
    }

    // ====================================================================
    //  MODULE 2 — Demand Ratchet Calculator
    // ====================================================================

    /**
     * Determines the billing demand after applying the ratchet rules:
     * <ul>
     *   <li>If MD &lt; 75 % of CD  → bill at 75 % of CD (minimum floor)</li>
     *   <li>If MD is 75 %–85 % of CD → bill at 85 % of CD</li>
     *   <li>If MD is 85 %–100 % of CD → bill at actual MD</li>
     *   <li>If MD &gt; CD → bill at MD (plus separate over-demand penalty)</li>
     * </ul>
     *
     * @param cd contracted demand (kVA)
     * @param md recorded maximum demand (kVA)
     * @return effective billing demand (kVA)
     */
    private static double billingDemand(double cd, double md) {
        if (md < cd * MIN_BILLING_FRACTION) {
            // MD is very low — utility enforces a minimum billing floor
            return cd * MIN_BILLING_FRACTION;
        } else if (md < cd * INTERMEDIATE_FRACTION) {
            // MD is between 75 % and 85 % — billed at 85 % ratchet
            return cd * INTERMEDIATE_FRACTION;
        } else {
            // MD ≥ 85 % of CD — bill at the higher of CD and MD
            return Math.max(cd, md);
        }
    }

    /**
     * Computes the over-demand penalty when MD exceeds the Contracted Demand.
     *
     * @param cd contracted demand (kVA)
     * @param md recorded maximum demand (kVA)
     * @return penalty in INR (zero if MD ≤ CD)
     */
    private static double overDemandPenalty(double cd, double md) {
        if (md > cd) {
            return (md - cd) * OVER_DEMAND_PENALTY_RATE;
        }
        return 0.0;
    }

    /**
     * Runs Module 2 for every month: computes billing demand, demand
     * charge, and any over-demand penalty, then prints the tabulated
     * results.
     *
     * @param records the twelve monthly records
     * @return total annual demand charge including penalties (INR)
     */
    private static double runModule2_DemandRatchet(List<MonthRecord> records) {
        printModuleHeader(2, "Demand Ratchet Calculator");

        System.out.printf("  %-6s %8s %8s %12s %16s %14s%n",
                "Month", "CD(kVA)", "MD(kVA)", "Bill Dem(kVA)", "Dem Charge(₹)", "Penalty(₹)");
        System.out.println("  " + "-".repeat(70));

        double annualDemandCharge = 0.0;
        double annualPenalty      = 0.0;

        for (MonthRecord r : records) {
            double bd      = billingDemand(r.contractedDemandKVA, r.recordedMdKVA);
            double demChg  = bd * DEMAND_CHARGE_RATE;
            double penalty = overDemandPenalty(r.contractedDemandKVA, r.recordedMdKVA);

            annualDemandCharge += demChg;
            annualPenalty      += penalty;

            System.out.printf("  %-6s %,8.0f %,8.0f %,12.0f %,16.2f %,14.2f%n",
                    r.month, r.contractedDemandKVA, r.recordedMdKVA, bd, demChg, penalty);
        }

        System.out.println("  " + "-".repeat(70));
        System.out.printf("  %-6s %8s %8s %12s %,16.2f %,14.2f%n",
                "TOTAL", "", "", "", annualDemandCharge, annualPenalty);
        System.out.println();

        return annualDemandCharge + annualPenalty;
    }

    // ====================================================================
    //  MODULE 3 — TOD Peak-to-Off-Peak Load Shift Simulator
    // ====================================================================

    /**
     * Derives the base energy rate for a month by dividing the slab-based
     * energy charge by total consumption.  This weighted rate anchors the
     * TOD premium / discount calculations.
     *
     * @param kWh total active energy for the month
     * @return effective base rate (INR/kWh)
     */
    private static double baseRate(double kWh) {
        return computeSlabCharge(kWh) / kWh;
    }

    /**
     * Runs the TOD load-shift simulation for each month.
     *
     * <p>Strategy: shift {@value #SHIFT_FRACTION} (20 %) of peak kWh into
     * off-peak.  The saving per shifted kWh equals the sum of the avoided
     * peak premium and the earned off-peak discount.
     *
     * @param records the twelve monthly records
     * @return total annual savings from the simulated load shift (INR)
     */
    private static double runModule3_TodLoadShift(List<MonthRecord> records) {
        printModuleHeader(3, "TOD Peak-to-Off-Peak Load Shift Simulator");

        System.out.printf("  %-6s %12s %12s %14s %16s%n",
                "Month", "Peak(kWh)", "OffPeak(kWh)", "Shifted(kWh)", "Savings(₹)");
        System.out.println("  " + "-".repeat(64));

        double annualSavings = 0.0;

        for (MonthRecord r : records) {
            // Amount of peak energy to shift
            double shiftedKWh = r.peakTodKWh * SHIFT_FRACTION;

            /*
             * Each shifted kWh avoids the peak premium and earns the off-peak
             * discount, so the net benefit per kWh shifted is:
             *   PEAK_PREMIUM + OFFPEAK_DISCOUNT
             */
            double savingsPerKWh = PEAK_PREMIUM + OFFPEAK_DISCOUNT;
            double monthlySavings = shiftedKWh * savingsPerKWh;
            annualSavings += monthlySavings;

            System.out.printf("  %-6s %,12.0f %,12.0f %,14.0f %,16.2f%n",
                    r.month, r.peakTodKWh, r.offPeakTodKWh, shiftedKWh, monthlySavings);
        }

        System.out.println("  " + "-".repeat(64));
        System.out.printf("  %-6s %12s %12s %14s %,16.2f%n",
                "TOTAL", "", "", "", annualSavings);
        System.out.println();
        return annualSavings;
    }

    // ====================================================================
    //  MODULE 4 — Reactive Power & APFC Capacitor Bank Sizing
    // ====================================================================

    /**
     * Computes the <em>true</em> power factor by derating the displacement
     * PF with the distortion factor caused by harmonic distortion (THD).
     *
     * <pre>
     *   PF_distortion = 1 / √(1 + THD²)
     *   PF_true       = PF_displacement × PF_distortion
     * </pre>
     *
     * @param displacementPF the measured lagging (displacement) PF
     * @param thdFraction    total harmonic distortion as a fraction (e.g. 0.05 for 5 %)
     * @return true power factor after THD derating
     */
    private static double truePowerFactor(double displacementPF, double thdFraction) {
        double pfDistortion = 1.0 / Math.sqrt(1.0 + thdFraction * thdFraction);
        return displacementPF * pfDistortion;
    }

    /**
     * Computes the required kVAr of capacitor compensation to improve the
     * power factor from φ₁ to φ₂.
     *
     * <pre>
     *   kVAr = kW × (tan φ₁ − tan φ₂)
     * </pre>
     *
     * @param kW       average active power (kWh / operating_hours)
     * @param currentPF current (true) power factor
     * @param targetPF  desired power factor after correction
     * @return reactive power to be compensated (kVAr)
     */
    private static double requiredKvar(double kW, double currentPF, double targetPF) {
        double phi1 = Math.acos(currentPF);
        double phi2 = Math.acos(targetPF);
        return kW * (Math.tan(phi1) - Math.tan(phi2));
    }

    /**
     * Runs Module 4 for every month: calculates the true PF (after THD
     * derating), the required kVAr compensation, and flags months where
     * a detuned reactor is needed.  The peak-month values are used for
     * the final capacitor-bank sizing recommendation.
     *
     * @param records the twelve monthly records
     * @return a two-element array: [peakKvar, peakMonthKW]
     */
    private static double[] runModule4_ReactivePower(List<MonthRecord> records) {
        printModuleHeader(4, "Reactive Power & APFC Capacitor Bank Sizing");

        System.out.printf("  %-6s %8s %7s %8s %10s %12s %s%n",
                "Month", "PF(disp)", "THD(%)", "PF(true)", "kW(avg)", "kVAr Req.", "Flag");
        System.out.println("  " + "-".repeat(72));

        double peakKvar     = 0.0;
        double peakKW       = 0.0;
        String peakMonth    = "";
        boolean detuneNeeded = false;

        for (MonthRecord r : records) {
            // Convert THD from percentage to fraction for the formula
            double thdFraction = r.thdPercent / 100.0;

            // True PF accounts for harmonic distortion
            double pfTrue = truePowerFactor(r.laggingPF, thdFraction);

            // Average active power over the month
            double kW = r.activeEnergyKWh / OPERATING_HOURS_PER_MONTH;

            // Required kVAr to reach target PF
            double kvar = requiredKvar(kW, pfTrue, TARGET_PF);

            // Track the peak-month for sizing the capacitor bank
            if (kvar > peakKvar) {
                peakKvar  = kvar;
                peakKW    = kW;
                peakMonth = r.month;
            }

            // Flag high-THD months
            String flag = "";
            if (r.thdPercent > THD_DETUNE_THRESHOLD) {
                flag = "DETUNED REACTOR REQUIRED";
                detuneNeeded = true;
            }

            System.out.printf("  %-6s %8.4f %7.1f %8.4f %,10.1f %,12.1f  %s%n",
                    r.month, r.laggingPF, r.thdPercent, pfTrue, kW, kvar, flag);
        }

        System.out.println("  " + "-".repeat(72));
        System.out.println();

        // ── Sizing recommendation based on the peak month ──
        System.out.println("  >> Capacitor Bank Sizing Recommendation (based on peak month: " + peakMonth + ")");
        System.out.printf("     Average kW (peak month)         : %,.1f kW%n", peakKW);
        System.out.printf("     Required kVAr compensation      : %,.1f kVAr%n", peakKvar);
        System.out.printf("     Target Power Factor             : %.2f%n", TARGET_PF);
        if (detuneNeeded) {
            System.out.println("     ⚠ WARNING: THD > 5% detected — DETUNED REACTOR RECOMMENDED for harmonic filtering.");
        }
        System.out.println();

        return new double[]{peakKvar, peakKW};
    }

    // ====================================================================
    //  MODULE 5 — VFD Cubic Affinity Law Savings Estimator
    // ====================================================================

    /**
     * Runs the VFD (Variable Frequency Drive) cubic-affinity-law analysis.
     *
     * <p>For centrifugal loads (pumps, fans, blowers), power scales with the
     * cube of the speed ratio:
     * <pre>
     *   P₂ = P₁ × (N₂ / N₁)³
     * </pre>
     *
     * A modest 15 % speed reduction (N₂/N₁ = 0.85) yields ≈ 38.6 % power
     * savings, demonstrating why VFDs are among the highest-ROI efficiency
     * investments in industrial plants.
     *
     * @return a two-element array: [annualKWhSaved, annualINRSaved]
     */
    private static double[] runModule5_VfdAffinityLaw() {
        printModuleHeader(5, "VFD Cubic Affinity Law Savings Estimator");

        // Apply the cubic law: P₂ = P₁ × (N₂/N₁)³
        double speedRatioCubed = Math.pow(VFD_SPEED_RATIO, 3);
        double reducedPowerKW  = VFD_MOTOR_KW * speedRatioCubed;
        double powerSavedKW    = VFD_MOTOR_KW - reducedPowerKW;

        // Annual energy savings
        double annualKWhSaved  = powerSavedKW * VFD_OPERATING_HOURS;
        double annualINRSaved  = annualKWhSaved * VFD_ENERGY_RATE;

        // Percentage savings
        double savingsPercent  = (1.0 - speedRatioCubed) * 100.0;

        System.out.println("  Parameter                            Value");
        System.out.println("  " + "-".repeat(52));
        System.out.printf("  Rated Motor Power (P₁)             : %,.1f kW%n", VFD_MOTOR_KW);
        System.out.printf("  Speed Ratio (N₂/N₁)               : %.2f%n", VFD_SPEED_RATIO);
        System.out.printf("  Speed Ratio Cubed (N₂/N₁)³        : %.6f%n", speedRatioCubed);
        System.out.printf("  Reduced Power (P₂)                 : %,.2f kW%n", reducedPowerKW);
        System.out.printf("  Power Saved                        : %,.2f kW  (%.1f%%)%n",
                powerSavedKW, savingsPercent);
        System.out.printf("  Operating Hours                    : %,.0f hrs/year%n", VFD_OPERATING_HOURS);
        System.out.printf("  Energy Rate (weighted avg.)        : ₹%.2f/kWh%n", VFD_ENERGY_RATE);
        System.out.println("  " + "-".repeat(52));
        System.out.printf("  Annual Energy Saved                : %,.0f kWh%n", annualKWhSaved);
        System.out.printf("  Annual Cost Saved                  : ₹%,.2f%n", annualINRSaved);
        System.out.println();

        return new double[]{annualKWhSaved, annualINRSaved};
    }

    // ====================================================================
    //  FINAL SUMMARY
    // ====================================================================

    /**
     * Prints a consolidated summary of all five modules, enabling a
     * quick cost–benefit overview for the engineering decision-maker.
     *
     * @param annualEnergyCharge total piecewise energy charge (Module 1)
     * @param annualDemandCharge total demand charge incl. penalties (Module 2)
     * @param annualTodSavings   simulated TOD load-shift savings (Module 3)
     * @param apfcResults        [peakKvar, peakKW] from Module 4
     * @param vfdResults         [annualKWhSaved, annualINRSaved] from Module 5
     */
    private static void printFinalSummary(double annualEnergyCharge, double annualDemandCharge,
                                          double annualTodSavings, double[] apfcResults,
                                          double[] vfdResults) {
        System.out.println("╔══════════════════════════════════════════════════════════════════╗");
        System.out.println("║               GRIDOPTIMA — ANNUAL TARIFF ANALYSIS SUMMARY       ║");
        System.out.println("╠══════════════════════════════════════════════════════════════════╣");
        System.out.printf("║  [M1] Annual Energy Charge (slab-based)   : ₹%,18.2f  ║%n", annualEnergyCharge);
        System.out.printf("║  [M2] Annual Demand Charge (incl. penalty): ₹%,18.2f  ║%n", annualDemandCharge);
        System.out.printf("║  [M3] Potential TOD Load-Shift Savings    : ₹%,18.2f  ║%n", annualTodSavings);
        System.out.printf("║  [M4] APFC Bank Size (peak month)        : %,14.1f kVAr  ║%n", apfcResults[0]);
        System.out.printf("║  [M5] VFD Annual kWh Saved               : %,14.0f kWh   ║%n", vfdResults[0]);
        System.out.printf("║  [M5] VFD Annual Cost Saved              : ₹%,18.2f  ║%n", vfdResults[1]);
        System.out.println("╠══════════════════════════════════════════════════════════════════╣");

        double totalSavingsOpportunity = annualTodSavings + vfdResults[1];
        System.out.printf("║  Combined Savings Opportunity (M3 + M5)  : ₹%,18.2f  ║%n", totalSavingsOpportunity);
        System.out.println("╚══════════════════════════════════════════════════════════════════╝");
        System.out.println();
    }

    // ====================================================================
    //  FORMATTING HELPERS
    // ====================================================================

    /** Prints the top-level programme banner. */
    private static void printBanner() {
        System.out.println();
        System.out.println("╔══════════════════════════════════════════════════════════════════╗");
        System.out.println("║          GRIDOPTIMA — INDUSTRIAL TARIFF ENGINE v1.0             ║");
        System.out.println("║          12-Month Utility Bill Analysis Report                  ║");
        System.out.println("╚══════════════════════════════════════════════════════════════════╝");
        System.out.println();
    }

    /**
     * Prints a section header for a numbered module.
     *
     * @param number module number (1–5)
     * @param title  human-readable module title
     */
    private static void printModuleHeader(int number, String title) {
        System.out.println("┌──────────────────────────────────────────────────────────────────┐");
        System.out.printf("│  Module %d: %-54s│%n", number, title);
        System.out.println("└──────────────────────────────────────────────────────────────────┘");
    }
}
