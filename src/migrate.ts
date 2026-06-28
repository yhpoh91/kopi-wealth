/**
 * Minimal migration runner.
 * Migrations are stored as MIGRATION#{id} items in the DynamoDB table.
 * Run: ts-node src/migrate.ts --stage <preview|prod> [--check] [--allow-destructive]
 */
import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from './lib/ddb';
import * as migration0001 from './migrations/0001_initial';
import * as migration0002 from './migrations/0002_seed_admin';

const ALL_MIGRATIONS = [migration0001, migration0002];

const args = process.argv.slice(2);
const stage = args.find((_, i) => args[i - 1] === '--stage') ?? 'preview';
const checkOnly = args.includes('--check');

const TABLE = `wealth-${stage}-data`;

async function getApplied(): Promise<Set<string>> {
  const res = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk',
    ExpressionAttributeValues: { ':pk': 'MIGRATIONS' },
  }));
  return new Set((res.Items ?? []).map((i) => i.SK as string));
}

async function main() {
  const applied = await getApplied();
  const pending = ALL_MIGRATIONS.filter((m) => !applied.has(m.id));

  if (pending.length === 0) {
    console.log('No pending migrations.');
    return;
  }

  if (checkOnly) {
    console.error(`Pending migrations: ${pending.map((m) => m.id).join(', ')}`);
    process.exit(1);
  }

  for (const m of pending) {
    console.log(`Applying ${m.id}: ${m.description}`);
    await m.up();
    await ddb.send(new PutCommand({
      TableName: TABLE,
      Item: { PK: 'MIGRATIONS', SK: m.id, appliedAt: new Date().toISOString() },
      ConditionExpression: 'attribute_not_exists(SK)',
    }));
    console.log(`  done.`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
