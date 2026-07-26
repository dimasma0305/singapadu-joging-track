import { describe, expect, test } from "bun:test";
import {
  completeSessionAtPosition,
  resolvePrimarySessionControl,
} from "./session-control-utils";
import type { RunSession } from "./types";

describe("single contextual session control", () => {
  test("maps every session condition to one primary action", () => {
    expect(
      resolvePrimarySessionControl({
        status: "idle",
        isTesting: false,
      })
    ).toEqual({ mode: "start", label: "Mulai Sesi Lari" });
    expect(
      resolvePrimarySessionControl({
        status: "running",
        isTesting: false,
      })
    ).toEqual({ mode: "pause", label: "Jeda Sesi" });
    expect(
      resolvePrimarySessionControl({
        status: "paused",
        isTesting: false,
      })
    ).toEqual({ mode: "resume", label: "Lanjutkan Sesi" });
    expect(
      resolvePrimarySessionControl({
        status: "finished",
        isTesting: false,
      })
    ).toEqual({ mode: "start", label: "Mulai Lari Baru" });
    expect(
      resolvePrimarySessionControl({
        status: "running",
        isTesting: true,
      })
    ).toEqual({ mode: "stop", label: "Hentikan Pengujian" });
  });

  test("finishes at the latest GPS position without requiring the route endpoint", () => {
    const runningSession: RunSession = {
      sessionId: "free-finish",
      trackId: "main",
      status: "running",
      startedAt: 1_000,
      endedAt: null,
      pausedAt: null,
      totalPausedMilliseconds: 0,
      distanceMeters: 500,
      durationSeconds: 30,
      averagePacePerKm: 1,
      maxPacePerKm: 1,
      closestIndex: 4,
      routeProgressMeters: 500,
      finishPosition: null,
      samples: [],
      persisted: false,
    };
    const arbitraryRoutePosition = {
      lat: -8.5842,
      lng: 115.2575,
      accuracy: 8,
      timestamp: 61_000,
    };

    const finished = completeSessionAtPosition({
      session: runningSession,
      endedAt: 61_000,
      position: arbitraryRoutePosition,
    });

    expect(finished.status).toBe("finished");
    expect(finished.distanceMeters).toBe(500);
    expect(finished.finishPosition).toEqual({
      ...arbitraryRoutePosition,
      routeProgressMeters: 500,
    });
    expect(finished.endedAt).toBe(61_000);
  });
});
