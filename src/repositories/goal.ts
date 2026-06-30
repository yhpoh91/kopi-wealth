import { GetCommand, PutCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from '../lib/ddb';
import { config } from '../config';
import type { Goal, GoalSnapshot, GoalStatus } from '../types/goal';

export async function getGoal(sub: string, id: string): Promise<Goal | null> {
  const res = await ddb.send(new GetCommand({
    TableName: config.tableName,
    Key: { PK: `GOAL#${sub}`, SK: `GOAL#${id}` },
  }));
  return (res.Item as Goal) ?? null;
}

export async function queryByUser(sub: string): Promise<Goal[]> {
  const res = await ddb.send(new QueryCommand({
    TableName: config.tableName,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': `GOAL#${sub}`, ':prefix': 'GOAL#' },
  }));
  const items = (res.Items ?? []) as Goal[];
  return items.filter((g) => !g.deletedAt);
}

export async function putGoal(goal: Goal): Promise<void> {
  await ddb.send(new PutCommand({
    TableName: config.tableName,
    Item: goal,
  }));
}

export async function updateGoal(
  sub: string,
  id: string,
  fields: { name: string; targetAmount: number; sortOrder: number; tracksAgainst: string; updatedAt: string; GSI1SK: string },
): Promise<void> {
  await ddb.send(new UpdateCommand({
    TableName: config.tableName,
    Key: { PK: `GOAL#${sub}`, SK: `GOAL#${id}` },
    UpdateExpression: 'SET #name = :name, targetAmount = :target, sortOrder = :order, tracksAgainst = :tracks, updatedAt = :updatedAt, GSI1SK = :gsi1sk',
    ExpressionAttributeNames: { '#name': 'name' },
    ExpressionAttributeValues: {
      ':name': fields.name,
      ':target': fields.targetAmount,
      ':order': fields.sortOrder,
      ':tracks': fields.tracksAgainst,
      ':updatedAt': fields.updatedAt,
      ':gsi1sk': fields.GSI1SK,
    },
  }));
}

export async function updateGoalStatus(
  sub: string,
  id: string,
  fields: { status: GoalStatus; updatedAt: string },
): Promise<void> {
  await ddb.send(new UpdateCommand({
    TableName: config.tableName,
    Key: { PK: `GOAL#${sub}`, SK: `GOAL#${id}` },
    UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: { ':status': fields.status, ':updatedAt': fields.updatedAt },
  }));
}

export async function softDelete(sub: string, id: string, deletedBy: string, deletedAt: string): Promise<void> {
  await ddb.send(new UpdateCommand({
    TableName: config.tableName,
    Key: { PK: `GOAL#${sub}`, SK: `GOAL#${id}` },
    UpdateExpression: 'SET deletedAt = :deletedAt, deletedBy = :deletedBy',
    ExpressionAttributeValues: { ':deletedAt': deletedAt, ':deletedBy': deletedBy },
  }));
}

export async function putSnapshot(snapshot: GoalSnapshot): Promise<void> {
  await ddb.send(new PutCommand({
    TableName: config.tableName,
    Item: snapshot,
  }));
}
