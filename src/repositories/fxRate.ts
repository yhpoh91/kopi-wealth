import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from '../lib/ddb';
import { config } from '../config';
import type { FxRateRecord } from '../types/fxRate';

export async function getFxRate(baseCurrency: string, date: string): Promise<FxRateRecord | null> {
  const res = await ddb.send(new GetCommand({
    TableName: config.tableName,
    Key: { PK: `FXRATE#${baseCurrency}`, SK: `FXRATE#${date}` },
  }));
  return (res.Item as FxRateRecord) ?? null;
}

export async function putFxRate(record: FxRateRecord): Promise<void> {
  await ddb.send(new PutCommand({
    TableName: config.tableName,
    Item: record,
  }));
}
