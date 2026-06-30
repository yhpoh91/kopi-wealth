export type ReceivableType = 'personal_loan' | 'rental_deposit' | 'business_loan' | 'other';
export type ReceivableStatus = 'outstanding' | 'partially_received' | 'settled';

export interface Receivable {
  PK: string;
  SK: string;
  GSI1PK: string;
  GSI1SK: string;
  id: string;
  sub: string;
  name: string;
  type: ReceivableType;
  currency: string;
  originalAmount: number;
  outstandingAmount: number;
  status: ReceivableStatus;
  deletedAt?: string;
  deletedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReceivableSnapshot {
  PK: string;
  SK: string;
  recvId: string;
  outstandingAmount: number;
  status: ReceivableStatus;
  recordedAt: string;
  createdAt: string;
}
