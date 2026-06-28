import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { getSession, putSession, deleteSession } from '../../src/repositories/session';
import type { SessionRecord } from '../../src/types';

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => ddbMock.reset());

const session: SessionRecord = {
  PK: 'SESSION#sess1',
  SK: 'SESSION#sess1',
  sessionId: 'sess1',
  sub: 'sub1',
  createdAt: '2024-01-01T00:00:00.000Z',
  ttl: 9999999999,
};

describe('getSession', () => {
  it('returns session when found and not deleted', async () => {
    ddbMock.on(GetCommand).resolves({ Item: session });
    const result = await getSession('sess1');
    expect(result).toEqual(session);
  });

  it('returns null when not found', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    expect(await getSession('missing')).toBeNull();
  });

  it('returns null for soft-deleted session', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { ...session, deletedAt: '2024-01-02T00:00:00.000Z' } });
    expect(await getSession('sess1')).toBeNull();
  });
});

describe('putSession', () => {
  it('calls PutCommand', async () => {
    ddbMock.on(PutCommand).resolves({});
    await expect(putSession(session)).resolves.toBeUndefined();
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(1);
  });
});

describe('deleteSession', () => {
  it('calls UpdateCommand with deletedAt and deletedBy', async () => {
    ddbMock.on(UpdateCommand).resolves({});
    await expect(deleteSession('sess1', 'sub1')).resolves.toBeUndefined();
    const calls = ddbMock.commandCalls(UpdateCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input.ExpressionAttributeValues![':db']).toBe('sub1');
  });
});
