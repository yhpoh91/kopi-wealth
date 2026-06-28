import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { getFxRate, putFxRate } from '../../src/repositories/fxRate';
import type { FxRateRecord } from '../../src/types/fxRate';

const ddbMock = mockClient(DynamoDBDocumentClient);
beforeEach(() => ddbMock.reset());

const record: FxRateRecord = {
  PK: 'FXRATE#SGD', SK: 'FXRATE#2024-01-01',
  baseCurrency: 'SGD', date: '2024-01-01',
  rates: { MYR: 3.45, USD: 0.74 },
  createdAt: '2024-01-01T00:00:00.000Z', ttl: 9999999999,
};

describe('getFxRate', () => {
  it('returns record when found', async () => {
    ddbMock.on(GetCommand).resolves({ Item: record });
    expect(await getFxRate('SGD', '2024-01-01')).toEqual(record);
  });
  it('returns null when not found', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    expect(await getFxRate('SGD', '2024-01-01')).toBeNull();
  });
});

describe('putFxRate', () => {
  it('calls PutCommand', async () => {
    ddbMock.on(PutCommand).resolves({});
    await expect(putFxRate(record)).resolves.toBeUndefined();
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(1);
  });
});
