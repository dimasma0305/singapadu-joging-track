import { describe, expect, test } from "bun:test";
import {
  buildLiveNotificationUpdateKey,
  buildRunNotificationPayload,
  findLatestCrossedCheckpoint,
} from "./notification-utils";

const metrics = {
  distanceMeters: 2345,
  durationSeconds: 845,
  averagePacePerKm: 6.02,
  completedLaps: 1,
  currentLapNumber: 2,
};

describe("run system notification content", () => {
  test("builds one replaceable live notification from current run metrics", () => {
    const payload = buildRunNotificationPayload({
      kind: "live",
      trackName: "Singapadu Tengah Run Track",
      metrics,
    });

    expect(payload.title).toBe("Lari aktif • Lap 2");
    expect(payload.body).toContain("2.35 km");
    expect(payload.body).toContain("00:14:05");
    expect(payload.body).toContain("Pace 6:01 /km");
    expect(payload.tag).toBe("joging-track-live");
    expect(payload.silent).toBe(true);
    expect(payload.requireInteraction).toBe(true);
  });

  test("keeps safety details visible and marks the alert for renotification", () => {
    const payload = buildRunNotificationPayload({
      kind: "off-route",
      title: "Keluar Rute",
      message: "Kembali ke garis biru untuk melanjutkan progres.",
      distanceMeters: 28.4,
    });

    expect(payload.title).toBe("Keluar dari lintasan");
    expect(payload.body).toContain("Kembali ke garis biru");
    expect(payload.body).toContain("Jarak 28 m");
    expect(payload.tag).toBe("joging-track-safety");
    expect(payload.renotify).toBe(true);
    expect(payload.requireInteraction).toBe(true);
  });

  test("updates live content only after a distance or time bucket changes", () => {
    expect(buildLiveNotificationUpdateKey(249, 59)).toBe("0:0");
    expect(buildLiveNotificationUpdateKey(250, 59)).toBe("1:0");
    expect(buildLiveNotificationUpdateKey(250, 60)).toBe("1:1");
  });
});

describe("checkpoint notification progression", () => {
  const checkpoints = [
    { id: "cp-1", name: "CP 1", routeIndex: 0 },
    { id: "cp-2", name: "CP 2", routeIndex: 1 },
    { id: "cp-3", name: "CP 3", routeIndex: 2 },
  ];
  const cumulativeDistances = [0, 300, 700, 1000];

  test("selects the latest checkpoint crossed by a GPS update", () => {
    const result = findLatestCrossedCheckpoint({
      previousProgressMeters: 250,
      currentProgressMeters: 760,
      lapDistanceMeters: 1000,
      isLoop: true,
      cumulativeDistances,
      checkpoints,
    });

    expect(result).toEqual({
      checkpoint: checkpoints[2],
      lapNumber: 1,
    });
  });

  test("repeats checkpoint events on the next lap without treating CP1 as crossed", () => {
    const result = findLatestCrossedCheckpoint({
      previousProgressMeters: 1000,
      currentProgressMeters: 1340,
      lapDistanceMeters: 1000,
      isLoop: true,
      cumulativeDistances,
      checkpoints,
    });

    expect(result).toEqual({
      checkpoint: checkpoints[1],
      lapNumber: 2,
    });
  });

  test("returns no checkpoint when progress does not move forward", () => {
    expect(
      findLatestCrossedCheckpoint({
        previousProgressMeters: 760,
        currentProgressMeters: 720,
        lapDistanceMeters: 1000,
        isLoop: true,
        cumulativeDistances,
        checkpoints,
      })
    ).toBeNull();
  });
});
