import type { RunSession } from "./types";
import { formatDistance, formatDuration, formatPace } from "./track-utils";

export type AchievementId =
  | "first-run"
  | "bronze-runner"
  | "silver-runner"
  | "gold-runner"
  | "route-legend"
  | "distance-10k"
  | "distance-50k"
  | "pace-six";

export type AchievementTier = "bronze" | "silver" | "gold" | "platinum" | "special";
export type AchievementIconName = "footprints" | "medal" | "trophy" | "crown" | "route" | "flame" | "zap";
export type AchievementRequirementKind = "runs" | "distance" | "pace";

export type AchievementDefinition = {
  id: AchievementId;
  title: string;
  description: string;
  tier: AchievementTier;
  icon: AchievementIconName;
  requirement: {
    kind: AchievementRequirementKind;
    target: number;
  };
};

export type AchievementSummary = {
  completedRuns: number;
  totalDistanceMeters: number;
  totalDurationSeconds: number;
  averagePaceSecondsPerKm: number;
  bestPaceSecondsPerKm: number;
  longestRunMeters: number;
  latestRunAt: number | null;
};

export type AchievementProgress = {
  definition: AchievementDefinition;
  unlocked: boolean;
  unlockedAt: number | null;
  currentValue: number;
  targetValue: number;
  progressPercent: number;
  progressLabel: string;
};

export type AchievementSharePayload = {
  achievementId: AchievementId;
  runnerName: string;
  completedRuns: number;
  totalDistanceMeters: number;
  bestPaceSecondsPerKm: number;
  achievedAt: number;
};

export type DecodedAchievementShare = AchievementSharePayload & {
  achievement: AchievementDefinition;
  protocolVersion: number;
};

export type AchievementShareOutcome = "shared" | "copied" | "cancelled" | "unavailable";

export type AchievementShareResult = {
  outcome: AchievementShareOutcome;
  url: string;
};

export type AchievementCollectionSharePayload = {
  runnerName: string;
  unlockedAchievementIds: AchievementId[];
  completedRuns: number;
  totalDistanceMeters: number;
  totalDurationSeconds: number;
  averagePaceSecondsPerKm: number;
  bestPaceSecondsPerKm: number;
  longestRunMeters: number;
  latestRunAt: number;
};

export type DecodedAchievementCollectionShare = AchievementCollectionSharePayload & {
  achievements: AchievementDefinition[];
  protocolVersion: number;
};

const SHARE_PROTOCOL_VERSION = 1;
const SHARE_HASH_PREFIX = "#a=";
const COLLECTION_SHARE_PROTOCOL_VERSION = 1;
const COLLECTION_SHARE_HASH_PREFIX = "#p=";
const DAY_MILLISECONDS = 86_400_000;
const PROTOCOL_EPOCH_DAY = Math.floor(Date.UTC(2020, 0, 1) / DAY_MILLISECONDS);
const MAX_RUNS = 100_000;
const MAX_DISTANCE_DECAMETERS = 10_000_000;
const MAX_PACE_SECONDS = 7_200;
const MAX_NAME_BYTES = 160;
const MAX_TOKEN_LENGTH = 320;
const MAX_ACHIEVEMENT_DAY_OFFSET = 16_383;
const MAX_DURATION_DECASECONDS = 100_000_000;

