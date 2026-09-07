/** In-memory session unlocks so rewarded gates are not repeated every tap. */

const unlocked = new Set<string>();

export function isAdUnlockActive(key: string): boolean {
  return unlocked.has(key);
}

export function markAdUnlocked(key: string): void {
  unlocked.add(key);
}

export const AD_UNLOCK_KEYS = {
  lmsStanding: 'lms:standing',
  t20Goalscorers: 't20:goalscorers',
} as const;
