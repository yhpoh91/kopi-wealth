export interface UserRecord {
  PK: string;        // USER#{sub}
  SK: string;        // PROFILE
  sub: string;
  email: string;
  name?: string;
  isAdmin?: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  deletedBy?: string;
}

export interface SessionRecord {
  PK: string;        // SESSION#{sessionId}
  SK: string;        // SESSION
  sessionId: string;
  sub: string;
  createdAt: string;
  ttl: number;
}
