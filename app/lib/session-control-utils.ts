import { calculateActiveDurationSeconds } from "./track-utils";
import type { RunSession, SessionSample } from "./types";

export type PrimarySessionMode =
  | "start"
  | "pause"
  | "resume"
  | "stop";

export type PrimarySessionControl = {
  mode: PrimarySessionMode;
  label: string;
};

export const completeSessionAtPosition = ({
  session,
  endedAt,
  position,
}: {
  session: RunSession;
  endedAt: number;
  position: SessionSample | null;
}): RunSession => {
  const totalPausedMilliseconds =
    session.totalPausedMilliseconds +
    (session.pausedAt ? Math.max(0, endedAt - session.pausedAt) : 0);
  const durationSeconds = calculateActiveDurationSeconds({
    startedAt: session.startedAt,
    currentTimestamp: endedAt,
    totalPausedMilliseconds,
  });
  const averagePacePerKm =
    session.distanceMeters > 0 && durationSeconds > 0
      ? Number(
          (
            durationSeconds /
            60 /
            (session.distanceMeters / 1000)
          ).toFixed(2)
        )
      : 0;

  return {
    ...session,
    status: "finished",
    endedAt,
    pausedAt: null,
    totalPausedMilliseconds,
    durationSeconds,
    averagePacePerKm,
    finishPosition: position
      ? {
          ...position,
          routeProgressMeters: session.routeProgressMeters,
        }
      : null,
    persisted: false,
  };
};

export const resolvePrimarySessionControl = ({
  status,
  isTesting,
}: {
  status: RunSession["status"];
  isTesting: boolean;
}): PrimarySessionControl => {
  if (isTesting) {
    return { mode: "stop", label: "Hentikan Pengujian" };
  }
  if (status === "running") {
    return { mode: "pause", label: "Jeda Sesi" };
  }
  if (status === "paused") {
    return { mode: "resume", label: "Lanjutkan Sesi" };
  }
  if (status === "finished") {
    return { mode: "start", label: "Mulai Lari Baru" };
  }
  return { mode: "start", label: "Mulai Sesi Lari" };
};