// The array order is part of compact share protocol v1. Append new definitions;
// never reorder existing entries without introducing a new protocol version.
export const ACHIEVEMENT_DEFINITIONS: readonly AchievementDefinition[] = [
  {
    id: "first-run",
    title: "Langkah Pertama",
    description: "Selesaikan run pertama di rute Singapadu.",
    tier: "bronze",
    icon: "footprints",
    requirement: { kind: "runs", target: 1 },
  },
  {
    id: "bronze-runner",
    title: "Bronze Runner",
    description: "Selesaikan 3 kali run.",
    tier: "bronze",
    icon: "medal",
    requirement: { kind: "runs", target: 3 },
  },
  {
    id: "silver-runner",
    title: "Silver Runner",
    description: "Selesaikan 5 kali run.",
    tier: "silver",
    icon: "medal",
    requirement: { kind: "runs", target: 5 },
  },
  {
    id: "gold-runner",
    title: "Gold Runner",
    description: "Selesaikan 10 kali run.",
    tier: "gold",
    icon: "trophy",
    requirement: { kind: "runs", target: 10 },
  },
  {
    id: "route-legend",
    title: "Legenda Rute",
    description: "Selesaikan 25 kali run.",
    tier: "platinum",
    icon: "crown",
    requirement: { kind: "runs", target: 25 },
  },
  {
    id: "distance-10k",
    title: "Penjelajah 10K",
    description: "Kumpulkan total jarak 10 kilometer.",
    tier: "special",
    icon: "route",
    requirement: { kind: "distance", target: 10_000 },
  },
  {
    id: "distance-50k",
    title: "Jarak Membara",
    description: "Kumpulkan total jarak 50 kilometer.",
    tier: "gold",
    icon: "flame",
    requirement: { kind: "distance", target: 50_000 },
  },
  {
    id: "pace-six",
    title: "Speedster 6:00",
    description: "Catat pace rata-rata 6:00/km atau lebih cepat.",
    tier: "special",
    icon: "zap",
    requirement: { kind: "pace", target: 360 },
  },
] as const;

const getCompletedSessions = (
  sessions: RunSession[]
): Array<RunSession & { endedAt: number }> =>
  sessions
    .filter(
      (session): session is RunSession & { endedAt: number } =>
        session.status === "finished" &&
        typeof session.endedAt === "number" &&
        Number.isFinite(session.endedAt)
    )
    .sort((left, right) => left.endedAt - right.endedAt);

export const normalizeRunnerName = (value: string): string =>
  Array.from(
    value
      .normalize("NFKC")
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .trim()
      .replace(/\s+/g, " ")
  )
    .slice(0, 40)
    .join("");

export const summarizeAchievements = (sessions: RunSession[]): AchievementSummary => {
  const completed = getCompletedSessions(sessions);
  let totalDistanceMeters = 0;
  let totalDurationSeconds = 0;
  let bestPaceSecondsPerKm = 0;
  let longestRunMeters = 0;

  for (const session of completed) {
    const sessionDistance = Math.max(0, session.distanceMeters);
    const sessionDuration = Math.max(0, session.durationSeconds);
    totalDistanceMeters += sessionDistance;
    totalDurationSeconds += sessionDuration;
    longestRunMeters = Math.max(longestRunMeters, sessionDistance);

    const validPaces = [session.averagePacePerKm, session.maxPacePerKm]
      .filter((pace) => pace > 0 && Number.isFinite(pace));
    if (validPaces.length > 0) {
      const paceSeconds = Math.round(Math.min(...validPaces) * 60);
      if (bestPaceSecondsPerKm === 0 || paceSeconds < bestPaceSecondsPerKm) {
        bestPaceSecondsPerKm = paceSeconds;
      }
    }
  }

  return {
    completedRuns: completed.length,
    totalDistanceMeters: Math.round(totalDistanceMeters),
    totalDurationSeconds: Math.round(totalDurationSeconds),
    averagePaceSecondsPerKm:
      totalDistanceMeters > 0 && totalDurationSeconds > 0
        ? Math.round((totalDurationSeconds / totalDistanceMeters) * 1000)
        : 0,
    bestPaceSecondsPerKm,
    longestRunMeters: Math.round(longestRunMeters),
    latestRunAt: completed.at(-1)?.endedAt ?? null,
  };
};

const resolveUnlockedAt = (
  definition: AchievementDefinition,
  sessions: Array<RunSession & { endedAt: number }>
): number | null => {
  const { kind, target } = definition.requirement;

  if (kind === "runs") {
    return sessions[target - 1]?.endedAt ?? null;
  }

  if (kind === "distance") {
    let accumulatedDistance = 0;
    for (const session of sessions) {
      accumulatedDistance += Math.max(0, session.distanceMeters);
      if (accumulatedDistance >= target) {
        return session.endedAt;
      }
    }
    return null;
  }

  const paceSession = sessions.find(
    (session) =>
      session.averagePacePerKm > 0 &&
      Math.round(session.averagePacePerKm * 60) <= target
  );
  return paceSession?.endedAt ?? null;
};

