export const id = '0001_initial';
export const description = 'Initial schema — no DynamoDB migrations needed (table defined in CloudFormation).';

export async function up(): Promise<void> {
  // Table created via serverless.yml CloudFormation resources.
}

export async function down(): Promise<void> {
  // No-op.
}
