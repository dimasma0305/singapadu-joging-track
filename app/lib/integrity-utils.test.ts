import { describe, expect, test } from "bun:test";
import {
  createEphemeralSigningIdentity,
  fingerprintPublicKey,
  importDeviceVerificationKey,
  signIntegrityPayload,
  verifyIntegrityPayload,
} from "./integrity-utils";

describe("client-side integrity primitives", () => {
  test("creates a non-exportable signing key with a stable public fingerprint", async () => {
    const identity = await createEphemeralSigningIdentity();
    const importedPublicKey = await importDeviceVerificationKey(
      identity.publicKeyBytes
    );

    expect(identity.privateKey.extractable).toBe(false);
    expect(identity.privateKey.usages).toEqual(["sign"]);
    expect(identity.publicKeyBytes).toHaveLength(65);
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
});
