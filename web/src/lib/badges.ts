export const BADGE_COUNT = 30;
export const DAYS_PER_BADGE = 5;

export interface BadgeProgress {
  /** Badges unlocked by the current streak, 0..BADGE_COUNT. */
  earned: number;
  /** Days of streak still needed for the next badge; null when all are earned. */
  nextIn: number | null;
}

export function badgeProgress(current: number): BadgeProgress {
  const earned = Math.min(BADGE_COUNT, Math.floor(Math.max(current, 0) / DAYS_PER_BADGE));
  const nextIn = earned === BADGE_COUNT ? null : (earned + 1) * DAYS_PER_BADGE - Math.max(current, 0);
  return { earned, nextIn };
}
