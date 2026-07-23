import { describe, expect, test } from "bun:test";
import { buildCompletionCertificateDetails, normalizeCertificateName } from "./certificate-utils";
import type { RunSession } from "./types";

const finishedSession: RunSession = {
  sessionId: "session-1234-abcd-5678",
  trackId: "main",
  status: "finished",
  startedAt: Date.parse("2026-07-22T08:00:00.000Z"),
  endedAt: Date.parse("2026-07-22T08:30:00.000Z"),
  pausedAt: null,
  totalPausedMilliseconds: 0,
  distanceMeters: 3200,
  durationSeconds: 1800,
  averagePacePerKm: 9.375,
  maxPacePerKm: 10,
  closestIndex: 8,
  routeProgressMeters: 3200,
  samples: [],
  persisted: true,
};

describe("completion certificate", () => {
  test("normalizes participant names", () => {
    expect(normalizeCertificateName("  Made   Dimas  ")).toBe("Made Dimas");
  });

  test("builds certificate details for a finished session", () => {
    const details = buildCompletionCertificateDetails({
      participantName: "Made Dimas",
      trackName: "Singapadu Jogging Loop",
      session: finishedSession,
    });

    expect(details.participantName).toBe("Made Dimas");
    expect(details.distanceLabel).toBe("3.20 km");
    expect(details.durationLabel).toBe("00:30:00");
    expect(details.paceLabel).toBe("9:23 /km");
    expect(details.certificateId).toBe("JT-1234ABCD5678");
    expect(details.filename).toBe("sertifikat-joging-made-dimas-2026-07-22.png");
  });

  test("rejects empty names and unfinished sessions", () => {
    expect(() => buildCompletionCertificateDetails({
      participantName: "   ",
      trackName: "Main",
      session: finishedSession,
    })).toThrow();

    expect(() => buildCompletionCertificateDetails({
      participantName: "Made Dimas",
      trackName: "Main",
      session: { ...finishedSession, status: "paused", endedAt: null },
    })).toThrow();
  });
});
