import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { queryIncomeByUser, getIncome, putIncome, updateIncome, softDeleteIncome } from '../../src/repositories/income';
import { toMonthlyAmount } from '../../src/types/income';
import type { IncomeSource } from '../../src/types/income';

vi.mock('../../src/lib/clock', () => ({
  clock: { nowIso: vi.fn(() => '2026-07-05T10:00:00.000Z'), today: vi.fn(() => '2026-07-05') },
}));

const ddbMock = mockClient(DynamoDBDocumentClient);
beforeEach(() => ddbMock.reset());

const source: IncomeSource = {
  PK: 'INCOME#sub1',
  SK: 'INCOME#id1',
  GSI1PK: 'USER#sub1',
  GSI1SK: 'INCOME#2026-07-05T10:00:00.000Z',
  id: 'id1',
  sub: 'sub1',
  type: 'salary',
  name: 'Main job',
  amount: 5000,
  currency: 'SGD',
  frequency: 'monthly',
  startDate: '2026-01-01',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const deletedSource: IncomeSource = {
  ...source,
  id: 'id2',
  SK: 'INCOME#id2',
  deletedAt: '2026-07-01T00:00:00.000Z',
  deletedBy: 'sub1',
};

describe('queryIncomeByUser', () => {
  it('returns non-deleted sources', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [source] });
    const result = await queryIncomeByUser('sub1');
    expect(result).toEqual([source]);
  });

  it('excludes soft-deleted sources', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [source, deletedSource] });
    const result = await queryIncomeByUser('sub1');
    expect(result).toEqual([source]);
  });

  it('returns empty array when Items is undefined', async () => {
    ddbMock.on(QueryCommand).resolves({});
    const result = await queryIncomeByUser('sub1');
    expect(result).toEqual([]);
  });

  it('queries with begins_with prefix', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    await queryIncomeByUser('sub1');
    const call = ddbMock.commandCalls(QueryCommand)[0];
    expect(call.args[0].input.ExpressionAttributeValues).toMatchObject({ ':prefix': 'INCOME#' });
  });
});

describe('getIncome', () => {
  it('returns source when found', async () => {
    ddbMock.on(GetCommand).resolves({ Item: source });
    expect(await getIncome('sub1', 'id1')).toEqual(source);
  });

  it('returns null when not found', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    expect(await getIncome('sub1', 'id1')).toBeNull();
  });
});

describe('putIncome', () => {
  it('calls PutCommand with item', async () => {
    ddbMock.on(PutCommand).resolves({});
    await putIncome(source);
    const calls = ddbMock.commandCalls(PutCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input.Item).toEqual(source);
  });
});

describe('updateIncome', () => {
  it('calls UpdateCommand with updated fields', async () => {
    ddbMock.on(UpdateCommand).resolves({});
    await updateIncome('sub1', 'id1', { type: 'rental', name: 'Condo', amount: 2200, frequency: 'monthly' });
    const calls = ddbMock.commandCalls(UpdateCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input.Key).toEqual({ PK: 'INCOME#sub1', SK: 'INCOME#id1' });
    expect(calls[0].args[0].input.ExpressionAttributeValues).toMatchObject({ ':amount': 2200, ':frequency': 'monthly' });
  });

  it('nullifies optional fields when omitted', async () => {
    ddbMock.on(UpdateCommand).resolves({});
    await updateIncome('sub1', 'id1', { type: 'salary', amount: 5000, frequency: 'monthly' });
    const vals = ddbMock.commandCalls(UpdateCommand)[0].args[0].input.ExpressionAttributeValues;
    expect(vals![':name']).toBeNull();
    expect(vals![':exchangeRate']).toBeNull();
    expect(vals![':startDate']).toBeNull();
    expect(vals![':endDate']).toBeNull();
    expect(vals![':notes']).toBeNull();
  });
});

describe('softDeleteIncome', () => {
  it('sets deletedAt and deletedBy', async () => {
    ddbMock.on(UpdateCommand).resolves({});
    await softDeleteIncome('sub1', 'id1', 'sub1');
    const calls = ddbMock.commandCalls(UpdateCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input.ExpressionAttributeValues).toMatchObject({
      ':deletedAt': '2026-07-05T10:00:00.000Z',
      ':deletedBy': 'sub1',
    });
  });
});

describe('toMonthlyAmount', () => {
  it('monthly → amount as-is', () => {
    expect(toMonthlyAmount({ ...source, frequency: 'monthly', amount: 5000 })).toBe(5000);
  });

  it('quarterly → amount / 3', () => {
    expect(toMonthlyAmount({ ...source, frequency: 'quarterly', amount: 9000 })).toBe(3000);
  });

  it('annual → amount / 12', () => {
    expect(toMonthlyAmount({ ...source, frequency: 'annual', amount: 60000 })).toBe(5000);
  });
});
