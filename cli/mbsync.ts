import { Data, Effect } from "effect"


class SyncSpawnError extends Data.TaggedError("SyncSpawnError")<{
  readonly message: string
  readonly cause: unknown
}> {}

class SyncOutputError extends Data.TaggedError("SyncOutputError")<{
  readonly message: string
  readonly cause: unknown
}> {}

class SyncWaitError extends Data.TaggedError("SyncWaitError")<{
  readonly message: string
  readonly cause: unknown
}> {}

export interface SyncResult {
  success: boolean
  output: string
}

export async function syncNow(): Promise<SyncResult> {
  return Effect.runPromise(syncNowEffect)
}

export const syncNowEffect = Effect.acquireUseRelease(
  Effect.try({
    try: () => Bun.spawn(["mbsync", "-a"], { stdout: "pipe", stderr: "pipe" }),
    catch: (cause) => new SyncSpawnError({ message: "Failed to spawn mbsync", cause }),
  }),
  (proc) =>
    Effect.gen(function* () {
      const [stdout, stderr] = yield* Effect.tryPromise({
        try: () => Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
        ]),
        catch: (cause) => new SyncOutputError({ message: "Failed to read mbsync output", cause }),
      })

      const exitCode = yield* Effect.tryPromise({
        try: () => proc.exited,
        catch: (cause) => new SyncWaitError({ message: "Failed to wait for mbsync", cause }),
      })

      return {
        success: exitCode <= 1,
        output: stdout + stderr,
      }
    }),
  (proc) =>
    Effect.sync(() => {
      try {
        if (proc.exitCode === null) proc.kill()
      } catch {
        // ignore cleanup errors
      }
    }),
)
