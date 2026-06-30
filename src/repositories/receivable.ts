import { GetCommand, PutCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from '../lib/ddb';
import { config } from '../config';
import type { Receivable, ReceivableSnapshot } from '../types/receivable';

export async function getReceivable(sub: string, id: string): Promise<Receivable | null> {
  const res = await ddb.send(new GetCommand({
    TableName: config.tableName,
    Key: { PK: `RECV#${sub}`, SK: `RECV#${id}` },
  }));
  return (res.Item as Receivable) ?? null;
}

export async function queryByUser(sub: string): Promise<Receivable[]> {
  const res = await ddb.send(new QueryCommand({
    TableName: config.tableName,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :prefix)',
    ExpressionAttributeValues: { ':pk': `USER#${sub}`, ':prefix': 'RECV#' },
  }));
  const items = (res.Items ?? []) as Receivable[];
  return items.filter((r) => !r.deletedAt);
}

export async function putReceivable(receivable: Receivable): Promise<void> {
  await ddb.send(new PutCommand({
    TableName: config.tableName,
    Item: receivable,
  }));
}

export async function updateReceivable(
  sub: string,
  id: string,
  fields: { outstandingAmount: number; status: string; updatedAt: string; GSI1SK: string },
): Promise<void> {
  await ddb.send(new UpdateCommand({
    TableName: config.tableName,
    Key: { PK: `RECV#${sub}`, SK: `RECV#${id}` },
    UpdateExpression: 'SET outstandingAmount = :outstanding, #status = :status, updatedAt = :updatedAt, GSI1SK = :gsi1sk',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':outstanding': fields.outstandingAmount,
      ':status': fields.status,
      ':updatedAt': fields.updatedAt,
      ':gsi1sk': fields.GSI1SK,
    },
  }));
}

export async function softDelete(sub: string, id: string, deletedBy: string, deletedAt: string): Promise<void> {
  await ddb.send(new UpdateCommand({
    TableName: config.tableName,
    Key: { PK: `RECV#${sub}`, SK: `RECV#${id}` },
    UpdateExpression: 'SET deletedAt = :deletedAt, deletedBy = :deletedBy',
    ExpressionAttributeValues: { ':deletedAt': deletedAt, ':deletedBy': deletedBy },
  }));
}

export async function putSnapshot(snapshot: ReceivableSnapshot): Promise<void> {
  await ddb.send(new PutCommand({
    TableName: config.tableName,
    Item: snapshot,
  }));
}
