import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { getFeatureFlag } from '../../src/repositories/featureFlag';
import type { FeatureFlag } from '../../src/types/featureFlag';

const ddbMock = mockClient(DynamoDBDocumentClient);
beforeEach(() => ddbMock.reset());

const flag: FeatureFlag = { PK: 'FEATURE#debugPanel', SK: 'FEATURE#debugPanel', name: 'debugPanel', enabled: true, createdAt: 'x', updatedAt: 'x' };

describe('getFeatureFlag', () => {
  it('gets FEATURE#{name} by key', async () => {
    ddbMock.on(GetCommand).resolves({ Item: flag });
    expect(await getFeatureFlag('debugPanel')).toEqual(flag);
    expect(ddbMock.commandCalls(GetCommand)[0].args[0].input.Key).toEqual({ PK: 'FEATURE#debugPanel', SK: 'FEATURE#debugPanel' });
  });
  it('returns null when missing', async () => {
    ddbMock.on(GetCommand).resolves({});
    expect(await getFeatureFlag('debugPanel')).toBeNull();
  });
  it('returns null when soft-deleted', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { ...flag, deletedAt: 'x' } });
    expect(await getFeatureFlag('debugPanel')).toBeNull();
  });
});
