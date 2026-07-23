import { describe, expect, test } from "bun:test";
import type { RunSession } from "./types";
import {
  buildFunctionalTestHistoryUpdate,
  createCompletedFunctionalTestSession,
} from "./functional-test-utils";

const createFinishedSession = (
  sessionId: string,
  endedAt: number
): RunSession => ({
  sessionId,
  trackId: "main",
  status: "finished",
  startedAt: endedAt - 1_200_000,
  endedAt,
  pausedAt: null,
  totalPausedMilliseconds: 0,
  distanceMeters: 2_500,
  durationSeconds: 1_200,
  averagePacePerKm: 8,
  maxPacePerKm: 8,
  closestIndex: 17,
  routeProgressMeters: 2_500,
  samples: [],
  persisted: true,
});

describe("functional test achievement history", () => {
  test("turns the accelerated simulation into a realistic finished run", () => {
    const endedAt = Date.UTC(2026, 6, 23, 8, 0);
    const runningSession: RunSession = {
      ...createFinishedSession("functional-test-1", endedAt),
      status: "running",
      startedAt: endedAt - 10_000,
      endedAt: null,
      durationSeconds: 10,
      averagePacePerKm: 0.07,
      maxPacePerKm: 0.07,
      persisted: true,
    };

    const completed = createCompletedFunctionalTestSession(
      runningSession,
      endedAt
    );

    expect(completed.status).toBe("finished");
    expect(completed.durationSeconds).toBe(1_200);
    expect(completed.averagePacePerKm).toBe(8);
    expect(completed.maxPacePerKm).toBe(8);
    expect(completed.startedAt).toBe(endedAt - 1_200_000);
  });

  test("records the first automatic test and unlocks the first-run badge", () => {
    const completed = createFinishedSession(
      "functional-test-1",
      Date.UTC(2026, 6, 23, 8, 0)
    );

    const update = buildFunctionalTestHistoryUpdate([], completed, 25);

    expect(update.sessionRecorded).toBe(true);
    expect(update.summary.completedRuns).toBe(1);
    expect(
      update.newlyUnlocked.map((entry) => entry.definition.id)
    ).toContain("first-run");
  });

  test("repeated automatic tests advance run-count achievements", () => {
    const history = [
      createFinishedSession("finished-1", Date.UTC(2026, 6, 21, 8, 0)),
      createFinishedSession("finished-2", Date.UTC(2026, 6, 22, 8, 0)),
    ];
    const completed = createFinishedSession(
      "functional-test-3",
      Date.UTC(2026, 6, 23, 8, 0)
    );

    const update = buildFunctionalTestHistoryUpdate(
      history,
      completed,
      25
    );

    expect(update.summary.completedRuns).toBe(3);
    expect(
      update.newlyUnlocked.map((entry) => entry.definition.id)
    ).toContain("bronze-runner");
  });
});
