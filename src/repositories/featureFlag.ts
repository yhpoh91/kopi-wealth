import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from '../lib/ddb';
import { config } from '../config';
import type { FeatureFlag } from '../types/featureFlag';

export async function getFeatureFlag(name: string): Promise<FeatureFlag | null> {
  const res = await ddb.send(new GetCommand({
    TableName: config.tableName,
    Key: { PK: `FEATURE#${name}`, SK: `FEATURE#${name}` },
  }));
  const item = res.Item as FeatureFlag | undefined;
  return item && !item.deletedAt ? item : null;
}
