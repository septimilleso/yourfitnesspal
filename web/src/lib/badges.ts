export const BADGE_COUNT = 30;
export const DAYS_PER_BADGE = 5;
export const WORKOUTS_PER_BADGE = 10;

export interface BadgeProgress {
  /** Badges unlocked by the current value, 0..BADGE_COUNT. */
  earned: number;
  /** Units still needed for the next badge; null when all are earned. */
  nextIn: number | null;
}

export function badgeProgress(value: number, perBadge = DAYS_PER_BADGE): BadgeProgress {
  const current = Math.max(value, 0);
  const earned = Math.min(BADGE_COUNT, Math.floor(current / perBadge));
  const nextIn = earned === BADGE_COUNT ? null : (earned + 1) * perBadge - current;
  return { earned, nextIn };
}

export function gymBadgeProgress(workouts: number): BadgeProgress {
  return badgeProgress(workouts, WORKOUTS_PER_BADGE);
}
