export interface UserRecord {
  PK: string;       // USER#{sub}
  SK: string;       // USER#{sub}
  GSI1PK: string;   // ALL_USERS
  GSI1SK: string;   // USER#{sub}
  sub: string;
  email: string;
  name?: string;
  role?: 'admin';
  createdAt: string;
  updatedAt: string;
  lastSeenAt?: string;
  deletedAt?: string;
  deletedBy?: string;
}

export interface SessionRecord {
  PK: string;       // SESSION#{sessionId}
  SK: string;       // SESSION#{sessionId}
  sessionId: string;
  sub: string;
  createdAt: string;
  ttl: number;
  deletedAt?: string;
  deletedBy?: string;
}
