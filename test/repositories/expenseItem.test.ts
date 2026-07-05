import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { getExpenseItem, queryByUser, putExpenseItem, updateExpenseItem, softDeleteExpenseItem } from '../../src/repositories/expenseItem';
import type { ExpenseItem } from '../../src/types/expenseItem';

const ddbMock = mockClient(DynamoDBDocumentClient);
beforeEach(() => ddbMock.reset());

const item: ExpenseItem = {
  PK: 'EXPENSE_ITEM#sub1',
  SK: 'ITEM#2026-07-03#id1',
  id: 'id1',
  sub: 'sub1',
  amount: 12.5,
  currency: 'SGD',
  name: 'Lunch',
  date: '2026-07-03',
  createdAt: '2026-07-03T12:00:00.000Z',
  updatedAt: '2026-07-03T12:00:00.000Z',
};

const deletedItem: ExpenseItem = {
  ...item,
  id: 'id2',
  SK: 'ITEM#2026-07-03#id2',
  deletedAt: '2026-07-03T13:00:00.000Z',
  deletedBy: 'sub1',
};

describe('getExpenseItem', () => {
  it('returns item when found', async () => {
    ddbMock.on(GetCommand).resolves({ Item: item });
    expect(await getExpenseItem('sub1', '2026-07-03', 'id1')).toEqual(item);
  });
  it('returns null when not found', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    expect(await getExpenseItem('sub1', '2026-07-03', 'id1')).toBeNull();
  });
});

describe('queryByUser', () => {
  it('returns active items in reverse order', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [item] });
    const result = await queryByUser('sub1');
    expect(result.items).toEqual([item]);
  });

  it('returns empty array when no items', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    const result = await queryByUser('sub1');
    expect(result.items).toEqual([]);
  });

  it('returns empty array when Items is undefined', async () => {
    ddbMock.on(QueryCommand).resolves({});
    const result = await queryByUser('sub1');
    expect(result.items).toEqual([]);
  });

  it('indicates more items when over limit', async () => {
    const many = Array.from({ length: 32 }, (_, i) => ({ ...item, id: `id${i}`, SK: `ITEM#2026-07-03#id${i}` }));
    ddbMock.on(QueryCommand).resolves({ Items: many });
    const result = await queryByUser('sub1', { limit: 30 });
    expect(result.items).toHaveLength(30);
    expect(result.lastSK).toBeDefined();
  });

  it('returns no lastSK when at or under limit', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [item] });
    const result = await queryByUser('sub1', { limit: 30 });
    expect(result.lastSK).toBeUndefined();
  });

  it('uses before cursor for pagination', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [item] });
    const result = await queryByUser('sub1', { before: 'ITEM#2026-07-03#id1' });
    expect(result.items).toEqual([item]);
    const call = ddbMock.commandCalls(QueryCommand)[0];
    expect(call.args[0].input.KeyConditionExpression).toContain('SK < :before');
  });
});

describe('putExpenseItem', () => {
  it('calls PutCommand with item', async () => {
    ddbMock.on(PutCommand).resolves({});
    await putExpenseItem(item);
    const calls = ddbMock.commandCalls(PutCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input.Item).toEqual(item);
  });
});

describe('updateExpenseItem', () => {
  it('calls UpdateCommand with new fields', async () => {
    ddbMock.on(UpdateCommand).resolves({});
    await updateExpenseItem('sub1', '2026-07-03', 'id1', { name: 'Dinner', amount: 25 }, '2026-07-03T18:00:00.000Z');
    const calls = ddbMock.commandCalls(UpdateCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input.Key).toEqual({ PK: 'EXPENSE_ITEM#sub1', SK: 'ITEM#2026-07-03#id1' });
  });
});

describe('softDeleteExpenseItem', () => {
  it('calls UpdateCommand to set deletedAt and deletedBy', async () => {
    ddbMock.on(UpdateCommand).resolves({});
    await softDeleteExpenseItem('sub1', '2026-07-03', 'id1', 'sub1', '2026-07-03T20:00:00.000Z');
    const calls = ddbMock.commandCalls(UpdateCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input.ExpressionAttributeValues).toMatchObject({
      ':deletedAt': '2026-07-03T20:00:00.000Z',
      ':deletedBy': 'sub1',
    });
  });
});
