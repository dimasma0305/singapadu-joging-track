import { describe, expect, test } from "bun:test";
import {
  hardenInitialSession,
  hardenSessionHistory,
  hardenSessionTransition,
} from "./session-state-integrity";
import type { RunSession } from "./types";

const createIdleSession = (sessionId = "idle"): RunSession => ({
  sessionId,
  trackId: "main",
  status: "idle",
  startedAt: null,
  endedAt: null,
  pausedAt: null,
  totalPausedMilliseconds: 0,
  distanceMeters: 0,
  durationSeconds: 0,
  averagePacePerKm: 0,
  maxPacePerKm: 0,
  closestIndex: 0,
  routeProgressMeters: 0,
  finishPosition: null,
  samples: [],
  persisted: false,
});

const createRunningSession = (
  overrides: Partial<RunSession> = {}
): RunSession => ({
  ...createIdleSession("run"),
  status: "running",
  startedAt: 1_000,
  distanceMeters: 100,
  durationSeconds: 60,
  averagePacePerKm: 10,
  maxPacePerKm: 10,
  closestIndex: 2,
  routeProgressMeters: 100,
  samples: [
    {
      lat: -8.58,
      lng: 115.26,
      accuracy: 8,
      routeProgressMeters: 100,
      timestamp: 61_000,
    },
  ],
  ...overrides,
});

describe("runtime session-state integrity", () => {
  test("accepts an authorized start and freezes cloned state", () => {
    const previous = createIdleSession();
    const candidate = createRunningSession();
    const result = hardenSessionTransition(previous, candidate);

    expect(result.valid).toBe(true);
    if (!result.valid) {
      return;
    }
    expect(Object.isFrozen(result.session)).toBe(true);
    expect(Object.isFrozen(result.session.samples)).toBe(true);
    expect(Object.isFrozen(result.session.samples[0])).toBe(true);
    expect(result.session).not.toBe(candidate);
  });

  test("rejects progress rollback and impossible coordinates", () => {
    const previous = createRunningSession();
    const rollback = createRunningSession({
      distanceMeters: 99,
      routeProgressMeters: 99,
    });
    const invalidGps = createRunningSession({
      samples: [{ lat: 120, lng: 115.26, timestamp: 62_000 }],
    });

    expect(hardenSessionTransition(previous, rollback)).toEqual({
      valid: false,
      reason: "Progres sesi tidak boleh bergerak mundur.",
    });
    const gpsResult = hardenSessionTransition(previous, invalidGps);
    expect(gpsResult.valid).toBe(false);
    if (!gpsResult.valid) {
      expect(gpsResult.reason).toContain("koordinat");
    }
  });

  test("rejects status jumps and unauthorized session replacement", () => {
    const previous = createRunningSession();
    const replaced = createIdleSession("replacement");
    const returnedToIdle = {
      ...previous,
      status: "idle" as const,
      startedAt: null,
      distanceMeters: 0,
      durationSeconds: 0,
      averagePacePerKm: 0,
      maxPacePerKm: 0,
      closestIndex: 0,
      routeProgressMeters: 0,
      samples: [],
    };

    expect(hardenSessionTransition(previous, replaced).valid).toBe(false);
    expect(hardenSessionTransition(previous, returnedToIdle).valid).toBe(
      false
    );
    expect(
      hardenSessionTransition(previous, replaced, {
        allowSessionReplacement: true,
      }).valid
    ).toBe(true);
  });

  test("permits the isolated functional test to normalize elapsed time", () => {
    const previous = createRunningSession({
      sessionId: "functional-test-123",
      startedAt: 50_000,
      totalPausedMilliseconds: 700,
    });
    const completed: RunSession = {
      ...previous,
      status: "finished",
      startedAt: 1_000,
      endedAt: 100_000,
      pausedAt: null,
      totalPausedMilliseconds: 0,
      durationSeconds: 99,
      finishPosition: previous.samples[0],
    };

    expect(hardenSessionTransition(previous, completed).valid).toBe(false);
    expect(
      hardenSessionTransition(previous, completed, {
        allowTimingNormalization: true,
      }).valid
    ).toBe(true);
  });

  test("validates and freezes the first in-memory state", () => {
    const initial = hardenInitialSession(createIdleSession());
    expect(initial.valid).toBe(true);
    if (initial.valid) {
      expect(Object.isFrozen(initial.session)).toBe(true);
    }
  });

  test("accepts only unique paused or finished sessions in history", () => {
    const finished: RunSession = {
      ...createRunningSession(),
      status: "finished",
      endedAt: 62_000,
      finishPosition: null,
      persisted: true,
    };
    const hardened = hardenSessionHistory([finished]);
    const duplicate = hardenSessionHistory([finished, finished]);
    const active = hardenSessionHistory([createRunningSession()]);

    expect(hardened.valid).toBe(true);
    if (hardened.valid) {
      expect(Object.isFrozen(hardened.sessions)).toBe(true);
      expect(Object.isFrozen(hardened.sessions[0])).toBe(true);
    }
    expect(duplicate.valid).toBe(false);
    expect(active.valid).toBe(false);
  });
});
