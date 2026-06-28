import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import {
  getAccount, queryByUser, putAccount, updateAccount, softDelete, putSnapshot, querySnapshots,
} from '../../src/repositories/account';
import type { Account, AccountSnapshot } from '../../src/types/account';

const ddbMock = mockClient(DynamoDBDocumentClient);
beforeEach(() => ddbMock.reset());

const account: Account = {
  PK: 'ACCOUNT#sub1', SK: 'ACCOUNT#id1',
  GSI1PK: 'USER#sub1', GSI1SK: 'ACCOUNT#2024-01-01T00:00:00.000Z',
  id: 'id1', sub: 'sub1', name: 'DBS Savings', type: 'savings',
  balance: 10000, currency: 'SGD',
  createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
};

const snapshot: AccountSnapshot = {
  PK: 'ACCT_SNAP#id1', SK: 'SNAP#2024-01-01T00:00:00.000Z#uuid1',
  accountId: 'id1', balance: 10000,
  recordedAt: '2024-01-01T00:00:00.000Z', createdAt: '2024-01-01T00:00:00.000Z',
};

describe('getAccount', () => {
  it('returns account when found', async () => {
    ddbMock.on(GetCommand).resolves({ Item: account });
    expect(await getAccount('sub1', 'id1')).toEqual(account);
  });
  it('returns null when not found', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    expect(await getAccount('sub1', 'missing')).toBeNull();
  });
});

describe('queryByUser', () => {
  it('returns active accounts', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [account] });
    const result = await queryByUser('sub1');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('id1');
  });
  it('filters out deleted accounts', async () => {
    const deleted = { ...account, deletedAt: '2024-01-02T00:00:00.000Z' };
    ddbMock.on(QueryCommand).resolves({ Items: [account, deleted] });
    const result = await queryByUser('sub1');
    expect(result).toHaveLength(1);
  });
  it('returns empty array when no accounts', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    expect(await queryByUser('sub1')).toEqual([]);
  });
});

describe('putAccount', () => {
  it('calls PutCommand', async () => {
    ddbMock.on(PutCommand).resolves({});
    await expect(putAccount(account)).resolves.toBeUndefined();
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(1);
  });
});

describe('updateAccount', () => {
  it('calls UpdateCommand with all fields', async () => {
    ddbMock.on(UpdateCommand).resolves({});
    await expect(updateAccount('sub1', 'id1', { name: 'Updated', balance: 20000, institution: 'DBS', notes: 'note' }, '2024-01-02T00:00:00.000Z')).resolves.toBeUndefined();
    const call = ddbMock.commandCalls(UpdateCommand)[0];
    expect(call.args[0].input.ExpressionAttributeValues).toMatchObject({ ':name': 'Updated', ':balance': 20000 });
  });

  it('accepts undefined institution and notes', async () => {
    ddbMock.on(UpdateCommand).resolves({});
    await expect(updateAccount('sub1', 'id1', { name: 'X', balance: 100 }, '2024-01-02T00:00:00.000Z')).resolves.toBeUndefined();
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(1);
  });
});

describe('softDelete', () => {
  it('calls UpdateCommand with deletedAt and deletedBy', async () => {
    ddbMock.on(UpdateCommand).resolves({});
    await expect(softDelete('sub1', 'id1', 'sub1', '2024-01-02T00:00:00.000Z')).resolves.toBeUndefined();
    const call = ddbMock.commandCalls(UpdateCommand)[0];
    expect(call.args[0].input.ExpressionAttributeValues).toMatchObject({ ':deletedBy': 'sub1' });
  });
});

describe('putSnapshot', () => {
  it('calls PutCommand', async () => {
    ddbMock.on(PutCommand).resolves({});
    await expect(putSnapshot(snapshot)).resolves.toBeUndefined();
  });
});

describe('querySnapshots', () => {
  it('returns snapshots for account', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [snapshot] });
    const result = await querySnapshots('id1');
    expect(result).toHaveLength(1);
    expect(result[0].accountId).toBe('id1');
  });

  it('returns empty array when no snapshots', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: undefined });
    expect(await querySnapshots('id1')).toEqual([]);
  });
});

describe('queryByUser undefined Items', () => {
  it('returns empty array when Items is undefined', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: undefined });
    expect(await queryByUser('sub1')).toEqual([]);
  });
});