const buildProgressLabel = (
  kind: AchievementRequirementKind,
  currentValue: number,
  targetValue: number
): string => {
  if (kind === "runs") {
    return `${Math.min(currentValue, targetValue)} dari ${targetValue} run selesai`;
  }
  if (kind === "distance") {
    return `${formatDistance(Math.min(currentValue, targetValue))} dari ${formatDistance(targetValue)}`;
  }
  if (currentValue <= 0) {
    return `Belum ada pace valid · target ${formatPace(targetValue / 60)}`;
  }
  return `Pace terbaik ${formatPace(currentValue / 60)} · target ${formatPace(targetValue / 60)}`;
};

export const buildAchievementProgress = (sessions: RunSession[]): AchievementProgress[] => {
  const completed = getCompletedSessions(sessions);
  const summary = summarizeAchievements(completed);

  return ACHIEVEMENT_DEFINITIONS.map((definition) => {
    const { kind, target } = definition.requirement;
    const currentValue =
      kind === "runs"
        ? summary.completedRuns
        : kind === "distance"
          ? summary.totalDistanceMeters
          : summary.bestPaceSecondsPerKm;
    const unlockedAt = resolveUnlockedAt(definition, completed);
    const progressPercent =
      kind === "pace"
        ? currentValue > 0
          ? Math.min(100, (target / currentValue) * 100)
          : 0
        : Math.min(100, (currentValue / target) * 100);

    return {
      definition,
      unlocked: unlockedAt !== null,
      unlockedAt,
      currentValue,
      targetValue: target,
      progressPercent,
      progressLabel: buildProgressLabel(kind, currentValue, target),
    };
  });
};

export const createAchievementSharePayload = (
  progress: AchievementProgress,
  summary: AchievementSummary,
  runnerName: string
): AchievementSharePayload => {
  if (!progress.unlocked || !progress.unlockedAt) {
    throw new Error("Achievement ini belum terbuka.");
  }

  return {
    achievementId: progress.definition.id,
    runnerName: normalizeRunnerName(runnerName),
    completedRuns: summary.completedRuns,
    totalDistanceMeters: summary.totalDistanceMeters,
    bestPaceSecondsPerKm: summary.bestPaceSecondsPerKm,
    achievedAt: progress.unlockedAt,
  };
};

const writeVarUint = (bytes: number[], value: number) => {
  let remaining = Math.max(0, Math.floor(value));
  do {
    const current = remaining % 128;
    remaining = Math.floor(remaining / 128);
    bytes.push(remaining > 0 ? current | 0x80 : current);
  } while (remaining > 0);
};

const readVarUint = (
  bytes: Uint8Array,
  cursor: { value: number },
  dataEnd: number
): number => {
  let result = 0;
  let multiplier = 1;

  for (let index = 0; index < 5; index += 1) {
    if (cursor.value >= dataEnd) {
      throw new Error("Payload achievement terpotong.");
    }
    const byte = bytes[cursor.value];
    cursor.value += 1;
    result += (byte & 0x7f) * multiplier;
    if ((byte & 0x80) === 0) {
      return result;
    }
    multiplier *= 128;
  }

  throw new Error("Nilai payload achievement terlalu besar.");
};

const calculateCrc16 = (bytes: ArrayLike<number>, length = bytes.length): number => {
  let crc = 0xffff;
  for (let index = 0; index < length; index += 1) {
    crc ^= bytes[index] << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) !== 0 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc;
};

const encodeBase64Url = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
};

