import type { LiabilityStatus } from '../../types/liability';

export function calcLiabilityStatus(originalAmount: number, outstandingAmount: number): LiabilityStatus {
  if (outstandingAmount === 0) return 'settled';
  if (outstandingAmount >= originalAmount) return 'outstanding';
  return 'partially_returned';
}
