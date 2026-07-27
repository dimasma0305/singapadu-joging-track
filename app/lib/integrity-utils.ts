const INTEGRITY_DATABASE_NAME = "joging-track:integrity";
const INTEGRITY_STORE_NAME = "device-identity";
const INTEGRITY_IDENTITY_KEY = "primary";
const INTEGRITY_DOMAIN = "Singapadu Tengah Run Track";
const PUBLIC_KEY_BYTES = 65;
const COMPRESSED_PUBLIC_KEY_BYTES = 33;
const ECDSA_SIGNATURE_BYTES = 64;
const FINGERPRINT_BYTES = 12;

const P256_PRIME = BigInt(
  "0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff"
);
const P256_CURVE_A = P256_PRIME - BigInt(3);
const P256_CURVE_B = BigInt(
  "0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b"
);
const P256_ORDER = BigInt(
  "0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551"
);
const P256_HALF_ORDER = P256_ORDER / BigInt(2);
const P256_GENERATOR_X = BigInt(
  "0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296"
);
const P256_GENERATOR_Y = BigInt(
  "0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5"
);

export type IntegrityPurpose = "profile-share" | "session-history";

export type DeviceSigningIdentity = {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  publicKeyBytes: Uint8Array;
  fingerprint: string;
  created: boolean;
};

export type RecoveredIntegrityPublicKey = {
  publicKey: CryptoKey;
  publicKeyBytes: Uint8Array;
  fingerprint: string;
};

type StoredDeviceIdentity = {
  privateKey: CryptoKey;
  publicKeyBytes: ArrayBuffer;
};

type P256AffinePoint = {
  x: bigint;
  y: bigint;
};

type P256JacobianPoint = {
  x: bigint;
  y: bigint;
  z: bigint;
};

let identityPromise: Promise<DeviceSigningIdentity> | null = null;

const resolveWebCrypto = (): Crypto => {
  if (!globalThis.crypto?.subtle) {
    throw new Error("WebCrypto tidak tersedia di browser ini.");
  }
  return globalThis.crypto;
};

const concatenateBytes = (...parts: Uint8Array[]): Uint8Array => {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const combined = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    combined.set(part, offset);
    offset += part.length;
  }
  return combined;
};

const copyToWebCryptoBuffer = (
  bytes: Uint8Array
): Uint8Array<ArrayBuffer> => {
  const copy = new Uint8Array(new ArrayBuffer(bytes.length));
  copy.set(bytes);
  return copy;
};

export const encodeBase64UrlBytes = (bytes: Uint8Array): string => {
  let binary = "";
  const chunkSize = 8_192;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
};

