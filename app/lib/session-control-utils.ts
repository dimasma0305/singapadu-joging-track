import type { RunSession } from "./types";

export type PrimarySessionMode =
  | "start"
  | "pause"
  | "resume"
  | "finish"
  | "stop";

export type PrimarySessionControl = {
  mode: PrimarySessionMode;
  label: string;
};

export const resolvePrimarySessionControl = ({
  status,
  isFinishReady,
  isTesting,
}: {
  status: RunSession["status"];
  isFinishReady: boolean;
  isTesting: boolean;
}): PrimarySessionControl => {
  if (isTesting) {
    return { mode: "stop", label: "Hentikan Pengujian" };
  }
  if (
    isFinishReady &&
    (status === "running" || status === "paused")
  ) {
    return { mode: "finish", label: "Finish" };
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
