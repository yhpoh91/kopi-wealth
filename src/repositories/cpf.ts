import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from '../lib/ddb';
import { config } from '../config';
import type { CPFAccount, CPFSnapshot } from '../types/cpf';

export async function getCpf(sub: string): Promise<CPFAccount | null> {
  const res = await ddb.send(new GetCommand({
    TableName: config.tableName,
    Key: { PK: `CPF#${sub}`, SK: 'CPF' },
  }));
  return (res.Item as CPFAccount | undefined) ?? null;
}

export async function upsertCpf(record: CPFAccount): Promise<void> {
  await ddb.send(new PutCommand({
    TableName: config.tableName,
    Item: record,
  }));
}

export async function putCpfSnapshot(snapshot: CPFSnapshot): Promise<void> {
  await ddb.send(new PutCommand({
    TableName: config.tableName,
    Item: snapshot,
  }));
}

export async function querySnapshots(sub: string, limit = 12): Promise<CPFSnapshot[]> {
  const res = await ddb.send(new QueryCommand({
    TableName: config.tableName,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': `CPF_SNAP#${sub}`, ':prefix': 'SNAP#' },
    ScanIndexForward: false,
    Limit: limit,
  }));
  return (res.Items ?? []) as CPFSnapshot[];
}
