import {
  buildAchievementProgress,
  summarizeAchievements,
  type AchievementProgress,
  type AchievementSummary,
} from "./achievement-utils";
import { addSessionToHistory } from "./storage-utils";
import type { RunSession } from "./types";

const FUNCTIONAL_TEST_PACE_MINUTES_PER_KM = 8;

export type FunctionalTestHistoryUpdate = {
  nextHistory: RunSession[];
  progress: AchievementProgress[];
  summary: AchievementSummary;
  newlyUnlocked: AchievementProgress[];
  sessionRecorded: boolean;
};

export const createCompletedFunctionalTestSession = (
  current: RunSession,
  endedAt: number
): RunSession => {
  const distanceMeters = Math.max(0, current.distanceMeters);
  const durationSeconds = Math.max(
    1,
    Math.round(
      (distanceMeters / 1000) *
        FUNCTIONAL_TEST_PACE_MINUTES_PER_KM *
        60
    )
  );

  return {
    ...current,
    status: "finished",
    startedAt: Math.max(0, endedAt - durationSeconds * 1000),
    endedAt,
    pausedAt: null,
    totalPausedMilliseconds: 0,
    distanceMeters,
    durationSeconds,
    averagePacePerKm: FUNCTIONAL_TEST_PACE_MINUTES_PER_KM,
    maxPacePerKm: FUNCTIONAL_TEST_PACE_MINUTES_PER_KM,
    persisted: true,
  };
};

export const buildFunctionalTestHistoryUpdate = (
  currentHistory: RunSession[],
  completedSession: RunSession,
  limit: number
): FunctionalTestHistoryUpdate => {
  const previouslyUnlockedIds = new Set(
    buildAchievementProgress(currentHistory)
      .filter((entry) => entry.unlocked)
      .map((entry) => entry.definition.id)
  );
  const nextHistory = addSessionToHistory(
    currentHistory,
    completedSession,
    limit
  );
  const progress = buildAchievementProgress(nextHistory);

  return {
    nextHistory,
    progress,
    summary: summarizeAchievements(nextHistory),
    newlyUnlocked: progress.filter(
      (entry) =>
        entry.unlocked && !previouslyUnlockedIds.has(entry.definition.id)
    ),
    sessionRecorded: nextHistory.some(
      (entry) => entry.sessionId === completedSession.sessionId
    ),
  };
};
