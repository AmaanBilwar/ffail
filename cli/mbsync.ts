import { Effect } from "effect"


class SyncError {
  readonly _tag = "SyncError"
  constructor(
    readonly message:string, readonly cause: unknown,
  ) {}
}

export interface SyncResult {
  success: boolean
  output: string
}

export async function syncNow(): Promise<SyncResult> {
  const proc = Bun.spawn(["mbsync", "-a"], {
    stdout: "pipe",
    stderr: "pipe",
  })

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])

  const exitCode = await proc.exited

  return {
    success: exitCode <= 1,
    output: stdout + stderr,
  }
}

export const syncNowEffect = Effect.gen(function*() {
  const proc = Bun.spawn(["mbsync", "-a"], {
    stdout: "pipe",
    stderr: "pipe",
  })

  const [stdout, stderr] = yield* Effect.tryPromise({
    try: () => Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]),
    catch: (cause) => new SyncError("Failed to read mbsync output" , cause),
  })

  const exitCode = yield* Effect.tryPromise(
    {
      try: () => proc.exited,
      catch: (cause) => new SyncError("Failed to wait for mbsync" , cause),
    }
  )

  return {
    success: exitCode <= 1,
    output: stdout + stderr,
  }
})
