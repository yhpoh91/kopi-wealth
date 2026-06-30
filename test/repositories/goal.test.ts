import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { getGoal, queryByUser, putGoal, updateGoal, updateGoalStatus, softDelete, putSnapshot } from '../../src/repositories/goal';
import type { Goal, GoalSnapshot } from '../../src/types/goal';

const ddbMock = mockClient(DynamoDBDocumentClient);
beforeEach(() => ddbMock.reset());

const goal: Goal = {
  PK: 'GOAL#sub1', SK: 'GOAL#id1',
  GSI1PK: 'USER#sub1', GSI1SK: 'GOAL#1#id1',
  id: 'id1', sub: 'sub1', name: 'Lean FIRE', type: 'lean_fire',
  tracksAgainst: 'net_worth', targetAmount: 500000, sortOrder: 1,
  status: 'active', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};

const deletedGoal: Goal = { ...goal, id: 'id2', SK: 'GOAL#id2', deletedAt: '2026-02-01T00:00:00.000Z', deletedBy: 'sub1' };

const snapshot: GoalSnapshot = {
  PK: 'GOAL_SNAP#id1', SK: 'SNAP#2026-06-30',
  goalId: 'id1', date: '2026-06-30', value: 250000, createdAt: '2026-06-30T00:00:00.000Z',
};

describe('getGoal', () => {
  it('returns goal when found', async () => {
    ddbMock.on(GetCommand).resolves({ Item: goal });
    expect(await getGoal('sub1', 'id1')).toEqual(goal);
  });
  it('returns null when not found', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    expect(await getGoal('sub1', 'id1')).toBeNull();
  });
});

describe('queryByUser', () => {
  it('returns active goals', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [goal] });
    const result = await queryByUser('sub1');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('id1');
  });
  it('excludes soft-deleted goals', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [goal, deletedGoal] });
    const result = await queryByUser('sub1');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('id1');
  });
  it('returns empty array when no goals', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: undefined });
    expect(await queryByUser('sub1')).toEqual([]);
  });
  it('queries main table with GOAL# prefix', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    await queryByUser('sub1');
    const call = ddbMock.commandCalls(QueryCommand)[0];
    expect(call.args[0].input.IndexName).toBeUndefined();
    expect(call.args[0].input.ExpressionAttributeValues).toMatchObject({ ':pk': 'GOAL#sub1', ':prefix': 'GOAL#' });
  });
});

describe('putGoal', () => {
  it('calls PutCommand', async () => {
    ddbMock.on(PutCommand).resolves({});
    await expect(putGoal(goal)).resolves.toBeUndefined();
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(1);
  });
});

describe('updateGoal', () => {
  it('calls UpdateCommand with correct fields', async () => {
    ddbMock.on(UpdateCommand).resolves({});
    await updateGoal('sub1', 'id1', {
      name: 'Updated', targetAmount: 600000, sortOrder: 2, tracksAgainst: 'investable_assets',
      updatedAt: '2026-06-30T00:00:00.000Z', GSI1SK: 'GOAL#2#id1',
    });
    const call = ddbMock.commandCalls(UpdateCommand)[0];
    expect(call.args[0].input.ExpressionAttributeValues).toMatchObject({
      ':name': 'Updated', ':target': 600000, ':order': 2,
      ':tracks': 'investable_assets', ':updatedAt': '2026-06-30T00:00:00.000Z',
    });
  });
});

describe('updateGoalStatus', () => {
  it('calls UpdateCommand with status and updatedAt', async () => {
    ddbMock.on(UpdateCommand).resolves({});
    await updateGoalStatus('sub1', 'id1', { status: 'achieved', updatedAt: '2026-06-30T00:00:00.000Z' });
    const call = ddbMock.commandCalls(UpdateCommand)[0];
    expect(call.args[0].input.ExpressionAttributeValues).toMatchObject({
      ':status': 'achieved', ':updatedAt': '2026-06-30T00:00:00.000Z',
    });
  });
});

describe('softDelete', () => {
  it('calls UpdateCommand with deletedAt and deletedBy', async () => {
    ddbMock.on(UpdateCommand).resolves({});
    await softDelete('sub1', 'id1', 'sub1', '2026-06-30T00:00:00.000Z');
    const call = ddbMock.commandCalls(UpdateCommand)[0];
    expect(call.args[0].input.ExpressionAttributeValues).toMatchObject({
      ':deletedAt': '2026-06-30T00:00:00.000Z', ':deletedBy': 'sub1',
    });
  });
});

describe('putSnapshot', () => {
  it('calls PutCommand', async () => {
    ddbMock.on(PutCommand).resolves({});
    await expect(putSnapshot(snapshot)).resolves.toBeUndefined();
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(1);
  });
});
