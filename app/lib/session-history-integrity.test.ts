import { describe, expect, test } from "bun:test";
import {
  createEphemeralSigningIdentity,
  type DeviceSigningIdentity,
} from "./integrity-utils";
import {
  protectSessionHistory,
  restoreProtectedSessionHistory,
} from "./session-history-integrity";
import type { RunSession } from "./types";

const createFinishedSession = (
  sessionId = "signed-session"
): RunSession => ({
  sessionId,
  trackId: "main",
  status: "finished",
  startedAt: 1_000,
  endedAt: 61_000,
  pausedAt: null,
  totalPausedMilliseconds: 0,
  distanceMeters: 1_000,
  durationSeconds: 60,
  averagePacePerKm: 1,
  maxPacePerKm: 1,
  closestIndex: 8,
  routeProgressMeters: 1_000,
  finishPosition: {
    lat: -8.58,
    lng: 115.26,
    accuracy: 8,
    routeProgressMeters: 1_000,
    timestamp: 61_000,
  },
  samples: [],
  persisted: true,
});

const asExistingIdentity = (
  identity: DeviceSigningIdentity
): DeviceSigningIdentity => ({
  ...identity,
  created: false,
});

describe("protected session history", () => {
  test("round-trips a compact history only with its device key", async () => {
    const identity = await createEphemeralSigningIdentity();
    const protectedValue = await protectSessionHistory(
      [createFinishedSession()],
      25,
      identity
    );
    const restored = await restoreProtectedSessionHistory(
      protectedValue,
      25,
      identity
    );

    expect(protectedValue).not.toContain("signed-session");
    expect(restored.status).toBe("verified");
    expect(restored.fingerprint).toBe(identity.fingerprint);
    expect(restored.history.map((session) => session.sessionId)).toEqual([
      "signed-session",
    ]);
  });

  test("rejects a one-byte payload modification", async () => {
    const identity = await createEphemeralSigningIdentity();
    const protectedValue = await protectSessionHistory(
      [createFinishedSession()],
      25,
      identity
    );
    const envelope = JSON.parse(protectedValue) as {
      d: string;
      s: string;
      k: string;
    };
    const replacement = envelope.d[2] === "A" ? "B" : "A";
    envelope.d = `${envelope.d.slice(0, 2)}${replacement}${envelope.d.slice(3)}`;

    const restored = await restoreProtectedSessionHistory(
      JSON.stringify(envelope),
      25,
      identity
    );

    expect(restored.status).toBe("tampered");
    expect(restored.history).toEqual([]);
    expect(restored.message).toContain("Signature");
  });

  test("rejects history signed by another device identity", async () => {
    const signer = await createEphemeralSigningIdentity();
    const otherDevice = await createEphemeralSigningIdentity();
    const protectedValue = await protectSessionHistory(
      [createFinishedSession()],
      25,
      signer
    );

    const restored = await restoreProtectedSessionHistory(
      protectedValue,
      25,
      otherDevice
    );

    expect(restored.status).toBe("tampered");
    expect(restored.message).toContain("identitas perangkat lain");
  });

  test("migrates unsigned legacy history only while the key is first created", async () => {
    const identity = await createEphemeralSigningIdentity(true);
    const legacyValue = JSON.stringify([createFinishedSession("legacy")]);

    const migrated = await restoreProtectedSessionHistory(
      legacyValue,
      25,
      identity
    );
    const rejectedAfterMigration = await restoreProtectedSessionHistory(
      legacyValue,
      25,
      asExistingIdentity(identity)
    );

    expect(migrated.status).toBe("migrated");
    expect(migrated.migratedValue).toBeString();
    expect(migrated.history[0]?.sessionId).toBe("legacy");
    expect(rejectedAfterMigration.status).toBe("tampered");
    expect(rejectedAfterMigration.history).toEqual([]);
  });
});
