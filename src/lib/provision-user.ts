import { getUser, putUser } from '../repositories/user';
import { queryByUser as queryGoals } from '../repositories/goal';
import { seedDefaultGoals } from '../handlers/goals';
import type { UserRecord } from '../types';

export interface IdTokenClaims {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
}

// JIT user provisioning shared by the web callback and POST /v1/auth/token: creates the user on
// first sign-in, syncs email/name/picture on every sign-in, and seeds default goals when none exist.
export async function provisionUser(claims: IdTokenClaims, now: string): Promise<UserRecord> {
  let user = await getUser(claims.sub);
  const isNewUser = !user;
  if (!user) {
    user = {
      PK: `USER#${claims.sub}`,
      SK: `USER#${claims.sub}`,
      GSI1PK: 'ALL_USERS',
      GSI1SK: `USER#${claims.sub}`,
      sub: claims.sub,
      email: claims.email,
      name: claims.name,
      picture: claims.picture,
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
    };
  } else {
    user = { ...user, lastSeenAt: now, updatedAt: now };
    if (claims.email !== user.email) user = { ...user, email: claims.email };
    if (claims.name !== undefined) user = { ...user, name: claims.name };
    user = { ...user, picture: claims.picture };
  }
  await putUser(user);

  if (isNewUser) {
    await seedDefaultGoals(claims.sub, now);
  } else {
    const existingGoals = await queryGoals(claims.sub);
    if (existingGoals.length === 0) {
      await seedDefaultGoals(claims.sub, now);
    }
  }
  return user;
}
