export type GoalType = 'lean_fire' | 'full_fire' | 'property' | 'custom';
export type GoalStatus = 'active' | 'achieved' | 'paused';
export type TracksAgainst =
  | 'net_worth'
  | 'current_assets'
  | 'investable_assets'
  | 'total_savings'
  | 'total_investments'
  | 'cpf_total'
  | 'available_funds';

export interface Goal {
  PK: string;
  SK: string;
  GSI1PK: string;
  GSI1SK: string;
  id: string;
  sub: string;
  name: string;
  type: GoalType;
  tracksAgainst: TracksAgainst;
  targetAmount: number;
  sortOrder: number;
  status: GoalStatus;
  deletedAt?: string;
  deletedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GoalSnapshot {
  PK: string;
  SK: string;
  goalId: string;
  date: string;
  value: number;
  createdAt: string;
}
