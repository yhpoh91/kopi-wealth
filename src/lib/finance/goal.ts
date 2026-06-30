import type { TracksAgainst } from '../../types/goal';

export interface GoalMetrics {
  netWorth: number | null;
  currentAssets: number | null;
  investableAssets: number | null;
  totalSavings: number | null;
  totalInvestments: number | null;
  cpfTotal: number | null;
  availableFunds: number | null;
}

export function resolveTrackedValue(tracksAgainst: TracksAgainst, metrics: GoalMetrics): number | null {
  switch (tracksAgainst) {
    case 'net_worth': return metrics.netWorth;
    case 'current_assets': return metrics.currentAssets;
    case 'investable_assets': return metrics.investableAssets;
    case 'total_savings': return metrics.totalSavings;
    case 'total_investments': return metrics.totalInvestments;
    case 'cpf_total': return metrics.cpfTotal;
    case 'available_funds': return metrics.availableFunds;
  }
}

export function calcGoalProgress(currentValue: number, targetAmount: number): number {
  if (targetAmount <= 0) return 0;
  return Math.max(0, Math.min(100, (currentValue / targetAmount) * 100));
}