export const decodeBase64UrlBytes = (
  value: string,
  maximumLength = 100_000
): Uint8Array => {
  if (
    !value ||
    value.length > maximumLength ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    throw new Error("Data Base64URL tidak valid.");
  }

  const padded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new Error("Data Base64URL tidak valid.");
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const bytesToBigInt = (bytes: Uint8Array): bigint => {
  let value = BigInt(0);
  for (const byte of bytes) {
    value = value * BigInt(256) + BigInt(byte);
  }
  return value;
};

const bigIntToFixedBytes = (value: bigint, length: number): Uint8Array => {
  const bytes = new Uint8Array(length);
  let remaining = value;
  for (let index = length - 1; index >= 0; index -= 1) {
    bytes[index] = Number(remaining % BigInt(256));
    remaining /= BigInt(256);
  }
  if (remaining !== BigInt(0)) {
    throw new Error("Nilai signature berada di luar batas kurva.");
  }
  return bytes;
};

const modulo = (value: bigint, modulus: bigint): bigint => {
  const remainder = value % modulus;
  return remainder >= BigInt(0) ? remainder : remainder + modulus;
};

const modularExponentiation = (
  base: bigint,
  exponent: bigint,
  modulus: bigint
): bigint => {
  let result = BigInt(1);
  let factor = modulo(base, modulus);
  let remaining = exponent;
  while (remaining > BigInt(0)) {
    if (remaining % BigInt(2) === BigInt(1)) {
      result = (result * factor) % modulus;
    }
    factor = (factor * factor) % modulus;
    remaining /= BigInt(2);
  }
  return result;
};

const modularInverse = (
  value: bigint,
  modulus: bigint
): bigint => {
  let oldR = modulo(value, modulus);
  let remainder = modulus;
  let oldCoefficient = BigInt(1);
  let coefficient = BigInt(0);

  while (remainder !== BigInt(0)) {
    const quotient = oldR / remainder;
    [oldR, remainder] = [
      remainder,
      oldR - quotient * remainder,
    ];
    [oldCoefficient, coefficient] = [
      coefficient,
      oldCoefficient - quotient * coefficient,
    ];
  }
  if (oldR !== BigInt(1)) {
    throw new Error("Nilai kurva tidak memiliki invers modular.");
  }
  return modulo(oldCoefficient, modulus);
};

const P256_INFINITY: P256JacobianPoint = {
  x: BigInt(0),
  y: BigInt(1),
  z: BigInt(0),
};

const toJacobianPoint = (
  point: P256AffinePoint
): P256JacobianPoint => ({
  x: point.x,
  y: point.y,
  z: BigInt(1),
});

const doubleJacobianPoint = (
  point: P256JacobianPoint
): P256JacobianPoint => {
  if (point.z === BigInt(0) || point.y === BigInt(0)) {
    return P256_INFINITY;
  }

  const xx = modulo(point.x * point.x, P256_PRIME);
  const yy = modulo(point.y * point.y, P256_PRIME);
  const yyyy = modulo(yy * yy, P256_PRIME);
  const zz = modulo(point.z * point.z, P256_PRIME);
  const s = modulo(
    BigInt(2) *
      (modulo((point.x + yy) * (point.x + yy), P256_PRIME) -
        xx -
        yyyy),
    P256_PRIME
  );
  const m = modulo(
    BigInt(3) * xx +
      P256_CURVE_A * modulo(zz * zz, P256_PRIME),
    P256_PRIME
  );
  const x = modulo(m * m - BigInt(2) * s, P256_PRIME);
  const y = modulo(
    m * (s - x) - BigInt(8) * yyyy,
    P256_PRIME
  );
  const z = modulo(
    BigInt(2) * point.y * point.z,
    P256_PRIME
  );
  return { x, y, z };
};

const addJacobianPoints = (
  left: P256JacobianPoint,
  right: P256JacobianPoint
): P256JacobianPoint => {
  if (left.z === BigInt(0)) {
    return right;
  }
  if (right.z === BigInt(0)) {
    return left;
  }

  const leftZSquared = modulo(left.z * left.z, P256_PRIME);
  const rightZSquared = modulo(right.z * right.z, P256_PRIME);
  const leftU = modulo(left.x * rightZSquared, P256_PRIME);
  const rightU = modulo(right.x * leftZSquared, P256_PRIME);
  const leftS = modulo(
    left.y * right.z * rightZSquared,
    P256_PRIME
  );
  const rightS = modulo(
    right.y * left.z * leftZSquared,
    P256_PRIME
  );

  if (leftU === rightU) {
    return leftS === rightS
      ? doubleJacobianPoint(left)
      : P256_INFINITY;
  }

  const h = modulo(rightU - leftU, P256_PRIME);
  const i = modulo(
    BigInt(4) * h * h,
    P256_PRIME
  );
  const j = modulo(h * i, P256_PRIME);
  const r = modulo(
    BigInt(2) * (rightS - leftS),
    P256_PRIME
  );
  const v = modulo(leftU * i, P256_PRIME);
  const x = modulo(
    r * r - j - BigInt(2) * v,
    P256_PRIME
  );
  const y = modulo(
    r * (v - x) - BigInt(2) * leftS * j,
    P256_PRIME
  );
  const z = modulo(
    (modulo(
      (left.z + right.z) * (left.z + right.z),
      P256_PRIME
    ) -
      leftZSquared -
      rightZSquared) *
      h,
    P256_PRIME
  );
  return { x, y, z };
};

const multiplyJacobianPoint = (
  point: P256AffinePoint,
  scalar: bigint
): P256JacobianPoint => {
  if (scalar < BigInt(0)) {
    throw new Error("Skalar kurva tidak boleh negatif.");
  }
  let result = P256_INFINITY;
  let addend = toJacobianPoint(point);
  let remaining = scalar;

  while (remaining > BigInt(0)) {
    if (remaining % BigInt(2) === BigInt(1)) {
      result = addJacobianPoints(result, addend);
    }
    addend = doubleJacobianPoint(addend);
    remaining /= BigInt(2);
  }
  return result;
};

const toAffinePoint = (
  point: P256JacobianPoint
): P256AffinePoint | null => {
  if (point.z === BigInt(0)) {
    return null;
  }
  const inverseZ = modularInverse(point.z, P256_PRIME);
  const inverseZSquared = modulo(
    inverseZ * inverseZ,
    P256_PRIME
  );
  return {
    x: modulo(point.x * inverseZSquared, P256_PRIME),
    y: modulo(
      point.y * inverseZSquared * inverseZ,
      P256_PRIME
    ),
  };
};

const encodeAffinePublicKey = (
  point: P256AffinePoint
): Uint8Array => {
  const bytes = new Uint8Array(PUBLIC_KEY_BYTES);
  bytes[0] = 0x04;
  bytes.set(bigIntToFixedBytes(point.x, 32), 1);
  bytes.set(bigIntToFixedBytes(point.y, 32), 33);
  return bytes;
};

export const compressDevicePublicKey = (
  publicKeyBytes: Uint8Array
): Uint8Array => {
  if (
    publicKeyBytes.length !== PUBLIC_KEY_BYTES ||
    publicKeyBytes[0] !== 0x04
  ) {
    throw new Error("Kunci publik perangkat tidak valid.");
  }
  const compressed = new Uint8Array(COMPRESSED_PUBLIC_KEY_BYTES);
  compressed[0] = 0x02 | (publicKeyBytes[64] & 0x01);
  compressed.set(publicKeyBytes.subarray(1, 33), 1);
  return compressed;
};

export const decompressDevicePublicKey = (
  compressedKeyBytes: Uint8Array
): Uint8Array => {
  if (
    compressedKeyBytes.length !== COMPRESSED_PUBLIC_KEY_BYTES ||
    (compressedKeyBytes[0] !== 0x02 &&
      compressedKeyBytes[0] !== 0x03)
  ) {
    throw new Error("Kunci publik ringkas tidak valid.");
  }

  const xBytes = compressedKeyBytes.subarray(1);
  const x = bytesToBigInt(xBytes);
  if (x >= P256_PRIME) {
    throw new Error("Koordinat kunci publik berada di luar kurva.");
  }
  const ySquared = modulo(
    x * x * x + P256_CURVE_A * x + P256_CURVE_B,
    P256_PRIME
  );
  let y = modularExponentiation(
    ySquared,
    (P256_PRIME + BigInt(1)) / BigInt(4),
    P256_PRIME
  );
  if ((y * y) % P256_PRIME !== ySquared) {
    throw new Error("Kunci publik ringkas tidak berada pada kurva.");
  }

  const expectedOdd = compressedKeyBytes[0] === 0x03;
  const isOdd = y % BigInt(2) === BigInt(1);
  if (y === BigInt(0) && expectedOdd) {
    throw new Error("Paritas kunci publik ringkas tidak valid.");
  }
  if (isOdd !== expectedOdd) {
    y = P256_PRIME - y;
  }

  const publicKeyBytes = new Uint8Array(PUBLIC_KEY_BYTES);
  publicKeyBytes[0] = 0x04;
  publicKeyBytes.set(xBytes, 1);
  publicKeyBytes.set(bigIntToFixedBytes(y, 32), 33);
  return publicKeyBytes;
};

const canonicalizeSignature = (signature: Uint8Array): Uint8Array => {
  if (signature.length !== ECDSA_SIGNATURE_BYTES) {
    throw new Error("Format signature perangkat tidak didukung.");
  }

  const r = bytesToBigInt(signature.subarray(0, 32));
  const originalS = bytesToBigInt(signature.subarray(32));
  if (
    r <= BigInt(0) ||
    r >= P256_ORDER ||
    originalS <= BigInt(0) ||
    originalS >= P256_ORDER
  ) {
    throw new Error("Signature perangkat tidak valid.");
  }

  const canonicalS =
    originalS > P256_HALF_ORDER ? P256_ORDER - originalS : originalS;
  return concatenateBytes(
    bigIntToFixedBytes(r, 32),
    bigIntToFixedBytes(canonicalS, 32)
  );
};

const isCanonicalSignature = (signature: Uint8Array): boolean => {
  if (signature.length !== ECDSA_SIGNATURE_BYTES) {
    return false;
  }
  const r = bytesToBigInt(signature.subarray(0, 32));
  const s = bytesToBigInt(signature.subarray(32));
  return (
    r > BigInt(0) &&
    r < P256_ORDER &&
    s > BigInt(0) &&
    s <= P256_HALF_ORDER
  );
};

const buildSignedMessage = (
  purpose: IntegrityPurpose,
  payload: Uint8Array
): Uint8Array =>
  concatenateBytes(
    new TextEncoder().encode(`${INTEGRITY_DOMAIN}\u0000${purpose}\u0000`),
    payload
  );

export const fingerprintPublicKey = async (
  publicKeyBytes: Uint8Array
): Promise<string> => {
  const fingerprint = await fingerprintPublicKeyBytes(
    publicKeyBytes
  );
  return encodeBase64UrlBytes(fingerprint);
};

export const fingerprintPublicKeyBytes = async (
  publicKeyBytes: Uint8Array
): Promise<Uint8Array> => {
  const digest = new Uint8Array(
    await resolveWebCrypto().subtle.digest(
      "SHA-256",
      copyToWebCryptoBuffer(publicKeyBytes)
    )
  );
  return digest.slice(0, FINGERPRINT_BYTES);
};

export const importDeviceVerificationKey = async (
  publicKeyBytes: Uint8Array
): Promise<CryptoKey> => {
  if (
    publicKeyBytes.length !== PUBLIC_KEY_BYTES ||
    publicKeyBytes[0] !== 0x04
  ) {
    throw new Error("Kunci verifikasi perangkat tidak valid.");
  }

  try {
    return await resolveWebCrypto().subtle.importKey(
      "raw",
      copyToWebCryptoBuffer(publicKeyBytes),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"]
    );
  } catch {
    throw new Error("Kunci verifikasi perangkat tidak valid.");
  }
};

export const createEphemeralSigningIdentity = async (
  created = true
): Promise<DeviceSigningIdentity> => {
  const cryptoProvider = resolveWebCrypto();
  const generated = await cryptoProvider.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  const publicKeyBytes = new Uint8Array(
    await cryptoProvider.subtle.exportKey("raw", generated.publicKey)
  );
  const privateKeyBytes = new Uint8Array(
    await cryptoProvider.subtle.exportKey("pkcs8", generated.privateKey)
  );

  try {
    const [privateKey, publicKey, fingerprint] = await Promise.all([
      cryptoProvider.subtle.importKey(
        "pkcs8",
        privateKeyBytes,
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["sign"]
      ),
      importDeviceVerificationKey(publicKeyBytes),
      fingerprintPublicKey(publicKeyBytes),
    ]);
    return {
      privateKey,
      publicKey,
      publicKeyBytes,
      fingerprint,
      created,
    };
  } finally {
    privateKeyBytes.fill(0);
  }
};

const openIntegrityDatabase = (): Promise<IDBDatabase> => {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(
      new Error("IndexedDB tidak tersedia untuk menyimpan kunci perangkat.")
    );
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(INTEGRITY_DATABASE_NAME);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(INTEGRITY_STORE_NAME)) {
        database.createObjectStore(INTEGRITY_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        request.error ??
          new Error("Penyimpanan kunci perangkat tidak dapat dibuka.")
      );
    request.onblocked = () =>
      reject(new Error("Penyimpanan kunci perangkat sedang terkunci."));
  });
};

