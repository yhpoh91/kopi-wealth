import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { getUser, putUser } from '../../src/repositories/user';
import type { UserRecord } from '../../src/types';

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => ddbMock.reset());

const user: UserRecord = {
  PK: 'USER#sub1',
  SK: 'USER#sub1',
  GSI1PK: 'ALL_USERS',
  GSI1SK: 'USER#sub1',
  sub: 'sub1',
  email: 'user@example.com',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

describe('getUser', () => {
  it('returns user when found', async () => {
    ddbMock.on(GetCommand).resolves({ Item: user });
    const result = await getUser('sub1');
    expect(result).toEqual(user);
  });

  it('returns null when not found', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    const result = await getUser('missing');
    expect(result).toBeNull();
  });
});

describe('putUser', () => {
  it('calls PutCommand', async () => {
    ddbMock.on(PutCommand).resolves({});
    await expect(putUser(user)).resolves.toBeUndefined();
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(1);
  });
});