const decodeBase64Url = (token: string): Uint8Array => {
  if (!token || token.length > MAX_TOKEN_LENGTH || !/^[A-Za-z0-9_-]+$/.test(token)) {
    throw new Error("Token achievement tidak valid.");
  }

  const padded = token.replace(/-/g, "+").replace(/_/g, "/")
    .padEnd(Math.ceil(token.length / 4) * 4, "=");
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new Error("Token achievement bukan Base64URL yang valid.");
  }

  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const getAchievementIndex = (achievementId: AchievementId): number => {
  const index = ACHIEVEMENT_DEFINITIONS.findIndex((entry) => entry.id === achievementId);
  if (index < 0 || index > 15) {
    throw new Error("Achievement tidak didukung protokol share.");
  }
  return index;
};

const validatePayload = (payload: AchievementSharePayload) => {
  const definition = ACHIEVEMENT_DEFINITIONS[getAchievementIndex(payload.achievementId)];
  const nameBytes = new TextEncoder().encode(normalizeRunnerName(payload.runnerName));
  const achievedDay = Math.floor(payload.achievedAt / DAY_MILLISECONDS) - PROTOCOL_EPOCH_DAY;
  const validNumbers =
    Number.isInteger(payload.completedRuns) &&
    payload.completedRuns >= 0 &&
    payload.completedRuns <= MAX_RUNS &&
    Number.isFinite(payload.totalDistanceMeters) &&
    payload.totalDistanceMeters >= 0 &&
    Math.round(payload.totalDistanceMeters / 10) <= MAX_DISTANCE_DECAMETERS &&
    Number.isInteger(payload.bestPaceSecondsPerKm) &&
    payload.bestPaceSecondsPerKm >= 0 &&
    payload.bestPaceSecondsPerKm <= MAX_PACE_SECONDS &&
    Number.isFinite(payload.achievedAt) &&
    achievedDay >= 0 &&
    achievedDay <= MAX_ACHIEVEMENT_DAY_OFFSET;

  if (!validNumbers || nameBytes.length > MAX_NAME_BYTES) {
    throw new Error("Data achievement berada di luar batas protokol.");
  }

  const { kind, target } = definition.requirement;
  const satisfiesAchievement =
    kind === "runs"
      ? payload.completedRuns >= target
      : kind === "distance"
        ? payload.totalDistanceMeters >= target
        : payload.bestPaceSecondsPerKm > 0 && payload.bestPaceSecondsPerKm <= target;

  if (!satisfiesAchievement) {
    throw new Error("Statistik pada tautan tidak memenuhi achievement.");
  }
};

export const encodeAchievementShare = (payload: AchievementSharePayload): string => {
  const normalizedPayload = {
    ...payload,
    runnerName: normalizeRunnerName(payload.runnerName),
    completedRuns: Math.round(payload.completedRuns),
    totalDistanceMeters: Math.round(payload.totalDistanceMeters),
    bestPaceSecondsPerKm: Math.round(payload.bestPaceSecondsPerKm),
  };
  validatePayload(normalizedPayload);

  const achievementIndex = getAchievementIndex(normalizedPayload.achievementId);
  const achievedDay = Math.floor(normalizedPayload.achievedAt / DAY_MILLISECONDS) - PROTOCOL_EPOCH_DAY;
  if (achievedDay < 0 || achievedDay > MAX_ACHIEVEMENT_DAY_OFFSET) {
    throw new Error("Tanggal achievement tidak didukung protokol.");
  }

  const nameBytes = new TextEncoder().encode(normalizedPayload.runnerName);
  const data: number[] = [(SHARE_PROTOCOL_VERSION << 4) | achievementIndex];
  writeVarUint(data, normalizedPayload.completedRuns);
  // Ten-meter precision is sufficient for a public badge and saves URL bytes.
  writeVarUint(data, Math.round(normalizedPayload.totalDistanceMeters / 10));
  writeVarUint(data, normalizedPayload.bestPaceSecondsPerKm);
  writeVarUint(data, achievedDay);
  writeVarUint(data, nameBytes.length);
  data.push(...nameBytes);

  const checksum = calculateCrc16(data);
  data.push((checksum >> 8) & 0xff, checksum & 0xff);
  return encodeBase64Url(Uint8Array.from(data));
};

