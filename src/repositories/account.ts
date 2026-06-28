import { GetCommand, PutCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from '../lib/ddb';
import { config } from '../config';
import type { Account, AccountSnapshot } from '../types/account';

export async function getAccount(sub: string, id: string): Promise<Account | null> {
  const res = await ddb.send(new GetCommand({
    TableName: config.tableName,
    Key: { PK: `ACCOUNT#${sub}`, SK: `ACCOUNT#${id}` },
  }));
  return (res.Item as Account) ?? null;
}

export async function queryByUser(sub: string): Promise<Account[]> {
  const res = await ddb.send(new QueryCommand({
    TableName: config.tableName,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: { ':pk': `USER#${sub}` },
  }));
  const items = (res.Items ?? []) as Account[];
  return items.filter((a) => !a.deletedAt);
}

export async function putAccount(account: Account): Promise<void> {
  await ddb.send(new PutCommand({
    TableName: config.tableName,
    Item: account,
  }));
}

export async function updateBalance(sub: string, id: string, balance: number, updatedAt: string): Promise<void> {
  await ddb.send(new UpdateCommand({
    TableName: config.tableName,
    Key: { PK: `ACCOUNT#${sub}`, SK: `ACCOUNT#${id}` },
    UpdateExpression: 'SET balance = :balance, updatedAt = :updatedAt',
    ExpressionAttributeValues: { ':balance': balance, ':updatedAt': updatedAt },
  }));
}

export async function softDelete(sub: string, id: string, deletedBy: string, deletedAt: string): Promise<void> {
  await ddb.send(new UpdateCommand({
    TableName: config.tableName,
    Key: { PK: `ACCOUNT#${sub}`, SK: `ACCOUNT#${id}` },
    UpdateExpression: 'SET deletedAt = :deletedAt, deletedBy = :deletedBy',
    ExpressionAttributeValues: { ':deletedAt': deletedAt, ':deletedBy': deletedBy },
  }));
}

export async function putSnapshot(snapshot: AccountSnapshot): Promise<void> {
  await ddb.send(new PutCommand({
    TableName: config.tableName,
    Item: snapshot,
  }));
}

export async function querySnapshots(accountId: string): Promise<AccountSnapshot[]> {
  const res = await ddb.send(new QueryCommand({
    TableName: config.tableName,
    KeyConditionExpression: 'PK = :pk',
    ExpressionAttributeValues: { ':pk': `ACCT_SNAP#${accountId}` },
  }));
  return (res.Items ?? []) as AccountSnapshot[];
}
