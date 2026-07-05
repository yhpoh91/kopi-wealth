import { GetCommand, PutCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from '../lib/ddb';
import { config } from '../config';
import type { ExpenseItem } from '../types/expenseItem';

export async function getExpenseItem(sub: string, date: string, id: string): Promise<ExpenseItem | null> {
  const res = await ddb.send(new GetCommand({
    TableName: config.tableName,
    Key: { PK: `EXPENSE_ITEM#${sub}`, SK: `ITEM#${date}#${id}` },
  }));
  return (res.Item as ExpenseItem) ?? null;
}

export interface QueryOptions {
  limit?: number;
  before?: string; // SK cursor for pagination (exclusive)
}

export async function queryByUser(sub: string, opts: QueryOptions = {}): Promise<{ items: ExpenseItem[]; lastSK?: string }> {
  const limit = opts.limit ?? 31;
  const res = await ddb.send(new QueryCommand({
    TableName: config.tableName,
    KeyConditionExpression: opts.before
      ? 'PK = :pk AND SK < :before'
      : 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: opts.before
      ? { ':pk': `EXPENSE_ITEM#${sub}`, ':before': opts.before }
      : { ':pk': `EXPENSE_ITEM#${sub}`, ':prefix': 'ITEM#' },
    ScanIndexForward: false,
    // Over-fetch to account for soft-deleted items consuming slots when filtered in JS
    Limit: Math.max((limit + 1) * 2, 50),
  }));
  const all = ((res.Items ?? []) as ExpenseItem[]).filter(i => !i.deletedAt);
  const hasMore = all.length > limit;
  const items = hasMore ? all.slice(0, limit) : all;
  const lastSK = hasMore ? items[items.length - 1].SK : undefined;
  return { items, lastSK };
}

export async function queryByPeriod(sub: string, period: string): Promise<ExpenseItem[]> {
  const res = await ddb.send(new QueryCommand({
    TableName: config.tableName,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': `EXPENSE_ITEM#${sub}`, ':prefix': `ITEM#${period}` },
    ScanIndexForward: false,
  }));
  return ((res.Items ?? []) as ExpenseItem[]).filter(i => !i.deletedAt);
}

export async function putExpenseItem(item: ExpenseItem): Promise<void> {
  await ddb.send(new PutCommand({
    TableName: config.tableName,
    Item: item,
  }));
}

export async function updateExpenseItem(
  sub: string,
  date: string,
  id: string,
  fields: { name: string; amount: number; notes?: string; exchangeRate?: number },
  updatedAt: string,
): Promise<void> {
  await ddb.send(new UpdateCommand({
    TableName: config.tableName,
    Key: { PK: `EXPENSE_ITEM#${sub}`, SK: `ITEM#${date}#${id}` },
    UpdateExpression: 'SET #name = :name, amount = :amount, notes = :notes, exchangeRate = :exchangeRate, updatedAt = :updatedAt',
    ExpressionAttributeNames: { '#name': 'name' },
    ExpressionAttributeValues: {
      ':name': fields.name,
      ':amount': fields.amount,
      ':notes': fields.notes ?? null,
      ':exchangeRate': fields.exchangeRate ?? null,
      ':updatedAt': updatedAt,
    },
  }));
}

export async function softDeleteExpenseItem(
  sub: string,
  date: string,
  id: string,
  deletedBy: string,
  deletedAt: string,
): Promise<void> {
  await ddb.send(new UpdateCommand({
    TableName: config.tableName,
    Key: { PK: `EXPENSE_ITEM#${sub}`, SK: `ITEM#${date}#${id}` },
    UpdateExpression: 'SET deletedAt = :deletedAt, deletedBy = :deletedBy',
    ExpressionAttributeValues: { ':deletedAt': deletedAt, ':deletedBy': deletedBy },
  }));
}
