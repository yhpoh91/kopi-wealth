import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { getLiability, queryByUser, putLiability, updateLiability, softDelete, putSnapshot } from '../../src/repositories/liability';
import type { Liability, LiabilitySnapshot } from '../../src/types/liability';

const ddbMock = mockClient(DynamoDBDocumentClient);
beforeEach(() => ddbMock.reset());

const liability: Liability = {
  PK: 'LIAB#sub1', SK: 'LIAB#id1',
  GSI1PK: 'USER#sub1', GSI1SK: 'LIAB#2024-01-01T00:00:00.000Z',
  id: 'id1', sub: 'sub1', name: 'Home Loan', type: 'mortgage', currency: 'SGD',
  originalAmount: 500000, outstandingAmount: 500000, status: 'outstanding',
  createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
};

const deletedLiability: Liability = { ...liability, id: 'id2', SK: 'LIAB#id2', deletedAt: '2024-02-01T00:00:00.000Z', deletedBy: 'sub1' };

const snapshot: LiabilitySnapshot = {
  PK: 'LIAB_SNAP#id1', SK: 'SNAP#2024-01-01T00:00:00.000Z#uuid1',
  liabId: 'id1', outstandingAmount: 500000, status: 'outstanding',
  recordedAt: '2024-01-01T00:00:00.000Z', createdAt: '2024-01-01T00:00:00.000Z',
};

describe('getLiability', () => {
  it('returns liability when found', async () => {
    ddbMock.on(GetCommand).resolves({ Item: liability });
    expect(await getLiability('sub1', 'id1')).toEqual(liability);
  });
  it('returns null when not found', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    expect(await getLiability('sub1', 'id1')).toBeNull();
  });
});

describe('queryByUser', () => {
  it('returns active liabilities', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [liability] });
    const result = await queryByUser('sub1');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('id1');
  });
  it('excludes soft-deleted liabilities', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [liability, deletedLiability] });
    const result = await queryByUser('sub1');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('id1');
  });
  it('returns empty array when no liabilities', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: undefined });
    expect(await queryByUser('sub1')).toEqual([]);
  });
  it('queries GSI1 with USER# prefix', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    await queryByUser('sub1');
    const call = ddbMock.commandCalls(QueryCommand)[0];
    expect(call.args[0].input.IndexName).toBe('GSI1');
    expect(call.args[0].input.ExpressionAttributeValues).toMatchObject({ ':pk': 'USER#sub1' });
  });
});

describe('putLiability', () => {
  it('calls PutCommand', async () => {
    ddbMock.on(PutCommand).resolves({});
    await expect(putLiability(liability)).resolves.toBeUndefined();
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(1);
  });
});

describe('updateLiability', () => {
  it('calls UpdateCommand with outstanding, status, updatedAt, GSI1SK', async () => {
    ddbMock.on(UpdateCommand).resolves({});
    await expect(updateLiability('sub1', 'id1', {
      outstandingAmount: 450000,
      status: 'partially_returned',
      updatedAt: '2024-02-01T00:00:00.000Z',
      GSI1SK: 'LIAB#2024-02-01T00:00:00.000Z',
    })).resolves.toBeUndefined();
    const call = ddbMock.commandCalls(UpdateCommand)[0];
    expect(call.args[0].input.ExpressionAttributeValues).toMatchObject({
      ':outstanding': 450000,
      ':status': 'partially_returned',
      ':updatedAt': '2024-02-01T00:00:00.000Z',
      ':gsi1sk': 'LIAB#2024-02-01T00:00:00.000Z',
    });
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
