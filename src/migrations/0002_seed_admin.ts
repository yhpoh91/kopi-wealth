import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from '../lib/ddb';

const TABLE = process.env.TABLE_NAME ?? `wealth-${process.env.STAGE ?? 'preview'}-data`;

export const id = '0002_seed_admin';
export const description = 'Seed admin user from ADMIN_SUB env var.';

export async function up(): Promise<void> {
  const adminSub = process.env.ADMIN_SUB;
  if (!adminSub) {
    console.log('  ADMIN_SUB not set — skipping admin seed.');
    return;
  }

  const pk = `USER#${adminSub}`;
  const existing = await ddb.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: pk, SK: pk },
  }));

  if (existing.Item) {
    if (existing.Item.role === 'admin') {
      console.log('  Admin user already has role=admin.');
      return;
    }
    await ddb.send(new PutCommand({
      TableName: TABLE,
      Item: { ...existing.Item, role: 'admin', updatedAt: new Date().toISOString() },
    }));
    console.log(`  Promoted existing user ${adminSub} to admin.`);
  } else {
    const now = new Date().toISOString();
    await ddb.send(new PutCommand({
      TableName: TABLE,
      Item: {
        PK: pk,
        SK: pk,
        GSI1PK: 'ALL_USERS',
        GSI1SK: pk,
        sub: adminSub,
        email: '',
        role: 'admin',
        createdAt: now,
        updatedAt: now,
      },
    }));
    console.log(`  Created admin user ${adminSub}.`);
  }
}

export async function down(): Promise<void> {
  // No-op — do not remove admin role automatically.
}
