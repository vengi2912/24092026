/* Energy balance + customer economics. Transparent calculations only. */
window.SolarApp = window.SolarApp || {};
SolarApp.EnergyBalance = (function () {
  function monthlyBalance(consumptionMonthly, generationRows) {
    const loads = Array.isArray(consumptionMonthly) ? consumptionMonthly : Array(12).fill(Number(consumptionMonthly)||0);
    const rows = (generationRows || []).map((g, i) => {
      const load = Number(loads[i] || 0);
      const solar = Math.max(0, Number(g.acMonthlyKWh || 0));
      const selfUse = Math.min(load, solar);
      const surplus = Math.max(0, solar - load);
      const deficit = Math.max(0, load - solar);
      const solarCoveragePct = load > 0 ? (selfUse / load) * 100 : 0;
      return { month:g.month, load, solar, selfUse, surplus, deficit, solarCoveragePct };
    });
    const totalLoad = rows.reduce((s,r)=>s+r.load,0);
    const totalSolar = rows.reduce((s,r)=>s+r.solar,0);
    const totalSelfUse = rows.reduce((s,r)=>s+r.selfUse,0);
    const totalSurplus = rows.reduce((s,r)=>s+r.surplus,0);
    const totalDeficit = rows.reduce((s,r)=>s+r.deficit,0);
    return {
      rows, totalLoad, totalSolar, totalSelfUse, totalSurplus, totalDeficit,
      solarCoveragePct: totalLoad > 0 ? totalSelfUse/totalLoad*100 : 0,
      solarUtilizationPct: totalSolar > 0 ? totalSelfUse/totalSolar*100 : 0
    };
  }

  function economics(balance, investment, subsidy, importValuePerUnit, exportValuePerUnit, degradationPct=0.5) {
    const importRate = Math.max(0, Number(importValuePerUnit)||0);
    const exportRate = Math.max(0, Number(exportValuePerUnit)||0);
    const annualOffset = balance.totalSelfUse * importRate;
    const annualExportCredit = balance.totalSurplus * exportRate;
    const firstYearSavings = annualOffset + annualExportCredit;
    const netInvestment = Math.max(0, (Number(investment)||0) - (Number(subsidy)||0));
    let cumulative = 0, paybackYears = null;
    for(let y=1;y<=25;y++){
      const yearFactor = Math.pow(1 - Math.max(0, degradationPct)/100, y-1);
      const yearSavings = firstYearSavings * yearFactor;
      cumulative += yearSavings;
      if(paybackYears===null && cumulative >= netInvestment){
        const prev = cumulative - yearSavings;
        const fraction = yearSavings > 0 ? Math.max(0, (netInvestment-prev)/yearSavings) : 0;
        paybackYears = (y-1)+fraction;
      }
    }
    return { importRate, exportRate, annualOffset, annualExportCredit, firstYearSavings, netInvestment, paybackYears };
  }
  return { monthlyBalance, economics };
})();
