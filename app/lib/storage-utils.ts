import type { RunSession, WarningEvent } from "./types";

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isNonNegativeNumber = (value: unknown): value is number =>
  isFiniteNumber(value) && value >= 0;

const getSessionHistoryTimestamp = (session: RunSession): number =>
  session.status === "paused"
    ? session.pausedAt ?? session.startedAt ?? 0
    : session.endedAt ?? session.startedAt ?? 0;

const normalizeStoredSession = (value: unknown): RunSession | null => {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const session = value as Partial<RunSession>;
  const isFinished = session.status === "finished";
  const isPaused = session.status === "paused";
  if (
    typeof session.sessionId !== "string" ||
    session.sessionId.length === 0 ||
    typeof session.trackId !== "string" ||
    session.trackId.length === 0 ||
    (!isFinished && !isPaused) ||
    !isFiniteNumber(session.startedAt) ||
    (isFinished &&
      (!isFiniteNumber(session.endedAt) || session.endedAt < session.startedAt)) ||
    (isPaused &&
      (!isFiniteNumber(session.pausedAt) || session.pausedAt < session.startedAt)) ||
    !isNonNegativeNumber(session.distanceMeters) ||
    !isNonNegativeNumber(session.durationSeconds) ||
    !isNonNegativeNumber(session.averagePacePerKm)
  ) {
    return null;
  }

  return {
    sessionId: session.sessionId,
    trackId: session.trackId,
    status: isFinished ? "finished" : "paused",
    startedAt: session.startedAt,
    endedAt: isFinished && isFiniteNumber(session.endedAt) ? session.endedAt : null,
    pausedAt: isPaused && isFiniteNumber(session.pausedAt) ? session.pausedAt : null,
    totalPausedMilliseconds: isNonNegativeNumber(session.totalPausedMilliseconds)
      ? session.totalPausedMilliseconds
      : 0,
    distanceMeters: session.distanceMeters,
    durationSeconds: session.durationSeconds,
    averagePacePerKm: session.averagePacePerKm,
    maxPacePerKm: isNonNegativeNumber(session.maxPacePerKm)
      ? session.maxPacePerKm
      : session.averagePacePerKm,
    closestIndex: isNonNegativeNumber(session.closestIndex)
      ? Math.floor(session.closestIndex)
      : 0,
    routeProgressMeters: isNonNegativeNumber(session.routeProgressMeters)
      ? session.routeProgressMeters
      : session.distanceMeters,
    // The history screen only needs the summary. Omitting GPS samples keeps
    // localStorage small enough to retain multiple session snapshots reliably.
    samples: [],
    persisted: true,
  };
};

const normalizeSessionHistory = (values: unknown[], limit: number): RunSession[] => {
  const normalized = values
    .map(normalizeStoredSession)
    .filter((session): session is RunSession => session !== null)
    .sort((left, right) => getSessionHistoryTimestamp(right) - getSessionHistoryTimestamp(left));

  const uniqueSessions: RunSession[] = [];
  const seenSessionIds = new Set<string>();

  for (const session of normalized) {
    if (seenSessionIds.has(session.sessionId)) {
      continue;
    }
    seenSessionIds.add(session.sessionId);
    uniqueSessions.push(session);
  }

  return uniqueSessions.slice(0, Math.max(0, limit));
};

export const parseSessionHistory = (rawValue: string | null, limit = 25): RunSession[] => {
  if (!rawValue) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(rawValue);
    return Array.isArray(parsed) ? normalizeSessionHistory(parsed, limit) : [];
  } catch {
    return [];
  }
};

export const addSessionToHistory = (
  history: RunSession[],
  sessionSnapshot: RunSession,
  limit = 25
): RunSession[] => normalizeSessionHistory([sessionSnapshot, ...history], limit);

const isWarningEvent = (value: unknown): value is WarningEvent => {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const event = value as Partial<WarningEvent>;
  return (
    typeof event.areaId === "string" &&
    typeof event.areaName === "string" &&
    typeof event.message === "string" &&
    (event.type === "info" || event.type === "warning" || event.type === "critical") &&
    typeof event.distanceMeters === "number" &&
    Number.isFinite(event.distanceMeters) &&
    typeof event.timestamp === "number" &&
    Number.isFinite(event.timestamp)
  );
};

export const parseWarningHistory = (rawValue: string | null, limit = 15): WarningEvent[] => {
  if (!rawValue) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isWarningEvent).slice(0, Math.max(0, limit));
  } catch {
    return [];
  }
};
