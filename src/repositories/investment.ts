import { GetCommand, PutCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from '../lib/ddb';
import { config } from '../config';
import type { Investment, InvestmentSnapshot } from '../types/investment';

export async function getInvestment(sub: string, id: string): Promise<Investment | null> {
  const res = await ddb.send(new GetCommand({
    TableName: config.tableName,
    Key: { PK: `INVEST#${sub}`, SK: `INVEST#${id}` },
  }));
  return (res.Item as Investment) ?? null;
}

export async function queryByUser(sub: string): Promise<Investment[]> {
  const res = await ddb.send(new QueryCommand({
    TableName: config.tableName,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': `INVEST#${sub}`, ':prefix': 'INVEST#' },
  }));
  const items = (res.Items ?? []) as Investment[];
  return items.filter((i) => !i.deletedAt);
}

export async function putInvestment(investment: Investment): Promise<void> {
  await ddb.send(new PutCommand({
    TableName: config.tableName,
    Item: investment,
  }));
}

export async function updateInvestment(
  sub: string,
  id: string,
  fields: { name: string; type: string; value: number; institution?: string; notes?: string },
  updatedAt: string,
): Promise<void> {
  await ddb.send(new UpdateCommand({
    TableName: config.tableName,
    Key: { PK: `INVEST#${sub}`, SK: `INVEST#${id}` },
    UpdateExpression: 'SET #name = :name, #type = :type, #value = :value, institution = :institution, notes = :notes, updatedAt = :updatedAt',
    ExpressionAttributeNames: { '#name': 'name', '#type': 'type', '#value': 'value' },
    ExpressionAttributeValues: {
      ':name': fields.name,
      ':type': fields.type,
      ':value': fields.value,
      ':institution': fields.institution ?? null,
      ':notes': fields.notes ?? null,
      ':updatedAt': updatedAt,
    },
  }));
}

export async function softDelete(sub: string, id: string, deletedBy: string, deletedAt: string): Promise<void> {
  await ddb.send(new UpdateCommand({
    TableName: config.tableName,
    Key: { PK: `INVEST#${sub}`, SK: `INVEST#${id}` },
    UpdateExpression: 'SET deletedAt = :deletedAt, deletedBy = :deletedBy',
    ExpressionAttributeValues: { ':deletedAt': deletedAt, ':deletedBy': deletedBy },
  }));
}

export async function putSnapshot(snapshot: InvestmentSnapshot): Promise<void> {
  await ddb.send(new PutCommand({
    TableName: config.tableName,
    Item: snapshot,
  }));
}

export async function querySnapshots(investId: string, limit = 12): Promise<InvestmentSnapshot[]> {
  const res = await ddb.send(new QueryCommand({
    TableName: config.tableName,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': `INVEST_SNAP#${investId}`, ':prefix': 'SNAP#' },
    ScanIndexForward: false,
    Limit: limit,
  }));
  return (res.Items ?? []) as InvestmentSnapshot[];
}
