import { queryByUser as queryAccounts } from '../../repositories/account';
import { queryByUser as queryInvestments } from '../../repositories/investment';
import { getCpf } from '../../repositories/cpf';
import { queryByUser as queryLiabilities } from '../../repositories/liability';
import { queryByUser as queryReceivables } from '../../repositories/receivable';
import { queryByUser as queryGoals } from '../../repositories/goal';
import { getOrFetchRates, convertAmount } from '../fx';
import { sumConverted } from './convert';
import { clock } from '../clock';
import { calcReservedFunds, calcAvailableFunds } from './reserved-funds';
import { resolveTrackedValue, calcGoalProgress } from './goal';
import type { GoalMetrics } from './goal';
import type { FinancialSettings } from '../../types/financialSettings';
import type { Goal } from '../../types/goal';

export interface GoalProgress {
  goal: Goal;
  currentValue: number | null;
  progress: number | null;
}

// Everything the web dashboard and GET /v1/overview show, computed once so they cannot drift.
// Totals are in the base currency. `has*` = the user has any data for it; `*Ok` = every
// foreign-currency amount in it could be converted; `null` totals cannot be computed.
// One asset group's total in the base currency. `partial` = some amounts could not be converted
// (the total then leaves them out, or for CPF includes the unconverted SGD figure).
export interface GroupTotal {
  total: number;
  has: boolean;
  partial: boolean;
}

export interface Overview {
  currency: string;
  asOf: string;
  accountCount: number;
  netWorth: number | null;
  hasAnyData: boolean;
  netWorthPartial: boolean;     // net worth is null because FX conversion failed
  cpfPartial: boolean;          // CPF total is included unconverted (net worth still computed)
  totalAssets: number | null;
  hasAnyAssets: boolean;
  totalAssetsOk: boolean;
  liabilitiesTotal: number;
  hasLiabilities: boolean;
  liabilitiesOk: boolean;
  availableFunds: number | null;
  hasAnyFunds: boolean;
  totalFundsOk: boolean;
  activeGoalCount: number;
  topGoals: GoalProgress[];     // first two active goals, in display order
  groups: {
    cashBank: GroupTotal;
    investments: GroupTotal;
    cpf: GroupTotal;
    receivables: GroupTotal;    // active receivables ("Owed to you")
  };
}

