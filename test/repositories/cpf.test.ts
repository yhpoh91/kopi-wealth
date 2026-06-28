import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { getCpf, upsertCpf, putCpfSnapshot, querySnapshots } from '../../src/repositories/cpf';
import type { CPFAccount, CPFSnapshot } from '../../src/types/cpf';

const ddbMock = mockClient(DynamoDBDocumentClient);
beforeEach(() => ddbMock.reset());

const cpfAccount: CPFAccount = {
  PK: 'CPF#sub1', SK: 'CPF',
  sub: 'sub1', oa: 10000, sa: 20000, ma: 5000, ra: 0,
  createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
};

const snapshot: CPFSnapshot = {
  PK: 'CPF_SNAP#sub1', SK: 'SNAP#2024-01-01T00:00:00.000Z',
  sub: 'sub1', oa: 10000, sa: 20000, ma: 5000, ra: 0,
  recordedAt: '2024-01-01T00:00:00.000Z', createdAt: '2024-01-01T00:00:00.000Z',
};

describe('getCpf', () => {
  it('returns CPF account when found', async () => {
    ddbMock.on(GetCommand).resolves({ Item: cpfAccount });
    expect(await getCpf('sub1')).toEqual(cpfAccount);
  });
  it('returns null when not found', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    expect(await getCpf('sub1')).toBeNull();
  });
});

describe('upsertCpf', () => {
  it('calls PutCommand', async () => {
    ddbMock.on(PutCommand).resolves({});
    await expect(upsertCpf(cpfAccount)).resolves.toBeUndefined();
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(1);
  });
});

describe('putCpfSnapshot', () => {
  it('calls PutCommand', async () => {
    ddbMock.on(PutCommand).resolves({});
    await expect(putCpfSnapshot(snapshot)).resolves.toBeUndefined();
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(1);
  });
});

describe('querySnapshots', () => {
  it('returns snapshots in reverse order', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [snapshot] });
    const result = await querySnapshots('sub1');
    expect(result).toHaveLength(1);
    expect(result[0].sub).toBe('sub1');
  });
  it('returns empty array when no snapshots', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: undefined });
    expect(await querySnapshots('sub1')).toEqual([]);
  });
  it('passes limit to query', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    await querySnapshots('sub1', 6);
    const call = ddbMock.commandCalls(QueryCommand)[0];
    expect(call.args[0].input.Limit).toBe(6);
  });
});
