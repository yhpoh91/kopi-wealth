import { createHash } from 'node:crypto';
import { getFeatureFlag } from '../repositories/featureFlag';
import type { FeatureFlag } from '../types/featureFlag';

// Stable 0-99 bucket per (flag, user), so a rollout percentage keeps the same users on.
function bucket(name: string, sub: string): number {
  return createHash('sha256').update(`${name}:${sub}`).digest().readUInt32BE(0) % 100;
}

export function evaluateFlag(flag: FeatureFlag | null, sub: string): boolean {
  if (!flag || !flag.enabled) return false;
  if (flag.blockedSubs?.includes(sub)) return false;
  if (flag.allowedSubs?.includes(sub)) return true;
  if (flag.rolloutPercent === undefined) return true;
  return bucket(flag.name, sub) < flag.rolloutPercent;
}

// A missing, deleted or unreadable flag is off: flags never break the page they decorate.
export async function isFeatureEnabled(name: string, sub: string): Promise<boolean> {
  try {
    return evaluateFlag(await getFeatureFlag(name), sub);
  } catch {
    return false;
  }
}
