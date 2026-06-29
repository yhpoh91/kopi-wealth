import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { getInvestment, queryByUser, putInvestment, updateInvestment, softDelete, putSnapshot, querySnapshots } from '../../src/repositories/investment';
import type { Investment, InvestmentSnapshot } from '../../src/types/investment';

const ddbMock = mockClient(DynamoDBDocumentClient);
beforeEach(() => ddbMock.reset());

const investment: Investment = {
  PK: 'INVEST#sub1', SK: 'INVEST#id1',
  GSI1PK: 'USER#sub1', GSI1SK: 'INVEST#2024-01-01T00:00:00.000Z',
  id: 'id1', sub: 'sub1', name: 'IWDA', type: 'etf', currency: 'USD', value: 10000,
  createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
};

const deletedInvestment: Investment = { ...investment, id: 'id2', SK: 'INVEST#id2', deletedAt: '2024-02-01T00:00:00.000Z', deletedBy: 'sub1' };

const snapshot: InvestmentSnapshot = {
  PK: 'INVEST_SNAP#id1', SK: 'SNAP#2024-01-01T00:00:00.000Z#uuid1',
  investId: 'id1', value: 10000,
  recordedAt: '2024-01-01T00:00:00.000Z', createdAt: '2024-01-01T00:00:00.000Z',
};

describe('getInvestment', () => {
  it('returns investment when found', async () => {
    ddbMock.on(GetCommand).resolves({ Item: investment });
    expect(await getInvestment('sub1', 'id1')).toEqual(investment);
  });
  it('returns null when not found', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    expect(await getInvestment('sub1', 'id1')).toBeNull();
  });
});

describe('queryByUser', () => {
  it('returns active investments', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [investment] });
    const result = await queryByUser('sub1');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('id1');
  });
  it('excludes soft-deleted investments', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [investment, deletedInvestment] });
    const result = await queryByUser('sub1');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('id1');
  });
  it('returns empty array when no investments', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: undefined });
    expect(await queryByUser('sub1')).toEqual([]);
  });
});

describe('putInvestment', () => {
  it('calls PutCommand', async () => {
    ddbMock.on(PutCommand).resolves({});
    await expect(putInvestment(investment)).resolves.toBeUndefined();
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(1);
  });
});

describe('updateInvestment', () => {
  it('calls UpdateCommand', async () => {
    ddbMock.on(UpdateCommand).resolves({});
    await expect(updateInvestment('sub1', 'id1', { name: 'IWDA', type: 'etf', value: 12000 }, '2024-02-01T00:00:00.000Z')).resolves.toBeUndefined();
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(1);
  });
});

describe('softDelete', () => {
  it('calls UpdateCommand with deletedAt and deletedBy', async () => {
    ddbMock.on(UpdateCommand).resolves({});
    await expect(softDelete('sub1', 'id1', 'sub1', '2024-02-01T00:00:00.000Z')).resolves.toBeUndefined();
    const call = ddbMock.commandCalls(UpdateCommand)[0];
    expect(call.args[0].input.ExpressionAttributeValues).toMatchObject({
      ':deletedAt': '2024-02-01T00:00:00.000Z',
      ':deletedBy': 'sub1',
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

describe('querySnapshots', () => {
  it('returns snapshots', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [snapshot] });
    const result = await querySnapshots('id1');
    expect(result).toHaveLength(1);
    expect(result[0].investId).toBe('id1');
  });
  it('returns empty array when no snapshots', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: undefined });
    expect(await querySnapshots('id1')).toEqual([]);
  });
  it('passes limit to query', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    await querySnapshots('id1', 6);
    const call = ddbMock.commandCalls(QueryCommand)[0];
    expect(call.args[0].input.Limit).toBe(6);
  });
  it('uses ScanIndexForward false for reverse order', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    await querySnapshots('id1');
    const call = ddbMock.commandCalls(QueryCommand)[0];
    expect(call.args[0].input.ScanIndexForward).toBe(false);
  });
});
