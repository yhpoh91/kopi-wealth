export interface FeatureFlag {
  PK: string;             // FEATURE#{name}
  SK: string;             // FEATURE#{name}
  name: string;
  enabled: boolean;
  allowedSubs?: string[]; // always on for these users (unless blocked)
  blockedSubs?: string[]; // always off for these users
  rolloutPercent?: number; // 0-100; absent = everyone
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  deletedBy?: string;
}
