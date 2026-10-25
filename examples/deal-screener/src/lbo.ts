import type { LboResult, LboYear, Teaser } from './model.js';

/**
 * Assumptions for the paper LBO. Exported so the memo can print them: an IRR
 * without its assumptions is a number pretending to be an answer.
 */
export interface LboAssumptions {
  entryMultiple: number;
  /** Exit at entry, i.e. no multiple arbitrage in the base case. */
  exitMultiple: number;
  holdYears: number;
  /** Debt sized as a multiple of entry EBITDA… */
  leverageTurns: number;
  /** …and capped as a share of enterprise value, whichever binds first. */
  maxLeverageShareOfEv: number;
  interestRate: number;
  /** Cash tax rate applied to EBITDA less D&A less interest. */
  taxRate: number;
  revenueGrowth: number;
  ebitdaGrowth: number;
  /** Incremental working capital as a share of incremental revenue. */
  workingCapitalShareOfGrowth: number;
  /** Transaction fees as a share of EV, funded with equity. */
  transactionFeeShareOfEv: number;
}

export const DEFAULT_ASSUMPTIONS: LboAssumptions = {
  entryMultiple: 6,
  exitMultiple: 6,
  holdYears: 5,
  leverageTurns: 3,
  maxLeverageShareOfEv: 0.55,
  interestRate: 0.095,
  taxRate: 0.25,
  revenueGrowth: 0.04,
  ebitdaGrowth: 0.04,
  workingCapitalShareOfGrowth: 0.1,
  transactionFeeShareOfEv: 0.02,
};

/**
 * A five-line paper LBO, the kind you do before asking for a management meeting.
 *
 * Simplifications stated rather than hidden: D&A is proxied by maintenance capex
 * (reasonable for an asset-light services business, wrong for anything capital
 * intensive), 100% of free cash flow sweeps to debt, there is no revolver, no
 * PIK, no dividend, and exit is at the entry multiple so the return comes from
 * deleveraging and growth rather than from multiple expansion. Those are the
 * honest defaults for a screen: they make the answer a floor, not a pitch.
 */
export function paperLbo(
  teaser: Teaser,
  buyerAdjustedEbitda: number,
  assumptions: LboAssumptions = DEFAULT_ASSUMPTIONS,
): LboResult {
  const enterpriseValue = buyerAdjustedEbitda * assumptions.entryMultiple;
  const entryDebt = Math.min(
    buyerAdjustedEbitda * assumptions.leverageTurns,
    enterpriseValue * assumptions.maxLeverageShareOfEv,
  );
  const transactionFees = enterpriseValue * assumptions.transactionFeeShareOfEv;
  // Net debt left behind is funded by the buyer, so it lands in the equity cheque.
  const entryEquity = enterpriseValue - entryDebt + transactionFees + teaser.netDebtAtClose;

  const years: LboYear[] = [];
  let debt = entryDebt;
  // Free cash flow left over once the debt is gone sits on the balance sheet and
  // belongs to equity at exit. Dropping it would make every low-leverage, cash-
  // generative deal look identical, because the return would stop depending on
  // how much cash the business actually throws off.
  let cash = 0;
  let revenue = teaser.revenue;
  let ebitda = buyerAdjustedEbitda;

  for (let year = 1; year <= assumptions.holdYears; year++) {
    const openingRevenue = revenue;
    revenue = openingRevenue * (1 + assumptions.revenueGrowth);
    ebitda = ebitda * (1 + assumptions.ebitdaGrowth);

    const capex = revenue * teaser.maintenanceCapexShare;
    const depreciation = capex; // see the note above
    const interest = debt * assumptions.interestRate;
    const taxableIncome = ebitda - depreciation - interest;
    const cashTaxes = Math.max(0, taxableIncome) * assumptions.taxRate;
    const workingCapitalOutflow =
      (revenue - openingRevenue) * assumptions.workingCapitalShareOfGrowth;

    // Round the components first, then derive free cash flow from the rounded
    // figures. Rounding each line independently leaves the published table out by
    // a dollar or two, and a memo whose columns do not add up invites the reader to
    // distrust every other number on the page.
    const row = {
      year,
      revenue: round(revenue),
      ebitda: round(ebitda),
      interest: round(interest),
      cashTaxes: round(cashTaxes),
      capex: round(capex),
      workingCapitalOutflow: round(workingCapitalOutflow),
    };
    const freeCashFlow =
      row.ebitda - row.interest - row.cashTaxes - row.capex - row.workingCapitalOutflow;
    const debtRepaid = Math.max(0, Math.min(round(debt), freeCashFlow));
    debt = round(debt) - debtRepaid;
    cash += freeCashFlow - debtRepaid;

    years.push({ ...row, freeCashFlow, debtRepaid, closingDebt: debt });
  }

  const exitEbitda = ebitda;
  const exitEnterpriseValue = exitEbitda * assumptions.exitMultiple;
  const exitEquity = exitEnterpriseValue - debt + cash;
  const moic = entryEquity === 0 ? 0 : exitEquity / entryEquity;
  const irr = moic <= 0 ? -1 : moic ** (1 / assumptions.holdYears) - 1;

  return {
    entryMultiple: assumptions.entryMultiple,
    enterpriseValue: round(enterpriseValue),
    entryDebt: round(entryDebt),
    entryEquity: round(entryEquity),
    transactionFees: round(transactionFees),
    years,
    exitMultiple: assumptions.exitMultiple,
    exitEbitda: round(exitEbitda),
    exitEnterpriseValue: round(exitEnterpriseValue),
    exitDebt: round(debt),
    exitCash: round(cash),
    exitEquity: round(exitEquity),
    moic: Math.round(moic * 100) / 100,
    irr: Math.round(irr * 10_000) / 10_000,
    holdYears: assumptions.holdYears,
  };
}

function round(value: number): number {
  return Math.round(value);
}
