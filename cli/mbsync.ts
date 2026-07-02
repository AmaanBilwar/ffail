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
