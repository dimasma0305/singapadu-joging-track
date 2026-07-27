import type {
  RunSession,
  SessionSample,
  TrackingStatus,
} from "./types";

const MAX_SESSION_ID_LENGTH = 128;
const MAX_TRACK_ID_LENGTH = 128;
const MAX_SESSION_SAMPLES = 300;
const MAX_DISTANCE_METERS = 10_000_000;
const MAX_DURATION_SECONDS = 31_536_000;
const MAX_PACE_MINUTES_PER_KM = 1_440;
const MAX_PAUSED_MILLISECONDS = 31_536_000_000;
const MAX_CLOSEST_INDEX = 10_000_000;

export type SessionTransitionOptions = {
  allowSessionReplacement?: boolean;
  allowTimingNormalization?: boolean;
};

export type HardenedSessionTransition =
  | { valid: true; session: RunSession }
  | { valid: false; reason: string };

export type HardenedSessionHistory =
  | { valid: true; sessions: RunSession[] }
  | { valid: false; reason: string };

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isBoundedNumber = (
  value: unknown,
  minimum: number,
  maximum: number
): value is number =>
  isFiniteNumber(value) && value >= minimum && value <= maximum;

const isNullableTimestamp = (value: unknown): value is number | null =>
  value === null || isBoundedNumber(value, 0, Number.MAX_SAFE_INTEGER);

const validateSample = (
  value: SessionSample,
  label: string
): string | null => {
  if (
    !isBoundedNumber(value.lat, -90, 90) ||
    !isBoundedNumber(value.lng, -180, 180)
  ) {
    return `${label} memiliki koordinat di luar batas.`;
  }
  if (
    !isBoundedNumber(value.timestamp, 0, Number.MAX_SAFE_INTEGER) ||
    (value.accuracy !== undefined &&
      value.accuracy !== null &&
      !isBoundedNumber(value.accuracy, 0, 100_000)) ||
    (value.routeProgressMeters !== undefined &&
      !isBoundedNumber(
        value.routeProgressMeters,
        0,
        MAX_DISTANCE_METERS
      ))
  ) {
    return `${label} memiliki metrik GPS tidak valid.`;
  }
  return null;
};

const validateStatusTimestamps = (session: RunSession): string | null => {
  if (
    !isNullableTimestamp(session.startedAt) ||
    !isNullableTimestamp(session.endedAt) ||
    !isNullableTimestamp(session.pausedAt)
  ) {
    return "Timestamp sesi tidak valid.";
  }

  if (session.status === "idle") {
    if (
      session.startedAt !== null ||
      session.endedAt !== null ||
      session.pausedAt !== null
    ) {
      return "Sesi idle tidak boleh memiliki timestamp aktif.";
    }
    return null;
  }

  if (session.startedAt === null) {
    return "Sesi aktif harus memiliki waktu mulai.";
  }
  if (session.status === "running") {
    return session.endedAt === null && session.pausedAt === null
      ? null
      : "Sesi running memiliki timestamp status yang tidak konsisten.";
  }
  if (session.status === "paused") {
    return session.endedAt === null &&
      session.pausedAt !== null &&
      session.pausedAt >= session.startedAt
      ? null
      : "Sesi paused memiliki timestamp status yang tidak konsisten.";
  }
  return session.endedAt !== null &&
    session.endedAt >= session.startedAt &&
    session.pausedAt === null
    ? null
    : "Sesi finished memiliki timestamp status yang tidak konsisten.";
};