const readStoredIdentity = (
  database: IDBDatabase
): Promise<StoredDeviceIdentity | null> =>
  new Promise((resolve, reject) => {
    const transaction = database.transaction(
      INTEGRITY_STORE_NAME,
      "readonly"
    );
    const request = transaction
      .objectStore(INTEGRITY_STORE_NAME)
      .get(INTEGRITY_IDENTITY_KEY);
    request.onsuccess = () =>
      resolve((request.result as StoredDeviceIdentity | undefined) ?? null);
    request.onerror = () =>
      reject(
        request.error ?? new Error("Kunci perangkat tidak dapat dibaca.")
      );
  });

const addStoredIdentity = (
  database: IDBDatabase,
  identity: DeviceSigningIdentity
): Promise<boolean> =>
  new Promise((resolve, reject) => {
    const transaction = database.transaction(
      INTEGRITY_STORE_NAME,
      "readwrite"
    );
    const request = transaction.objectStore(INTEGRITY_STORE_NAME).add(
      {
        privateKey: identity.privateKey,
        publicKeyBytes: identity.publicKeyBytes.slice().buffer,
      } satisfies StoredDeviceIdentity,
      INTEGRITY_IDENTITY_KEY
    );
    let lostCreationRace = false;
    request.onerror = (event) => {
      if (request.error?.name === "ConstraintError") {
        lostCreationRace = true;
        event.preventDefault();
        event.stopPropagation();
      }
    };
    transaction.oncomplete = () => resolve(!lostCreationRace);
    transaction.onerror = () =>
      reject(
        transaction.error ??
          new Error("Kunci perangkat tidak dapat disimpan.")
      );
    transaction.onabort = () =>
      reject(
        transaction.error ??
          new Error("Penyimpanan kunci perangkat dibatalkan.")
      );
  });

