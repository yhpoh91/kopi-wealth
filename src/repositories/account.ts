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
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': `ACCOUNT#${sub}`, ':prefix': 'ACCOUNT#' },
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

export async function updateAccount(
  sub: string,
  id: string,
  fields: { name: string; type: string; balance: number; institution?: string; notes?: string },
  updatedAt: string,
): Promise<void> {
  await ddb.send(new UpdateCommand({
    TableName: config.tableName,
    Key: { PK: `ACCOUNT#${sub}`, SK: `ACCOUNT#${id}` },
    UpdateExpression: 'SET #name = :name, #type = :type, balance = :balance, institution = :institution, notes = :notes, updatedAt = :updatedAt',
    ExpressionAttributeNames: { '#name': 'name', '#type': 'type' },
    ExpressionAttributeValues: {
      ':name': fields.name,
      ':type': fields.type,
      ':balance': fields.balance,
      ':institution': fields.institution ?? null,
      ':notes': fields.notes ?? null,
      ':updatedAt': updatedAt,
    },
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