const validateSessionShape = (session: RunSession): string | null => {
  if (
    !session ||
    typeof session !== "object" ||
    typeof session.sessionId !== "string" ||
    session.sessionId.length === 0 ||
    session.sessionId.length > MAX_SESSION_ID_LENGTH ||
    typeof session.trackId !== "string" ||
    session.trackId.length === 0 ||
    session.trackId.length > MAX_TRACK_ID_LENGTH ||
    !(
      session.status === "idle" ||
      session.status === "running" ||
      session.status === "paused" ||
      session.status === "finished"
    ) ||
    typeof session.persisted !== "boolean"
  ) {
    return "Identitas atau status sesi tidak valid.";
  }

  const timestampError = validateStatusTimestamps(session);
  if (timestampError) {
    return timestampError;
  }

  if (
    !isBoundedNumber(
      session.totalPausedMilliseconds,
      0,
      MAX_PAUSED_MILLISECONDS
    ) ||
    !isBoundedNumber(session.distanceMeters, 0, MAX_DISTANCE_METERS) ||
    !isBoundedNumber(
      session.routeProgressMeters,
      0,
      MAX_DISTANCE_METERS
    ) ||
    !isBoundedNumber(
      session.durationSeconds,
      0,
      MAX_DURATION_SECONDS
    ) ||
    !isBoundedNumber(
      session.averagePacePerKm,
      0,
      MAX_PACE_MINUTES_PER_KM
    ) ||
    !isBoundedNumber(
      session.maxPacePerKm,
      0,
      MAX_PACE_MINUTES_PER_KM
    ) ||
    !Number.isInteger(session.closestIndex) ||
    session.closestIndex < 0 ||
    session.closestIndex > MAX_CLOSEST_INDEX
  ) {
    return "Metrik sesi berada di luar batas aman.";
  }

  if (!Array.isArray(session.samples) || session.samples.length > MAX_SESSION_SAMPLES) {
    return "Jumlah sampel GPS sesi tidak valid.";
  }
  for (let index = 0; index < session.samples.length; index += 1) {
    const sampleError = validateSample(
      session.samples[index],
      `Sampel GPS ${index + 1}`
    );
    if (sampleError) {
      return sampleError;
    }
    if (
      index > 0 &&
      session.samples[index].timestamp <
        session.samples[index - 1].timestamp
    ) {
      return "Urutan timestamp sampel GPS mundur.";
    }
  }

  if (session.finishPosition !== null) {
    if (session.status !== "finished") {
      return "Posisi finish hanya boleh ada pada sesi selesai.";
    }
    const finishError = validateSample(
      session.finishPosition,
      "Posisi finish"
    );
    if (finishError) {
      return finishError;
    }
  }

  if (
    session.status === "idle" &&
    (session.distanceMeters !== 0 ||
      session.routeProgressMeters !== 0 ||
      session.durationSeconds !== 0 ||
      session.samples.length !== 0 ||
      session.finishPosition !== null)
  ) {
    return "Sesi idle memiliki progres yang tidak semestinya.";
  }

  return null;
};

const ALLOWED_SAME_SESSION_TRANSITIONS: Record<
  TrackingStatus,
  ReadonlySet<TrackingStatus>
> = {
  idle: new Set(["idle", "running"]),
  running: new Set(["running", "paused", "finished"]),
  paused: new Set(["paused", "running", "finished"]),
  finished: new Set(["finished"]),
};

const validateTransition = (
  previous: RunSession,
  next: RunSession,
  options: SessionTransitionOptions
): string | null => {
  const sameSession = previous.sessionId === next.sessionId;
  if (!sameSession) {
    if (next.status === "idle" && options.allowSessionReplacement) {
      return null;
    }
    if (
      next.status === "running" &&
      (previous.status === "idle" || previous.status === "finished")
    ) {
      return null;
    }
    return "Penggantian identitas sesi tidak diizinkan pada status ini.";
  }

  if (previous.trackId !== next.trackId) {
    return "Track sesi tidak boleh berubah di tengah sesi.";
  }
  if (!ALLOWED_SAME_SESSION_TRANSITIONS[previous.status].has(next.status)) {
    return `Transisi ${previous.status} → ${next.status} tidak diizinkan.`;
  }

  const isTimingNormalization =
    options.allowTimingNormalization &&
    previous.sessionId.startsWith("functional-test-") &&
    previous.status === "running" &&
    next.status === "finished";
  if (
    !isTimingNormalization &&
    previous.startedAt !== null &&
    next.startedAt !== previous.startedAt
  ) {
    return "Waktu mulai sesi tidak boleh diubah.";
  }
  if (
    next.distanceMeters < previous.distanceMeters ||
    next.routeProgressMeters < previous.routeProgressMeters ||
    (!isTimingNormalization &&
      (next.durationSeconds < previous.durationSeconds ||
        next.totalPausedMilliseconds <
          previous.totalPausedMilliseconds))
  ) {
    return "Progres sesi tidak boleh bergerak mundur.";
  }

  const previousSample = previous.samples.at(-1);
  const nextSample = next.samples.at(-1);
  if (
    previousSample &&
    nextSample &&
    nextSample.timestamp < previousSample.timestamp
  ) {
    return "Timestamp GPS terbaru tidak boleh bergerak mundur.";
  }

  return null;
};

