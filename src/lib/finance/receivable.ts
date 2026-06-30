import type { ReceivableStatus } from '../../types/receivable';

export function calcReceivableStatus(originalAmount: number, outstandingAmount: number): ReceivableStatus {
  if (outstandingAmount === 0) return 'settled';
  if (outstandingAmount >= originalAmount) return 'outstanding';
  return 'partially_received';
}
