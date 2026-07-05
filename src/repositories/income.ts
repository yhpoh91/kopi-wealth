import { GetCommand, PutCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from '../lib/ddb';
import { config } from '../config';
import { clock } from '../lib/clock';
import type { IncomeSource } from '../types/income';

export async function queryIncomeByUser(sub: string): Promise<IncomeSource[]> {
  const res = await ddb.send(new QueryCommand({
    TableName: config.tableName,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': `INCOME#${sub}`, ':prefix': 'INCOME#' },
    ScanIndexForward: false,
  }));
  return ((res.Items ?? []) as IncomeSource[]).filter(i => !i.deletedAt);
}

export async function getIncome(sub: string, id: string): Promise<IncomeSource | null> {
  const res = await ddb.send(new GetCommand({
    TableName: config.tableName,
    Key: { PK: `INCOME#${sub}`, SK: `INCOME#${id}` },
  }));
  return (res.Item as IncomeSource) ?? null;
}

export async function putIncome(item: IncomeSource): Promise<void> {
  await ddb.send(new PutCommand({
    TableName: config.tableName,
    Item: item,
  }));
}

export async function updateIncome(
  sub: string,
  id: string,
  fields: {
    type: string;
    name?: string;
    amount: number;
    exchangeRate?: number;
    frequency: string;
    startDate?: string;
    endDate?: string;
    notes?: string;
  },
): Promise<void> {
  await ddb.send(new UpdateCommand({
    TableName: config.tableName,
    Key: { PK: `INCOME#${sub}`, SK: `INCOME#${id}` },
    UpdateExpression: 'SET #type = :type, #name = :name, amount = :amount, exchangeRate = :exchangeRate, frequency = :frequency, startDate = :startDate, endDate = :endDate, notes = :notes, updatedAt = :updatedAt',
    ExpressionAttributeNames: { '#type': 'type', '#name': 'name' },
    ExpressionAttributeValues: {
      ':type': fields.type,
      ':name': fields.name ?? null,
      ':amount': fields.amount,
      ':exchangeRate': fields.exchangeRate ?? null,
      ':frequency': fields.frequency,
      ':startDate': fields.startDate ?? null,
      ':endDate': fields.endDate ?? null,
      ':notes': fields.notes ?? null,
      ':updatedAt': clock.nowIso(),
    },
  }));
}

export async function softDeleteIncome(sub: string, id: string, deletedBy: string): Promise<void> {
  await ddb.send(new UpdateCommand({
    TableName: config.tableName,
    Key: { PK: `INCOME#${sub}`, SK: `INCOME#${id}` },
    UpdateExpression: 'SET deletedAt = :deletedAt, deletedBy = :deletedBy',
    ExpressionAttributeValues: { ':deletedAt': clock.nowIso(), ':deletedBy': deletedBy },
  }));
}
