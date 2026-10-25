/**
 * The shape of a teaser or CIM once a human has typed the numbers out of it.
 *
 * Everything here is a figure a seller's banker actually puts in a teaser. Nothing
 * here is inferred by a model: the LLM in this example never touches these fields,
 * because a screening memo whose EBITDA was hallucinated is worse than no memo.
 */
export interface Teaser {
  company: string;
  sector: string;
  /** Latest full fiscal year the figures describe. */
  fiscalYear: number;
  /** Revenue for `fiscalYear`. */
  revenue: number;
  /** Earlier full years, oldest first. Used for the growth check. */
  revenueHistory: number[];
  /** EBITDA as the seller reports it, before any adjustment. */
  reportedEbitda: number;
  /** Share of revenue under contract or recurring, 0–1. */
  recurringRevenueShare: number;
  customers: { name: string; revenueShare: number }[];
  adjustments: Adjustment[];
  /** Maintenance capex as a share of revenue, 0–1. Drives the paper LBO. */
  maintenanceCapexShare: number;
  /** Net debt assumed left behind at close. Usually zero in a cash-free sale. */
  netDebtAtClose: number;
  /** What the seller is asking, as a multiple of *their* adjusted EBITDA. */
  askMultiple?: number;
  /** Anything a human flagged while reading the book. Carried into the memo. */
  readerNotes?: string[];
}

export type AdjustmentCategory =
  | 'owner-compensation'
  | 'discretionary-personal'
  | 'one-time'
  | 'related-party-normalisation'
  | 'run-rate-new-contract'
  | 'accounting-policy'
  | 'pro-forma-synergy';

export interface Adjustment {
  id: string;
  label: string;
  /** Positive adds to EBITDA; negative is a normalisation that reduces it. */
  amount: number;
  category: AdjustmentCategory;
  /**
   * Whether the seller provided support — an invoice, a payroll record, a market
   * rent appraisal. Undocumented add-backs are not necessarily wrong; they are
   * unproven, and they get haircut rather than believed.
   */
  documented: boolean;
  /** The seller's stated rationale, quoted. */
  sellerRationale?: string;
}

export type Verdict = 'accepted' | 'challenged' | 'rejected';

export interface ReviewedAdjustment extends Adjustment {
  verdict: Verdict;
  /** Fraction of `amount` credited, 0–1. */
  haircut: number;
  /** `amount * haircut`, the figure that reaches buyer-adjusted EBITDA. */
  credited: number;
  /** Why the policy landed where it did. Written for a human reader. */
  rationale: string;
}

export type CheckStatus = 'pass' | 'watch' | 'fail';

export interface Check {
  name: string;
  status: CheckStatus;
  /** The computed figure, pre-formatted for the memo. */
  value: string;
  /** The threshold this was judged against, stated so the reader can disagree. */
  criterion: string;
  comment: string;
}

export interface Valuation {
  buyerAdjustedEbitda: number;
  sellerAdjustedEbitda: number;
  /** Multiple range applied to buyer-adjusted EBITDA. */
  lowMultiple: number;
  highMultiple: number;
  lowEnterpriseValue: number;
  highEnterpriseValue: number;
  midEnterpriseValue: number;
  /** The seller's ask in money terms, when an ask multiple was given. */
  askEnterpriseValue: number | null;
  /** That same ask expressed against buyer-adjusted EBITDA. */
  askMultipleOnBuyerAdjusted: number | null;
}

export interface LboYear {
  year: number;
  revenue: number;
  ebitda: number;
  interest: number;
  cashTaxes: number;
  capex: number;
  workingCapitalOutflow: number;
  freeCashFlow: number;
  debtRepaid: number;
  closingDebt: number;
}

export interface LboResult {
  entryMultiple: number;
  enterpriseValue: number;
  entryDebt: number;
  /** Equity cheque, including transaction fees. */
  entryEquity: number;
  transactionFees: number;
  years: LboYear[];
  exitMultiple: number;
  exitEbitda: number;
  exitEnterpriseValue: number;
  exitDebt: number;
  /** Cash accumulated after the debt is fully repaid. Counted in exit equity. */
  exitCash: number;
  exitEquity: number;
  moic: number;
  /** Annualised, as a decimal (0.21 = 21%). */
  irr: number;
  holdYears: number;
}

export interface Screen {
  teaser: Teaser;
  checks: Check[];
  adjustments: ReviewedAdjustment[];
  valuation: Valuation;
  lbo: LboResult;
  /** 'pursue' | 'pursue-with-diligence' | 'pass', derived from the checks. */
  recommendation: Recommendation;
}

export type Recommendation = 'pursue' | 'pursue-with-diligence' | 'pass';