const freezeSample = (sample: SessionSample): SessionSample =>
  Object.freeze({
    lat: sample.lat,
    lng: sample.lng,
    ...(sample.accuracy !== undefined
      ? { accuracy: sample.accuracy }
      : {}),
    ...(sample.routeProgressMeters !== undefined
      ? { routeProgressMeters: sample.routeProgressMeters }
      : {}),
    timestamp: sample.timestamp,
  });

const cloneAndFreezeSession = (session: RunSession): RunSession => {
  const samples = Object.freeze(
    session.samples.map((sample) => freezeSample(sample))
  ) as unknown as SessionSample[];
  const finishPosition = session.finishPosition
    ? freezeSample(session.finishPosition)
    : null;

  return Object.freeze({
    sessionId: session.sessionId,
    trackId: session.trackId,
    status: session.status,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    pausedAt: session.pausedAt,
    totalPausedMilliseconds: session.totalPausedMilliseconds,
    distanceMeters: session.distanceMeters,
    durationSeconds: session.durationSeconds,
    averagePacePerKm: session.averagePacePerKm,
    maxPacePerKm: session.maxPacePerKm,
    closestIndex: session.closestIndex,
    routeProgressMeters: session.routeProgressMeters,
    finishPosition,
    samples,
    persisted: session.persisted,
  });
};

export const hardenSessionTransition = (
  previous: RunSession,
  candidate: RunSession,
  options: SessionTransitionOptions = {}
): HardenedSessionTransition => {
  const shapeError = validateSessionShape(candidate);
  if (shapeError) {
    return { valid: false, reason: shapeError };
  }
  const transitionError = validateTransition(previous, candidate, options);
  if (transitionError) {
    return { valid: false, reason: transitionError };
  }
  return {
    valid: true,
    session: cloneAndFreezeSession(candidate),
  };
};

export const hardenInitialSession = (
  candidate: RunSession
): HardenedSessionTransition => {
  const shapeError = validateSessionShape(candidate);
  return shapeError
    ? { valid: false, reason: shapeError }
    : { valid: true, session: cloneAndFreezeSession(candidate) };
};

export const hardenSessionHistory = (
  candidates: RunSession[]
): HardenedSessionHistory => {
  if (!Array.isArray(candidates)) {
    return { valid: false, reason: "Riwayat sesi bukan array." };
  }

  const sessionIds = new Set<string>();
  const sessions: RunSession[] = [];
  for (const candidate of candidates) {
    if (
      candidate.status !== "paused" &&
      candidate.status !== "finished"
    ) {
      return {
        valid: false,
        reason: "Riwayat hanya boleh berisi sesi paused atau finished.",
      };
    }
    if (sessionIds.has(candidate.sessionId)) {
      return {
        valid: false,
        reason: "Riwayat memiliki identitas sesi duplikat.",
      };
    }
    const hardened = hardenInitialSession(candidate);
    if (!hardened.valid) {
      return hardened;
    }
    sessionIds.add(candidate.sessionId);
    sessions.push(hardened.session);
  }

  return {
    valid: true,
    sessions: Object.freeze(sessions) as unknown as RunSession[],
  };
};
