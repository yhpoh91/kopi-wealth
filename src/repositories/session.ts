import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from '../lib/ddb';
import { config } from '../config';
import type { SessionRecord } from '../types';
import { clock } from '../lib/clock';

export async function getSession(sessionId: string): Promise<SessionRecord | null> {
  const res = await ddb.send(new GetCommand({
    TableName: config.tableName,
    Key: { PK: `SESSION#${sessionId}`, SK: `SESSION#${sessionId}` },
  }));
  const item = res.Item as SessionRecord | undefined;
  if (!item || item.deletedAt) return null;
  return item;
}

export async function putSession(session: SessionRecord): Promise<void> {
  await ddb.send(new PutCommand({
    TableName: config.tableName,
    Item: session,
  }));
}

export async function deleteSession(sessionId: string, deletedBy: string): Promise<void> {
  const now = clock.nowIso();
  await ddb.send(new UpdateCommand({
    TableName: config.tableName,
    Key: { PK: `SESSION#${sessionId}`, SK: `SESSION#${sessionId}` },
    UpdateExpression: 'SET deletedAt = :da, deletedBy = :db',
    ExpressionAttributeValues: { ':da': now, ':db': deletedBy },
  }));
}
