import { describe, expect, test } from "bun:test";
import { resolvePrimarySessionControl } from "./session-control-utils";

describe("single contextual session control", () => {
  test("maps every session condition to one primary action", () => {
    expect(
      resolvePrimarySessionControl({
        status: "idle",
        isFinishReady: false,
        isTesting: false,
      })
    ).toEqual({ mode: "start", label: "Mulai Sesi Lari" });
    expect(
      resolvePrimarySessionControl({
        status: "running",
        isFinishReady: false,
        isTesting: false,
      })
    ).toEqual({ mode: "pause", label: "Jeda Sesi" });
    expect(
      resolvePrimarySessionControl({
        status: "paused",
        isFinishReady: false,
        isTesting: false,
      })
    ).toEqual({ mode: "resume", label: "Lanjutkan Sesi" });
    expect(
      resolvePrimarySessionControl({
        status: "running",
        isFinishReady: true,
        isTesting: false,
      })
    ).toEqual({ mode: "finish", label: "Finish" });
    expect(
      resolvePrimarySessionControl({
        status: "finished",
        isFinishReady: false,
        isTesting: false,
      })
    ).toEqual({ mode: "start", label: "Mulai Lari Baru" });
    expect(
      resolvePrimarySessionControl({
        status: "running",
        isFinishReady: false,
        isTesting: true,
      })
    ).toEqual({ mode: "stop", label: "Hentikan Pengujian" });
  });
});