const restoreStoredIdentity = async (
  stored: StoredDeviceIdentity
): Promise<DeviceSigningIdentity | null> => {
  if (
    !stored ||
    stored.privateKey?.type !== "private" ||
    stored.privateKey.algorithm.name !== "ECDSA" ||
    (stored.privateKey.algorithm as EcKeyAlgorithm).namedCurve !== "P-256" ||
    stored.privateKey.extractable ||
    stored.privateKey.usages.length !== 1 ||
    stored.privateKey.usages[0] !== "sign" ||
    !stored.publicKeyBytes
  ) {
    return null;
  }

  const publicKeyBytes = new Uint8Array(stored.publicKeyBytes.slice(0));
  try {
    const [publicKey, fingerprint] = await Promise.all([
      importDeviceVerificationKey(publicKeyBytes),
      fingerprintPublicKey(publicKeyBytes),
    ]);
    const identity: DeviceSigningIdentity = {
      privateKey: stored.privateKey,
      publicKey,
      publicKeyBytes,
      fingerprint,
      created: false,
    };
    const challenge = resolveWebCrypto().getRandomValues(
      new Uint8Array(32)
    );
    const signature = await signIntegrityPayload({
      identity,
      payload: challenge,
      purpose: "session-history",
    });
    const matchingKeyPair = await verifyIntegrityPayload({
      publicKey,
      payload: challenge,
      purpose: "session-history",
      signature,
    });
    return matchingKeyPair ? identity : null;
  } catch {
    return null;
  }
};

