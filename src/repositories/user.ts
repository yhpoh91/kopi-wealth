import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from '../lib/ddb';
import { config } from '../config';
import type { UserRecord } from '../types';

export async function getUser(sub: string): Promise<UserRecord | null> {
  const res = await ddb.send(new GetCommand({
    TableName: config.tableName,
    Key: { PK: `USER#${sub}`, SK: `USER#${sub}` },
  }));
  return (res.Item as UserRecord) ?? null;
}

export async function putUser(user: UserRecord): Promise<void> {
  await ddb.send(new PutCommand({
    TableName: config.tableName,
    Item: user,
  }));
}