export const decodeAchievementShare = (token: string): DecodedAchievementShare => {
  const bytes = decodeBase64Url(token);
  if (bytes.length < 8) {
    throw new Error("Payload achievement terlalu pendek.");
  }

  const dataEnd = bytes.length - 2;
  const expectedChecksum = (bytes[dataEnd] << 8) | bytes[dataEnd + 1];
  const actualChecksum = calculateCrc16(bytes, dataEnd);
  if (expectedChecksum !== actualChecksum) {
    throw new Error("Checksum achievement tidak cocok.");
  }

  const header = bytes[0];
  const protocolVersion = header >> 4;
  const achievementIndex = header & 0x0f;
  if (protocolVersion !== SHARE_PROTOCOL_VERSION) {
    throw new Error("Versi tautan achievement belum didukung.");
  }

  const achievement = ACHIEVEMENT_DEFINITIONS[achievementIndex];
  if (!achievement) {
    throw new Error("Achievement pada tautan tidak dikenal.");
  }

  const cursor = { value: 1 };
  const completedRuns = readVarUint(bytes, cursor, dataEnd);
  const totalDistanceMeters = readVarUint(bytes, cursor, dataEnd) * 10;
  const bestPaceSecondsPerKm = readVarUint(bytes, cursor, dataEnd);
  const achievedDay = readVarUint(bytes, cursor, dataEnd);
  const nameLength = readVarUint(bytes, cursor, dataEnd);

  if (nameLength > MAX_NAME_BYTES || cursor.value + nameLength !== dataEnd) {
    throw new Error("Panjang nama pada payload achievement tidak valid.");
  }

  let runnerName = "";
  try {
    runnerName = new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.slice(cursor.value, cursor.value + nameLength)
    );
  } catch {
    throw new Error("Nama pelari pada payload achievement tidak valid.");
  }

  const payload: AchievementSharePayload = {
    achievementId: achievement.id,
    runnerName: normalizeRunnerName(runnerName),
    completedRuns,
    totalDistanceMeters,
    bestPaceSecondsPerKm,
    achievedAt: (achievedDay + PROTOCOL_EPOCH_DAY) * DAY_MILLISECONDS,
  };
  validatePayload(payload);

  return {
    ...payload,
    achievement,
    protocolVersion,
  };
};

export const decodeAchievementHash = (hash: string): DecodedAchievementShare | null => {
  if (!hash.startsWith(SHARE_HASH_PREFIX)) {
    return null;
  }
  return decodeAchievementShare(hash.slice(SHARE_HASH_PREFIX.length));
};

const getAchievementMask = (achievementIds: AchievementId[]): number => {
  const uniqueIds = new Set(achievementIds);
  let mask = 0;
  for (const achievementId of uniqueIds) {
    mask |= 1 << getAchievementIndex(achievementId);
  }
  return mask;
};

const getAchievementIdsFromMask = (mask: number): AchievementId[] =>
  ACHIEVEMENT_DEFINITIONS
    .filter((_, index) => (mask & (1 << index)) !== 0)
    .map((definition) => definition.id);

