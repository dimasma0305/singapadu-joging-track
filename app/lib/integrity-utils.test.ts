import { describe, expect, test } from "bun:test";
import {
  compressDevicePublicKey,
  createEphemeralSigningIdentity,
  decompressDevicePublicKey,
  fingerprintPublicKey,
  importDeviceVerificationKey,
  signIntegrityPayload,
  verifyIntegrityPayload,
} from "./integrity-utils";

describe("client-side integrity primitives", () => {
  test("creates a non-exportable signing key with a stable public fingerprint", async () => {
    const identity = await createEphemeralSigningIdentity();
    const compressedPublicKey = compressDevicePublicKey(
      identity.publicKeyBytes
    );
    const decompressedPublicKey = decompressDevicePublicKey(
      compressedPublicKey
    );
    const importedPublicKey = await importDeviceVerificationKey(
      decompressedPublicKey
    );

    expect(identity.privateKey.extractable).toBe(false);
    expect(identity.privateKey.usages).toEqual(["sign"]);
    expect(identity.publicKeyBytes).toHaveLength(65);
    expect(compressedPublicKey).toHaveLength(33);
    expect(decompressedPublicKey).toEqual(
      identity.publicKeyBytes
    );
    expect(identity.fingerprint).toBe(
      await fingerprintPublicKey(identity.publicKeyBytes)
    );
    expect(importedPublicKey.usages).toEqual(["verify"]);
  });

  test("verifies the signed bytes only for the intended domain", async () => {
    const identity = await createEphemeralSigningIdentity();
    const payload = new TextEncoder().encode("signed runner data");
    const signature = await signIntegrityPayload({
      identity,
      payload,
      purpose: "profile-share",
    });

    expect(signature).toHaveLength(64);
    expect(
      await verifyIntegrityPayload({
        publicKey: identity.publicKey,
        payload,
        purpose: "profile-share",
        signature,
      })
    ).toBe(true);
    expect(
      await verifyIntegrityPayload({
        publicKey: identity.publicKey,
        payload,
        purpose: "session-history",
        signature,
      })
    ).toBe(false);

    const modifiedPayload = payload.slice();
    modifiedPayload[0] ^= 0x01;
    expect(
      await verifyIntegrityPayload({
        publicKey: identity.publicKey,
        payload: modifiedPayload,
        purpose: "profile-share",
        signature,
      })
    ).toBe(false);
  });

  test("rejects a signature made by a different device identity", async () => {
    const signer = await createEphemeralSigningIdentity();
    const otherDevice = await createEphemeralSigningIdentity();
    const payload = new TextEncoder().encode("history");
    const signature = await signIntegrityPayload({
      identity: signer,
      payload,
      purpose: "session-history",
    });

    expect(
      await verifyIntegrityPayload({
        publicKey: otherDevice.publicKey,
        payload,
        purpose: "session-history",
        signature,
      })
    ).toBe(false);
  });

  test("rejects malformed compressed public keys", () => {
    const invalidPrefix = new Uint8Array(33);
    invalidPrefix[0] = 0x04;
    const outOfRangeX = new Uint8Array(33);
    outOfRangeX.fill(0xff);
    outOfRangeX[0] = 0x02;

    expect(() =>
      decompressDevicePublicKey(invalidPrefix)
    ).toThrow("Kunci publik ringkas tidak valid");
    expect(() =>
      decompressDevicePublicKey(outOfRangeX)
    ).toThrow("Koordinat kunci publik berada di luar kurva");
  });
});
