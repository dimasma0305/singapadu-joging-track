import { describe, expect, test } from "bun:test";
import {
  buildAchievementProgress,
  buildAchievementShareUrl,
  createAchievementSharePayload,
  decodeAchievementHash,
  decodeAchievementShare,
  encodeAchievementShare,
  normalizeRunnerName,
  summarizeAchievements,
} from "./achievement-utils";
import type { RunSession } from "./types";

const createFinishedSession = (
  index: number,
  overrides: Partial<RunSession> = {}
): RunSession => ({
  sessionId: `finished-${index}`,
  trackId: "main",
  status: "finished",
  startedAt: Date.UTC(2026, 6, index + 1, 6, 0),
  endedAt: Date.UTC(2026, 6, index + 1, 6, 30),
  pausedAt: null,
  totalPausedMilliseconds: 0,
  distanceMeters: 3200,
  durationSeconds: 1800,
  averagePacePerKm: 9.375,
  maxPacePerKm: 9.375,
  closestIndex: 8,
  routeProgressMeters: 3200,
  samples: [],
  persisted: true,
  ...overrides,
});

describe("achievement progress", () => {
  test("unlocks run-count and cumulative-distance milestones", () => {
    const sessions = Array.from({ length: 5 }, (_, index) => createFinishedSession(index));
    const progress = buildAchievementProgress(sessions);
    const byId = Object.fromEntries(progress.map((entry) => [entry.definition.id, entry]));

    expect(byId["first-run"].unlocked).toBe(true);
    expect(byId["bronze-runner"].unlocked).toBe(true);
    expect(byId["silver-runner"].unlocked).toBe(true);
    expect(byId["gold-runner"].unlocked).toBe(false);
    expect(byId["distance-10k"].unlocked).toBe(true);
    expect(byId["distance-10k"].unlockedAt).toBe(sessions[3].endedAt);
    expect(byId["distance-50k"].unlocked).toBe(false);
  });

  test("unlocks the pace badge from the fastest finished run only", () => {
    const sessions = [
      createFinishedSession(0),
      createFinishedSession(1, { averagePacePerKm: 5.8 }),
      { ...createFinishedSession(2, { averagePacePerKm: 4.5 }), status: "paused" as const, endedAt: null, pausedAt: Date.now() },
    ];
    const pace = buildAchievementProgress(sessions)
      .find((entry) => entry.definition.id === "pace-six");
    const summary = summarizeAchievements(sessions);

    expect(pace?.unlocked).toBe(true);
    expect(pace?.unlockedAt).toBe(sessions[1].endedAt);
    expect(summary.completedRuns).toBe(2);
    expect(summary.bestPaceSecondsPerKm).toBe(348);
  });
});

describe("compact achievement share protocol", () => {
  const sessions = Array.from({ length: 10 }, (_, index) =>
    createFinishedSession(index, {
      averagePacePerKm: index === 8 ? 5.75 : 9.375,
    })
  );
  const summary = summarizeAchievements(sessions);
  const gold = buildAchievementProgress(sessions)
    .find((entry) => entry.definition.id === "gold-runner");

  test("normalizes display names without losing Indonesian characters", () => {
    expect(normalizeRunnerName("  Ni   Luh Éka  ")).toBe("Ni Luh Éka");
  });

  test("round-trips a binary Base64URL payload with checksum", () => {
    expect(gold).toBeDefined();
    const payload = createAchievementSharePayload(gold!, summary, "Ni Luh Éka");
    const token = encodeAchievementShare(payload);
    const decoded = decodeAchievementShare(token);

    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeLessThan(64);
    expect(decoded.achievement.id).toBe("gold-runner");
    expect(decoded.runnerName).toBe("Ni Luh Éka");
    expect(decoded.completedRuns).toBe(10);
    expect(decoded.totalDistanceMeters).toBe(32_000);
    expect(decoded.bestPaceSecondsPerKm).toBe(345);
    expect(decoded.achievedAt).toBe(Date.UTC(2026, 6, 10));
  });

  test("builds a short self-contained hash URL", () => {
    const payload = createAchievementSharePayload(gold!, summary, "Made");
    const url = buildAchievementShareUrl(
      "https://example.com/joging?track=main",
      payload
    );
    const parsed = new URL(url);

    expect(parsed.search).toBe("");
    expect(parsed.hash.startsWith("#a=")).toBe(true);
    expect(url.length).toBeLessThan(100);
    expect(decodeAchievementHash(parsed.hash)?.achievementId).toBe("gold-runner");
    expect(decodeAchievementHash("#section")).toBeNull();
  });

  test("rejects a token changed after creation", () => {
    const payload = createAchievementSharePayload(gold!, summary, "Made");
    const token = encodeAchievementShare(payload);
    const replacement = token.endsWith("A") ? "B" : "A";

    expect(() => decodeAchievementShare(`${token.slice(0, -1)}${replacement}`)).toThrow(
      "Checksum achievement tidak cocok"
    );
  });
});