const validateCollectionPayload = (payload: AchievementCollectionSharePayload) => {
  const achievementMask = getAchievementMask(payload.unlockedAchievementIds);
  const supportedMask = (1 << ACHIEVEMENT_DEFINITIONS.length) - 1;
  const nameBytes = new TextEncoder().encode(normalizeRunnerName(payload.runnerName));
  const latestRunDay = Math.floor(payload.latestRunAt / DAY_MILLISECONDS) - PROTOCOL_EPOCH_DAY;
  const validNumbers =
    achievementMask > 0 &&
    (achievementMask & ~supportedMask) === 0 &&
    Number.isInteger(payload.completedRuns) &&
    payload.completedRuns > 0 &&
    payload.completedRuns <= MAX_RUNS &&
    Number.isFinite(payload.totalDistanceMeters) &&
    payload.totalDistanceMeters >= 0 &&
    Math.round(payload.totalDistanceMeters / 10) <= MAX_DISTANCE_DECAMETERS &&
    Number.isFinite(payload.totalDurationSeconds) &&
    payload.totalDurationSeconds >= 0 &&
    Math.round(payload.totalDurationSeconds / 10) <= MAX_DURATION_DECASECONDS &&
    Number.isInteger(payload.averagePaceSecondsPerKm) &&
    payload.averagePaceSecondsPerKm >= 0 &&
    payload.averagePaceSecondsPerKm <= MAX_PACE_SECONDS &&
    Number.isInteger(payload.bestPaceSecondsPerKm) &&
    payload.bestPaceSecondsPerKm >= 0 &&
    payload.bestPaceSecondsPerKm <= MAX_PACE_SECONDS &&
    Number.isFinite(payload.longestRunMeters) &&
    payload.longestRunMeters >= 0 &&
    Math.round(payload.longestRunMeters / 10) <= MAX_DISTANCE_DECAMETERS &&
    Number.isFinite(payload.latestRunAt) &&
    latestRunDay >= 0 &&
    latestRunDay <= MAX_ACHIEVEMENT_DAY_OFFSET;

  if (!validNumbers || nameBytes.length > MAX_NAME_BYTES) {
    throw new Error("Data ringkasan achievement berada di luar batas protokol.");
  }

  for (const achievementId of payload.unlockedAchievementIds) {
    const definition = ACHIEVEMENT_DEFINITIONS[getAchievementIndex(achievementId)];
    const { kind, target } = definition.requirement;
    const satisfiesAchievement =
      kind === "runs"
        ? payload.completedRuns >= target
        : kind === "distance"
          ? payload.totalDistanceMeters >= target
          : payload.bestPaceSecondsPerKm > 0 && payload.bestPaceSecondsPerKm <= target;
    if (!satisfiesAchievement) {
      throw new Error(`Statistik tidak memenuhi achievement ${definition.title}.`);
    }
  }
};

export const createAchievementCollectionSharePayload = (
  progress: AchievementProgress[],
  summary: AchievementSummary,
  runnerName: string
): AchievementCollectionSharePayload => {
  const unlockedAchievementIds = progress
    .filter((entry) => entry.unlocked)
    .map((entry) => entry.definition.id);

  if (unlockedAchievementIds.length === 0 || !summary.latestRunAt) {
    throw new Error("Belum ada achievement yang dapat dibagikan.");
  }

  const payload: AchievementCollectionSharePayload = {
    runnerName: normalizeRunnerName(runnerName),
    unlockedAchievementIds,
    completedRuns: summary.completedRuns,
    totalDistanceMeters: summary.totalDistanceMeters,
    totalDurationSeconds: summary.totalDurationSeconds,
    averagePaceSecondsPerKm: summary.averagePaceSecondsPerKm,
    bestPaceSecondsPerKm: summary.bestPaceSecondsPerKm,
    longestRunMeters: summary.longestRunMeters,
    latestRunAt: summary.latestRunAt,
  };
  validateCollectionPayload(payload);
  return payload;
};

export const encodeAchievementCollectionShare = (
  payload: AchievementCollectionSharePayload
): string => {
  const normalizedPayload: AchievementCollectionSharePayload = {
    ...payload,
    runnerName: normalizeRunnerName(payload.runnerName),
    unlockedAchievementIds: [...new Set(payload.unlockedAchievementIds)],
    completedRuns: Math.round(payload.completedRuns),
    totalDistanceMeters: Math.round(payload.totalDistanceMeters),
    totalDurationSeconds: Math.round(payload.totalDurationSeconds),
    averagePaceSecondsPerKm: Math.round(payload.averagePaceSecondsPerKm),
    bestPaceSecondsPerKm: Math.round(payload.bestPaceSecondsPerKm),
    longestRunMeters: Math.round(payload.longestRunMeters),
  };
  validateCollectionPayload(normalizedPayload);

  const latestRunDay =
    Math.floor(normalizedPayload.latestRunAt / DAY_MILLISECONDS) - PROTOCOL_EPOCH_DAY;
  const nameBytes = new TextEncoder().encode(normalizedPayload.runnerName);
  const data: number[] = [
    COLLECTION_SHARE_PROTOCOL_VERSION,
    getAchievementMask(normalizedPayload.unlockedAchievementIds),
  ];
  writeVarUint(data, normalizedPayload.completedRuns);
  writeVarUint(data, Math.round(normalizedPayload.totalDistanceMeters / 10));
  writeVarUint(data, Math.round(normalizedPayload.totalDurationSeconds / 10));
  writeVarUint(data, normalizedPayload.averagePaceSecondsPerKm);
  writeVarUint(data, normalizedPayload.bestPaceSecondsPerKm);
  writeVarUint(data, Math.round(normalizedPayload.longestRunMeters / 10));
  writeVarUint(data, latestRunDay);
  writeVarUint(data, nameBytes.length);
  data.push(...nameBytes);

  const checksum = calculateCrc16(data);
  data.push((checksum >> 8) & 0xff, checksum & 0xff);
  return encodeBase64Url(Uint8Array.from(data));
};