export const getOrCreateDeviceSigningIdentity =
  async (): Promise<DeviceSigningIdentity> => {
    if (identityPromise) {
      return identityPromise;
    }

    identityPromise = (async () => {
      const database = await openIntegrityDatabase();
      try {
        const stored = await readStoredIdentity(database);
        if (stored) {
          const restored = await restoreStoredIdentity(stored);
          if (!restored) {
            throw new Error(
              "Kunci perangkat tersimpan rusak. Riwayat tidak akan dipercaya."
            );
          }
          return restored;
        }

        const created = await createEphemeralSigningIdentity(true);
        const inserted = await addStoredIdentity(database, created);
        if (inserted) {
          return created;
        }

        const winner = await readStoredIdentity(database);
        const restoredWinner = winner
          ? await restoreStoredIdentity(winner)
          : null;
        if (!restoredWinner) {
          throw new Error(
            "Identitas perangkat tidak dapat dipastikan setelah dibuat."
          );
        }
        return restoredWinner;
      } finally {
        database.close();
      }
    })().catch((error) => {
      identityPromise = null;
      throw error;
    });

    return identityPromise;
  };

export const signIntegrityPayload = async ({
  identity,
  payload,
  purpose,
}: {
  identity: Pick<DeviceSigningIdentity, "privateKey">;
  payload: Uint8Array;
  purpose: IntegrityPurpose;
}): Promise<Uint8Array> => {
  const signature = new Uint8Array(
    await resolveWebCrypto().subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      identity.privateKey,
      copyToWebCryptoBuffer(buildSignedMessage(purpose, payload))
    )
  );
  return canonicalizeSignature(signature);
};

export const verifyIntegrityPayload = async ({
  publicKey,
  payload,
  purpose,
  signature,
}: {
  publicKey: CryptoKey;
  payload: Uint8Array;
  purpose: IntegrityPurpose;
  signature: Uint8Array;
}): Promise<boolean> => {
  if (!isCanonicalSignature(signature)) {
    return false;
  }
  try {
    return await resolveWebCrypto().subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      copyToWebCryptoBuffer(signature),
      copyToWebCryptoBuffer(buildSignedMessage(purpose, payload))
    );
  } catch {
    return false;
  }
};

