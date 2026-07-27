import {
  decodeBase64UrlBytes,
  encodeBase64UrlBytes,
  getOrCreateDeviceSigningIdentity,
  INTEGRITY_SIGNATURE_BYTES,
  signIntegrityPayload,
  verifyIntegrityPayload,
  type DeviceSigningIdentity,
} from "./integrity-utils";
import { parseSessionHistory } from "./storage-utils";
import type { RunSession } from "./types";

const MAX_PROTECTED_HISTORY_LENGTH = 250_000;

type ProtectedHistoryEnvelope = {
  d: string;
  s: string;
  k: string;
};

export type SessionHistoryIntegrityStatus =
  | "empty"
  | "verified"
  | "migrated"
  | "tampered"
  | "unavailable";

export type SessionHistoryIntegrityResult = {
  history: RunSession[];
  status: SessionHistoryIntegrityStatus;
  fingerprint: string | null;
  migratedValue?: string;
  message?: string;
};

const isProtectedHistoryEnvelope = (
  value: unknown
): value is ProtectedHistoryEnvelope => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Partial<ProtectedHistoryEnvelope>;
  return (
    typeof candidate.d === "string" &&
    typeof candidate.s === "string" &&
    typeof candidate.k === "string"
  );
};

const resolveIdentity = (
  providedIdentity?: DeviceSigningIdentity
): Promise<DeviceSigningIdentity> =>
  providedIdentity
    ? Promise.resolve(providedIdentity)
    : getOrCreateDeviceSigningIdentity();

export const protectSessionHistory = async (
  history: RunSession[],
  limit = 25,
  providedIdentity?: DeviceSigningIdentity
): Promise<string> => {
  const identity = await resolveIdentity(providedIdentity);
  const normalizedHistory = parseSessionHistory(
    JSON.stringify(history),
    limit
  );
  const payload = new TextEncoder().encode(
    JSON.stringify(normalizedHistory)
  );
  const signature = await signIntegrityPayload({
    identity,
    payload,
    purpose: "session-history",
  });

  return JSON.stringify({
    d: encodeBase64UrlBytes(payload),
    s: encodeBase64UrlBytes(signature),
    k: identity.fingerprint,
  } satisfies ProtectedHistoryEnvelope);
};

export const restoreProtectedSessionHistory = async (
  rawValue: string | null,
  limit = 25,
  providedIdentity?: DeviceSigningIdentity
): Promise<SessionHistoryIntegrityResult> => {
  let identity: DeviceSigningIdentity;
  try {
    identity = await resolveIdentity(providedIdentity);
  } catch (error) {
    return {
      history: [],
      status: "unavailable",
      fingerprint: null,
      message:
        error instanceof Error
          ? error.message
          : "Kunci perangkat tidak tersedia.",
    };
  }

  if (!rawValue) {
    return {
      history: [],
      status: "empty",
      fingerprint: identity.fingerprint,
    };
  }
  if (rawValue.length > MAX_PROTECTED_HISTORY_LENGTH) {
    return {
      history: [],
      status: "tampered",
      fingerprint: identity.fingerprint,
      message: "Data riwayat lokal melewati batas aman.",
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    return {
      history: [],
      status: "tampered",
      fingerprint: identity.fingerprint,
      message: "Format riwayat lokal tidak valid.",
    };
  }

  // One-time migration for histories created before device signing existed.
  // Once a key already exists, an unsigned array is treated as modification.
  if (Array.isArray(parsed)) {
    if (!identity.created) {
      return {
        history: [],
        status: "tampered",
        fingerprint: identity.fingerprint,
        message: "Riwayat lokal tidak memiliki signature perangkat.",
      };
    }
    const history = parseSessionHistory(rawValue, limit);
    try {
      return {
        history,
        status: "migrated",
        fingerprint: identity.fingerprint,
        migratedValue: await protectSessionHistory(
          history,
          limit,
          identity
        ),
      };
    } catch (error) {
      return {
        history: [],
        status: "unavailable",
        fingerprint: identity.fingerprint,
        message:
          error instanceof Error
            ? error.message
            : "Riwayat lama tidak dapat dilindungi.",
      };
    }
  }

  if (!isProtectedHistoryEnvelope(parsed)) {
    return {
      history: [],
      status: "tampered",
      fingerprint: identity.fingerprint,
      message: "Envelope riwayat lokal tidak valid.",
    };
  }
  if (parsed.k !== identity.fingerprint) {
    return {
      history: [],
      status: "tampered",
      fingerprint: identity.fingerprint,
      message: "Riwayat ditandatangani oleh identitas perangkat lain.",
    };
  }

  try {
    const payload = decodeBase64UrlBytes(
      parsed.d,
      MAX_PROTECTED_HISTORY_LENGTH
    );
    const signature = decodeBase64UrlBytes(parsed.s, 128);
    if (signature.length !== INTEGRITY_SIGNATURE_BYTES) {
      throw new Error("Panjang signature riwayat tidak valid.");
    }
    const verified = await verifyIntegrityPayload({
      publicKey: identity.publicKey,
      payload,
      purpose: "session-history",
      signature,
    });
    if (!verified) {
      throw new Error("Signature riwayat lokal tidak cocok.");
    }

    const payloadText = new TextDecoder("utf-8", { fatal: true }).decode(
      payload
    );
    const payloadValue: unknown = JSON.parse(payloadText);
    if (!Array.isArray(payloadValue)) {
      throw new Error("Isi riwayat lokal tidak valid.");
    }
    return {
      history: parseSessionHistory(payloadText, limit),
      status: "verified",
      fingerprint: identity.fingerprint,
    };
  } catch (error) {
    return {
      history: [],
      status: "tampered",
      fingerprint: identity.fingerprint,
      message:
        error instanceof Error
          ? error.message
          : "Integritas riwayat lokal gagal diverifikasi.",
    };
  }
};
