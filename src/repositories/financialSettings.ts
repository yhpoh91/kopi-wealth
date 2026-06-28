import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from '../lib/ddb';
import { config } from '../config';
import type { FinancialSettings } from '../types/financialSettings';

export async function getSettings(sub: string): Promise<FinancialSettings | null> {
  const res = await ddb.send(new GetCommand({
    TableName: config.tableName,
    Key: { PK: `SETTINGS#${sub}`, SK: 'SETTINGS' },
  }));
  return (res.Item as FinancialSettings) ?? null;
}

export async function putSettings(settings: FinancialSettings): Promise<void> {
  await ddb.send(new PutCommand({
    TableName: config.tableName,
    Item: settings,
  }));
}