const bytesEqual = (
  left: Uint8Array,
  right: Uint8Array
): boolean => {
  if (left.length !== right.length) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
};

const recoverP256PublicKeyFromDigest = ({
  digest,
  signature,
  recoveryId,
}: {
  digest: Uint8Array;
  signature: Uint8Array;
  recoveryId: number;
}): Uint8Array => {
  const r = bytesToBigInt(signature.subarray(0, 32));
  const s = bytesToBigInt(signature.subarray(32));
  const x =
    r + BigInt(recoveryId >> 1) * P256_ORDER;
  if (x >= P256_PRIME) {
    throw new Error("Koordinat recovery berada di luar kurva.");
  }

  const compressedRecoveryPoint = new Uint8Array(
    COMPRESSED_PUBLIC_KEY_BYTES
  );
  compressedRecoveryPoint[0] =
    recoveryId % 2 === 0 ? 0x02 : 0x03;
  compressedRecoveryPoint.set(bigIntToFixedBytes(x, 32), 1);
  const recoveryPointBytes = decompressDevicePublicKey(
    compressedRecoveryPoint
  );
  const recoveryPoint: P256AffinePoint = {
    x: bytesToBigInt(recoveryPointBytes.subarray(1, 33)),
    y: bytesToBigInt(recoveryPointBytes.subarray(33, 65)),
  };

  const inverseR = modularInverse(r, P256_ORDER);
  const digestValue = bytesToBigInt(digest);
  const generatorScalar = modulo(
    -digestValue * inverseR,
    P256_ORDER
  );
  const recoveryScalar = modulo(s * inverseR, P256_ORDER);
  const recoveredPoint = toAffinePoint(
    addJacobianPoints(
      multiplyJacobianPoint(
        {
          x: P256_GENERATOR_X,
          y: P256_GENERATOR_Y,
        },
        generatorScalar
      ),
      multiplyJacobianPoint(recoveryPoint, recoveryScalar)
    )
  );
  if (!recoveredPoint) {
    throw new Error("Kunci publik tidak dapat dipulihkan.");
  }
  return encodeAffinePublicKey(recoveredPoint);
};

export const recoverIntegrityPublicKeyByFingerprint = async ({
  payload,
  purpose,
  signature,
  expectedFingerprint,
}: {
  payload: Uint8Array;
  purpose: IntegrityPurpose;
  signature: Uint8Array;
  expectedFingerprint: Uint8Array;
}): Promise<RecoveredIntegrityPublicKey> => {
  if (
    expectedFingerprint.length !== FINGERPRINT_BYTES ||
    !isCanonicalSignature(signature)
  ) {
    throw new Error(
      "Signature atau fingerprint ringkasan achievement tidak cocok."
    );
  }

  const digest = new Uint8Array(
    await resolveWebCrypto().subtle.digest(
      "SHA-256",
      copyToWebCryptoBuffer(buildSignedMessage(purpose, payload))
    )
  );

  for (let recoveryId = 0; recoveryId < 4; recoveryId += 1) {
    try {
      const publicKeyBytes = recoverP256PublicKeyFromDigest({
        digest,
        signature,
        recoveryId,
      });
      const fingerprintBytes = await fingerprintPublicKeyBytes(
        publicKeyBytes
      );
      if (!bytesEqual(fingerprintBytes, expectedFingerprint)) {
        continue;
      }

      const publicKey = await importDeviceVerificationKey(
        publicKeyBytes
      );
      const signatureValid = await verifyIntegrityPayload({
        publicKey,
        payload,
        purpose,
        signature,
      });
      if (signatureValid) {
        return {
          publicKey,
          publicKeyBytes,
          fingerprint: encodeBase64UrlBytes(fingerprintBytes),
        };
      }
    } catch {
      // Some recovery IDs do not map to a point on P-256.
    }
  }

  throw new Error(
    "Signature atau fingerprint ringkasan achievement tidak cocok."
  );
};

export const INTEGRITY_PUBLIC_KEY_BYTES = PUBLIC_KEY_BYTES;
export const INTEGRITY_COMPACT_PUBLIC_KEY_BYTES =
  COMPRESSED_PUBLIC_KEY_BYTES;
export const INTEGRITY_SIGNATURE_BYTES = ECDSA_SIGNATURE_BYTES;
export const INTEGRITY_FINGERPRINT_BYTES = FINGERPRINT_BYTES;