export const decodeAchievementCollectionShare = (
  token: string
): DecodedAchievementCollectionShare => {
  const bytes = decodeBase64Url(token);
  if (bytes.length < 12) {
    throw new Error("Payload ringkasan achievement terlalu pendek.");
  }

  const dataEnd = bytes.length - 2;
  const expectedChecksum = (bytes[dataEnd] << 8) | bytes[dataEnd + 1];
  const actualChecksum = calculateCrc16(bytes, dataEnd);
  if (expectedChecksum !== actualChecksum) {
    throw new Error("Checksum ringkasan achievement tidak cocok.");
  }

  const protocolVersion = bytes[0];
  if (protocolVersion !== COLLECTION_SHARE_PROTOCOL_VERSION) {
    throw new Error("Versi ringkasan achievement belum didukung.");
  }

  const achievementMask = bytes[1];
  const unlockedAchievementIds = getAchievementIdsFromMask(achievementMask);
  if (unlockedAchievementIds.length === 0) {
    throw new Error("Ringkasan achievement tidak memiliki badge.");
  }

  const cursor = { value: 2 };
  const completedRuns = readVarUint(bytes, cursor, dataEnd);
  const totalDistanceMeters = readVarUint(bytes, cursor, dataEnd) * 10;
  const totalDurationSeconds = readVarUint(bytes, cursor, dataEnd) * 10;
  const averagePaceSecondsPerKm = readVarUint(bytes, cursor, dataEnd);
  const bestPaceSecondsPerKm = readVarUint(bytes, cursor, dataEnd);
  const longestRunMeters = readVarUint(bytes, cursor, dataEnd) * 10;
  const latestRunDay = readVarUint(bytes, cursor, dataEnd);
  const nameLength = readVarUint(bytes, cursor, dataEnd);

  if (nameLength > MAX_NAME_BYTES || cursor.value + nameLength !== dataEnd) {
    throw new Error("Panjang nama pada ringkasan achievement tidak valid.");
  }

  let runnerName = "";
  try {
    runnerName = new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.slice(cursor.value, cursor.value + nameLength)
    );
  } catch {
    throw new Error("Nama pelari pada ringkasan achievement tidak valid.");
  }

  const payload: AchievementCollectionSharePayload = {
    runnerName: normalizeRunnerName(runnerName),
    unlockedAchievementIds,
    completedRuns,
    totalDistanceMeters,
    totalDurationSeconds,
    averagePaceSecondsPerKm,
    bestPaceSecondsPerKm,
    longestRunMeters,
    latestRunAt: (latestRunDay + PROTOCOL_EPOCH_DAY) * DAY_MILLISECONDS,
  };
  validateCollectionPayload(payload);

  return {
    ...payload,
    achievements: unlockedAchievementIds.map(
      (achievementId) => ACHIEVEMENT_DEFINITIONS[getAchievementIndex(achievementId)]
    ),
    protocolVersion,
  };
};

