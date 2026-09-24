/* ==========================================================================
   sizing.js — recommends a system size using BOTH the roof's physical limit
   and the customer's electricity consumption, and sizes a battery bank for a
   given critical load + backup duration.
   ========================================================================== */
window.SolarApp = window.SolarApp || {};

SolarApp.Sizing = (function () {

  // consumption: { monthlyUnits: number } OR { monthly: [12 numbers] }
  function consumptionStats(consumption) {
    let monthly;
    if (Array.isArray(consumption.monthly) && consumption.monthly.filter(Number.isFinite).length === 12) {
      monthly = consumption.monthly;
    } else {
      const avg = consumption.monthlyUnits || 0;
      monthly = Array(12).fill(avg);
    }
    const annual = monthly.reduce((s, v) => s + v, 0);
    const avgMonthly = annual / 12;
    const peakMonthly = Math.max(...monthly);
    const minMonthly = Math.min(...monthly);
    return { monthly, annual, avgMonthly, peakMonthly, minMonthly };
  }

  // Recommend capacity: roof max vs. consumption-derived need, take the lower,
  // then round to a sensible step.
  function recommendCapacity(roofMaxKW, consumption, specificYieldEstimate) {
    const stats = consumptionStats(consumption);
    // consumption-based requirement: annual units / assumed specific yield (kWh/kWp/yr)
    const syield = Number.isFinite(specificYieldEstimate) && specificYieldEstimate > 0 ? specificYieldEstimate : 1450;
    const consumptionBasedKW = stats.annual / syield;

    const roofLimit = Number.isFinite(roofMaxKW) && roofMaxKW > 0 ? roofMaxKW : 3;
    const cappedByRoof = Math.min(roofLimit, consumptionBasedKW > 0 ? consumptionBasedKW : 3);
    const recommendedKW = roundToStep(cappedByRoof > 0 ? cappedByRoof : 3, 0.5);

    return {
      roofMaxKW: roofLimit,
      consumptionBasedKW,
      recommendedKW: Math.max(0, recommendedKW),
      limitedBy: roofMaxKW < consumptionBasedKW ? "roof" : "consumption",
      consumptionStats: stats,
    };
  }

  function roundToStep(value, step) {
    return Math.round(value / step) * step;
  }

  // Battery sizing for hybrid/off-grid: critical load (kW) x backup hours =
  // energy requirement, then inflate for DoD and round-trip efficiency and
  // an extra system-loss margin.
  function sizeBattery(criticalLoadKW, backupHours, battery, systemLossPct) {
    const rawEnergyKWh = criticalLoadKW * backupHours;
    const dodPct = battery.dodPct || 90;
    const rtEffPct = battery.roundtripEffPct || 95;
    const lossMarginPct = systemLossPct || 8;

    // Usable energy needed, inflated back up to nameplate capacity required:
    // nameplate = raw / (DoD% x roundtripEff% x (1 - extra losses))
    const nameplateNeededKWh = rawEnergyKWh / ((dodPct / 100) * (rtEffPct / 100) * (1 - lossMarginPct / 100));

    const unitsNeeded = Math.ceil(nameplateNeededKWh / battery.capacityKWh);
    const totalNameplateKWh = unitsNeeded * battery.capacityKWh;
    const totalUsableKWh = totalNameplateKWh * (dodPct / 100);

    return {
      rawEnergyKWh, nameplateNeededKWh, unitsNeeded, totalNameplateKWh, totalUsableKWh,
      battery,
    };
  }

  // Off-grid daily-energy sizing: consumption-driven, with autonomy days.
  function sizeOffGrid(dailyEnergyKWh, autonomyDays, battery, systemLossPct, peakSunHoursAvg) {
    const avgLoadKW = dailyEnergyKWh / 24;
    const backupHours = autonomyDays * 24;
    const batterySizing = sizeBattery(avgLoadKW, backupHours, battery, systemLossPct);
    // Solar capacity must cover the daily energy requirement plus battery round-trip losses,
    // divided by average peak sun hours.
    const requiredSolarKW = Number.isFinite(peakSunHoursAvg) && peakSunHoursAvg > 0
      ? (dailyEnergyKWh / (peakSunHoursAvg * ((battery.roundtripEffPct || 95) / 100)))
      : NaN;
    return { batterySizing, requiredSolarKW };
  }

  return { consumptionStats, recommendCapacity, sizeBattery, sizeOffGrid };
})();