export async function buildOverview(sub: string, settings: FinancialSettings | null): Promise<Overview> {
  const currency = settings?.currency ?? 'SGD';
  const today = clock.today();

  const [accounts, investments, cpf, liabilities, receivables, goals] = await Promise.all([
    queryAccounts(sub),
    queryInvestments(sub),
    getCpf(sub),
    queryLiabilities(sub),
    queryReceivables(sub),
    queryGoals(sub),
  ]);

  // Gather all foreign currencies needed
  const needsCpfFx = cpf !== null && currency !== 'SGD';
  const foreignCurrencies = [...new Set([
    ...accounts.map((a) => a.currency),
    ...investments.map((i) => i.currency),
    ...liabilities.filter((l) => l.status !== 'settled').map((l) => l.currency),
    ...receivables.filter((r) => r.status !== 'settled').map((r) => r.currency),
  ].filter((c) => c !== currency))];
  if (needsCpfFx && !foreignCurrencies.includes('SGD')) foreignCurrencies.push('SGD');

  let rates: Record<string, number> = {};
  let fxFailed = false;
  if (foreignCurrencies.length > 0) {
    try {
      ({ rates } = await getOrFetchRates(currency));
    } catch {
      fxFailed = true;
    }
  }

  // Savings (accounts)
  const hasSavingsData = accounts.length > 0;
  const { total: savingsNum, partial: savingsPartial } = sumConverted(
    accounts.map((a) => ({ amount: a.balance, currency: a.currency })), currency, rates, fxFailed);
  const savingsOk = !hasSavingsData || (!savingsPartial && !fxFailed);

  // Investments
  const hasInvestData = investments.length > 0;
  const { total: investNum, partial: investPartial } = sumConverted(
    investments.map((i) => ({ amount: i.value, currency: i.currency })), currency, rates, fxFailed);
  const investOk = !hasInvestData || (!investPartial && !fxFailed);

  // CPF
  const hasCpfData = cpf !== null;
  let cpfNum = 0;
  let cpfPartial = false;
  if (cpf) {
    const cpfSgd = cpf.oa + cpf.sa + cpf.ma + cpf.ra;
    if (currency === 'SGD') {
      cpfNum = cpfSgd;
    } else {
      const c = convertAmount(cpfSgd, 'SGD', currency, rates);
      if (c !== null && !fxFailed) { cpfNum = c; } else { cpfNum = cpfSgd; cpfPartial = true; }
    }
  }

  // Liabilities (active only)
  const activeLibs = liabilities.filter((l) => l.status !== 'settled');
  const hasLiabData = activeLibs.length > 0;
  const { total: liabTotal, partial: liabPartial } = sumConverted(
    activeLibs.map((l) => ({ amount: l.outstandingAmount, currency: l.currency })), currency, rates, fxFailed);
  const liabOk = !hasLiabData || (!liabPartial && !fxFailed);

  // Receivables (active only)
  const activeRecvs = receivables.filter((r) => r.status !== 'settled');
  const hasRecvData = activeRecvs.length > 0;
  const { total: recvTotal, partial: recvPartial } = sumConverted(
    activeRecvs.map((r) => ({ amount: r.outstandingAmount, currency: r.currency })), currency, rates, fxFailed);
  const recvOk = !hasRecvData || (!recvPartial && !fxFailed);

  const hasAnyData = hasSavingsData || hasInvestData || hasCpfData || hasLiabData || hasRecvData;
  const netWorthKnown = hasAnyData && savingsOk && investOk && liabOk && recvOk;

  // Net Worth = savings + investments + CPF + receivables − liabilities
  const netWorth = netWorthKnown ? savingsNum + investNum + cpfNum + recvTotal - liabTotal : null;

  // Total Assets = savings + investments + CPF + receivables
  const hasAnyAssets = hasSavingsData || hasInvestData || hasCpfData || hasRecvData;
  const totalAssetsOk = savingsOk && investOk && !cpfPartial && recvOk;
  const totalAssets = hasAnyAssets && totalAssetsOk ? savingsNum + investNum + cpfNum + recvTotal : null;

  // Available Funds = savings + investments − reserved funds
  const hasAnyFunds = hasSavingsData || hasInvestData;
  const totalFundsOk = savingsOk && investOk;
  const availableFunds = (() => {
    if (!settings || !hasAnyFunds) return null;
    if (!totalFundsOk) return null;
    const { reservedSavings, reservedInvestments } = calcReservedFunds(savingsNum, investNum, settings);
    const { availableSavings, availableInvestments } = calcAvailableFunds(savingsNum, investNum, reservedSavings, reservedInvestments);
    return availableSavings! + availableInvestments!;
  })();

  // GoalMetrics for goal progress
  const currentAssets = (hasSavingsData || hasInvestData || hasRecvData) && savingsOk && investOk && recvOk
    ? savingsNum + investNum + recvTotal
    : null;
  const totalFunds = hasAnyFunds && totalFundsOk ? savingsNum + investNum : null;
  const goalMetrics: GoalMetrics = {
    netWorth,
    currentAssets,
    investableAssets: totalFunds,
    totalSavings: hasSavingsData ? savingsNum : 0,
    totalInvestments: hasInvestData ? investNum : 0,
    cpfTotal: hasCpfData ? cpfNum : null,
    availableFunds,
  };

  const allActiveGoals = goals
    .filter((g) => g.status === 'active')
    .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt));
  const topGoals = allActiveGoals.slice(0, 2).map((goal): GoalProgress => {
    const currentValue = resolveTrackedValue(goal.tracksAgainst, goalMetrics);
    const progress = currentValue !== null && goal.targetAmount > 0 ? calcGoalProgress(currentValue, goal.targetAmount) : null;
    return { goal, currentValue, progress };
  });

  return {
    currency,
    asOf: today,
    accountCount: accounts.length,
    netWorth,
    hasAnyData,
    netWorthPartial: hasAnyData && !netWorthKnown,
    cpfPartial,
    totalAssets,
    hasAnyAssets,
    totalAssetsOk,
    liabilitiesTotal: liabTotal,
    hasLiabilities: hasLiabData,
    liabilitiesOk: liabOk,
    availableFunds,
    hasAnyFunds,
    totalFundsOk,
    activeGoalCount: allActiveGoals.length,
    topGoals,
    groups: {
      cashBank: { total: savingsNum, has: hasSavingsData, partial: savingsPartial },
      investments: { total: investNum, has: hasInvestData, partial: investPartial },
      cpf: { total: cpfNum, has: hasCpfData, partial: cpfPartial },
      receivables: { total: recvTotal, has: hasRecvData, partial: recvPartial },
    },
  };
}
