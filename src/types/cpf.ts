export interface CPFAccount {
  PK: string;      // CPF#{sub}
  SK: string;      // CPF
  sub: string;
  oa: number;
  sa: number;
  ma: number;
  ra: number;
  createdAt: string;
  updatedAt: string;
}

export interface CPFSnapshot {
  PK: string;      // CPF_SNAP#{sub}
  SK: string;      // SNAP#{recordedAt}
  sub: string;
  oa: number;
  sa: number;
  ma: number;
  ra: number;
  recordedAt: string;
  createdAt: string;
}
