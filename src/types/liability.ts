export type LiabilityType = 'mortgage' | 'personal_loan' | 'car_loan' | 'student_loan' | 'credit_card' | 'other';
export type LiabilityStatus = 'outstanding' | 'partially_returned' | 'settled';

export interface Liability {
  PK: string;           // LIAB#{sub}
  SK: string;           // LIAB#{id}
  GSI1PK: string;       // USER#{sub}
  GSI1SK: string;       // LIAB#{updatedAt}
  id: string;
  sub: string;
  name: string;
  type: LiabilityType;
  currency: string;
  originalAmount: number;
  outstandingAmount: number;
  status: LiabilityStatus;
  deletedAt?: string;
  deletedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LiabilitySnapshot {
  PK: string;           // LIAB_SNAP#{liabId}
  SK: string;           // SNAP#{recordedAt}#{uuid}
  liabId: string;
  outstandingAmount: number;
  status: LiabilityStatus;
  recordedAt: string;
  createdAt: string;
}
