import { describe, expect, test } from "bun:test";
import type { RunSession } from "./types";
import {
  addSessionToHistory,
  parseSessionHistory,
  parseWarningHistory,
} from "./storage-utils";

const createFinishedSession = (
  sessionId: string,
  endedAt: number
): RunSession => ({
  sessionId,
  trackId: "main",
  status: "finished",
  startedAt: endedAt - 60_000,
  endedAt,
  pausedAt: null,
  totalPausedMilliseconds: 0,
  distanceMeters: 1_000,
  durationSeconds: 60,
  averagePacePerKm: 1,
  maxPacePerKm: 1,
  closestIndex: 8,
  routeProgressMeters: 1_000,
  samples: [{ lat: -6.2, lng: 106.8, timestamp: endedAt }],
  persisted: false,
});

const createPausedSession = (
  sessionId: string,
  pausedAt: number
): RunSession => ({
  ...createFinishedSession(sessionId, pausedAt),
  status: "paused",
  endedAt: null,
  pausedAt,
});

describe("run session history storage", () => {
  test("restores the most recently completed session first", () => {
    const older = createFinishedSession("older", 100_000);
    const latest = createFinishedSession("latest", 200_000);

    const restored = parseSessionHistory(JSON.stringify([older, latest]));

    expect(restored.map((session) => session.sessionId)).toEqual(["latest", "older"]);
  });

  test("restores a paused session as the latest saved snapshot", () => {
    const finished = createFinishedSession("finished", 100_000);
    const paused = createPausedSession("paused", 200_000);

    const restored = parseSessionHistory(JSON.stringify([finished, paused]));

    expect(restored.map((session) => session.sessionId)).toEqual(["paused", "finished"]);
    expect(restored[0].status).toBe("paused");
  });

  test("adds a paused or completed session once and keeps a compact summary", () => {
    const older = createFinishedSession("older", 100_000);
    const latest = createFinishedSession("latest", 200_000);

    const history = addSessionToHistory([older, latest], latest);

    expect(history.map((session) => session.sessionId)).toEqual(["latest", "older"]);
    expect(history[0].samples).toEqual([]);
    expect(history[0].persisted).toBe(true);
  });

  test("replaces a paused snapshot when the same session is completed", () => {
    const paused = createPausedSession("same-session", 100_000);
    const finished = createFinishedSession("same-session", 200_000);

    const history = addSessionToHistory([paused], finished);

    expect(history).toHaveLength(1);
    expect(history[0].status).toBe("finished");
    expect(history[0].endedAt).toBe(200_000);
  });

  test("ignores malformed, unfinished, and invalid storage values", () => {
    const unfinished = { ...createFinishedSession("running", 100_000), status: "running" };

    expect(parseSessionHistory("not-json")).toEqual([]);
    expect(parseSessionHistory(JSON.stringify([unfinished, { sessionId: "incomplete" }]))).toEqual([]);
  });
});

describe("warning history storage", () => {
  test("restores valid warning events", () => {
    const event = {
      areaId: "off-route",
      areaName: "Keluar Rute",
      message: "Kembali ke garis rute.",
      type: "warning",
      distanceMeters: 32,
      timestamp: 123456,
    };

    expect(parseWarningHistory(JSON.stringify([event]))).toEqual([event]);
  });

  test("ignores malformed or invalid storage values", () => {
    expect(parseWarningHistory("not-json")).toEqual([]);
    expect(parseWarningHistory(JSON.stringify([{ areaId: "incomplete" }]))).toEqual([]);
  });
});
