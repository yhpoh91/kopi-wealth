import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { getSettings, putSettings } from '../../src/repositories/financialSettings';
import type { FinancialSettings } from '../../src/types/financialSettings';

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => ddbMock.reset());

const settings: FinancialSettings = {
  PK: 'SETTINGS#sub1',
  SK: 'SETTINGS',
  sub: 'sub1',
  currency: 'SGD',
  timezone: 'Asia/Singapore',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

describe('getSettings', () => {
  it('returns settings when found', async () => {
    ddbMock.on(GetCommand).resolves({ Item: settings });
    const result = await getSettings('sub1');
    expect(result).toEqual(settings);
  });

  it('returns null when not found', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    const result = await getSettings('missing');
    expect(result).toBeNull();
  });
});

describe('putSettings', () => {
  it('calls PutCommand', async () => {
    ddbMock.on(PutCommand).resolves({});
    await expect(putSettings(settings)).resolves.toBeUndefined();
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(1);
  });
});