export const decodeAchievementCollectionHash = (
  hash: string
): DecodedAchievementCollectionShare | null => {
  if (!hash.startsWith(COLLECTION_SHARE_HASH_PREFIX)) {
    return null;
  }
  return decodeAchievementCollectionShare(hash.slice(COLLECTION_SHARE_HASH_PREFIX.length));
};

export const buildAchievementCollectionShareUrl = (
  baseUrl: string,
  payload: AchievementCollectionSharePayload
): string => {
  const url = new URL(baseUrl);
  url.search = "";
  url.hash = `p=${encodeAchievementCollectionShare(payload)}`;
  return url.toString();
};

export const buildAchievementCollectionShareText = (
  payload: AchievementCollectionSharePayload,
  trackName: string
): string => {
  const owner = normalizeRunnerName(payload.runnerName) || "Seorang pelari";
  return `${owner} telah menyelesaikan ${payload.completedRuns} run di ${trackName}, ` +
    `total ${formatDistance(payload.totalDistanceMeters)} dalam ` +
    `${formatDuration(payload.totalDurationSeconds)}, pace rata-rata ` +
    `${formatPace(payload.averagePaceSecondsPerKm / 60)}, dan membuka ` +
    `${payload.unlockedAchievementIds.length} achievement.`;
};

export const buildAchievementShareUrl = (
  baseUrl: string,
  payload: AchievementSharePayload
): string => {
  const url = new URL(baseUrl);
  url.search = "";
  url.hash = `a=${encodeAchievementShare(payload)}`;
  return url.toString();
};

export const buildAchievementShareText = (
  payload: AchievementSharePayload,
  trackName: string
): string => {
  const definition = ACHIEVEMENT_DEFINITIONS[getAchievementIndex(payload.achievementId)];
  const owner = normalizeRunnerName(payload.runnerName) || "Seorang pelari";
  const paceLabel =
    payload.bestPaceSecondsPerKm > 0
      ? `, pace terbaik ${formatPace(payload.bestPaceSecondsPerKm / 60)}`
      : "";
  return `${owner} meraih achievement ${definition.title} di ${trackName}: ` +
    `${payload.completedRuns} run, total ${formatDistance(payload.totalDistanceMeters)}${paceLabel}.`;
};

const copyTextFallback = (value: string): boolean => {
  if (typeof document === "undefined") {
    return false;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
};

export const shareAchievementLink = async ({
  payload,
  baseUrl,
  trackName,
}: {
  payload: AchievementSharePayload;
  baseUrl: string;
  trackName: string;
}): Promise<AchievementShareResult> => {
  const url = buildAchievementShareUrl(baseUrl, payload);
  const definition = ACHIEVEMENT_DEFINITIONS[getAchievementIndex(payload.achievementId)];
  const data: ShareData = {
    title: `Achievement ${definition.title}`,
    text: buildAchievementShareText(payload, trackName),
    url,
  };

  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share(data);
      return { outcome: "shared", url };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return { outcome: "cancelled", url };
      }
    }
  }

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(url);
      return { outcome: "copied", url };
    } catch {
      // Continue to the DOM copy fallback for older/restricted browsers.
    }
  }

  return {
    outcome: copyTextFallback(url) ? "copied" : "unavailable",
    url,
  };
};

export const shareAchievementCollectionLink = async ({
  payload,
  baseUrl,
  trackName,
}: {
  payload: AchievementCollectionSharePayload;
  baseUrl: string;
  trackName: string;
}): Promise<AchievementShareResult> => {
  const url = buildAchievementCollectionShareUrl(baseUrl, payload);
  const data: ShareData = {
    title: `Run Achievement Summary · ${trackName}`,
    text: buildAchievementCollectionShareText(payload, trackName),
    url,
  };

  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share(data);
      return { outcome: "shared", url };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return { outcome: "cancelled", url };
      }
    }
  }

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(url);
      return { outcome: "copied", url };
    } catch {
      // Continue to the DOM copy fallback for restricted browsers.
    }
  }

  return {
    outcome: copyTextFallback(url) ? "copied" : "unavailable",
    url,
  };
};
