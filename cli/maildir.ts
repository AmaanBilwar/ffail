import { simpleParser } from "mailparser"
import { Data, Effect } from "effect"
import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import type { EmailEnvelope, Email } from "./types"

const HEADER_BYTES = 8192

class MailDirError extends Data.TaggedError("MailDirError")<{
  readonly message: string
  readonly cause: unknown
}> {}

function errorCode(cause: unknown): string | null {
  if (typeof cause !== "object" || cause === null || !("code" in cause)) return null
  const code = cause.code
  return typeof code === "string" ? code : null
}

function isMissingPathError(error: MailDirError): boolean {
  return errorCode(error.cause) === "ENOENT"
}

function filenameFlags(filename: string): { isRead: boolean } {
  const m = filename.match(/:2,([SFRTD]*)$/)
  const flags = m?.[1] || ""
  return { isRead: flags.includes("S") }
}

const safeReaddirEffect = (dir: string) => Effect.tryPromise({
  try: () => readdir(dir, { withFileTypes: true }),
  catch: (cause) => new MailDirError({ message: "Failed to read directory", cause }),
}).pipe(
  Effect.map((entries) => entries.filter((e) => e.isFile()).map((e) => e.name)),
  Effect.catchIf(isMissingPathError, () => Effect.succeed([])),
)

function formatDate(d: Date): string {
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  if (days < 7) return d.toLocaleDateString([], { weekday: "short" })
  return d.toLocaleDateString([], { month: "short", day: "numeric" })
}

export async function listEnvelopes(maildir: string, limit = 100): Promise<EmailEnvelope[]> {
  return Effect.runPromise(listEnvelopesEffect(maildir, limit))
}

export async function getEmail(maildir: string, filename: string): Promise<Email> {
  return Effect.runPromise(getEmailEffect(maildir, filename))
}

export const listFoldersEffect = (maildirPath: string) => Effect.gen(function* () {
  const result: { name: string; unread: number }[] = []

  const countNew = (dir: string) =>
    Effect.tryPromise({
      try: () => readdir(dir),
      catch: (cause) => new MailDirError({ message: "Failed to count new mail", cause }),
    }).pipe(
      Effect.map((files) => files.length),
      Effect.catchIf(isMissingPathError, () => Effect.succeed(0)),
    )

  const statExistsEffect = (dirPath: string) =>
    Effect.tryPromise({
      try: () => readdir(dirPath),
      catch: (cause) => new MailDirError({ message: "Failed to stat directory", cause }),
    }).pipe(
      Effect.as(true),
      Effect.catchIf(isMissingPathError, () => Effect.succeed(false)),
    )

  const scan = (dir: string, prefix: string): Effect.Effect<void, MailDirError> =>
    Effect.gen(function* () {
      const entries = yield* Effect.tryPromise({
        try: () => readdir(dir, { withFileTypes: true }),
        catch: (cause) => new MailDirError({ message: "Failed to read folder", cause }),
      }).pipe(
        Effect.catchIf(isMissingPathError, () => Effect.succeed([])),
      )

      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name === "tmp") continue

        const fullPath = join(dir, entry.name)
        const hasNew = yield* statExistsEffect(join(fullPath, "new"))
        const hasCur = yield* statExistsEffect(join(fullPath, "cur"))
        const folderName = prefix ? `${prefix}/${entry.name}` : entry.name

        if (hasNew || hasCur) {
          const unread = yield* countNew(join(fullPath, "new"))
          result.push({ name: folderName, unread })
        } else if (entry.name !== "new" && entry.name !== "cur") {
          yield* scan(fullPath, folderName)
        }
      }
    })

  yield* scan(maildirPath, "")

  return result.sort((a, b) => {
    if (a.name === "INBOX") return -1
    if (b.name === "INBOX") return 1
    return a.name.localeCompare(b.name)
  })
})

export async function listFolders(maildirPath: string): Promise<{ name: string; unread: number }[]> {
  return Effect.runPromise(listFoldersEffect(maildirPath))
}

export function cleanFolderName(raw: string): string {
  const cleaned = raw.replace(/^\[Gmail\]\//, "")
  const map: Record<string, string> = {
    "INBOX": "Inbox",
    "All Mail": "Archive",
    "Sent Mail": "Sent",
    "Drafts": "Drafts",
    "Important": "Important",
    "Starred": "Starred",
    "Spam": "Spam",
    "Trash": "Trash",
  }
  return map[cleaned] || cleaned
}

export { formatDate }

export const listEnvelopesEffect = (maildir: string, limit = 100) => Effect.gen(function* () {
  const [newFiles, curFiles] = yield* Effect.all([
    safeReaddirEffect(join(maildir, "new")),
    safeReaddirEffect(join(maildir, "cur")),
  ])

  const allFiles = [
    ...newFiles.map(f => ({ file: f, isRead: false })),
    ...curFiles.map(f => ({ file: f, isRead: filenameFlags(f).isRead })),
  ]

  allFiles.sort((a, b) => {
    const ta = parseInt(a.file.split(".")[0] || "0", 10)
    const tb = parseInt(b.file.split(".")[0] || "0", 10)
    return tb - ta
  })

  const parsedEnvelopes = yield* Effect.forEach(
    allFiles.slice(0, limit),
    ({ file, isRead }) =>
      Effect.gen(function* () {
        const filePath = join(maildir, isRead ? "cur" : "new", file)
        const buf = yield* Effect.tryPromise({
          try: () => readFile(filePath),
          catch: (cause) => new MailDirError({ message: "Failed to read file", cause }),
        })
        const headerSlice = buf.subarray(0, HEADER_BYTES)
        const parsed = yield* Effect.tryPromise({
          try: () => simpleParser(headerSlice),
          catch: (cause) => new MailDirError({ message: "Failed to parse header", cause }),
        })
        return {
          id: file,
          from: parsed.from?.text || "Unknown",
          subject: parsed.subject || "(no subject)",
          date: parsed.date || new Date(0),
          isRead,
        } satisfies EmailEnvelope
      }).pipe(
        Effect.catchTag("MailDirError", () => Effect.succeed(null)),
      ),
    { concurrency: 8 },
  )

  return parsedEnvelopes.filter((envelope): envelope is EmailEnvelope => envelope !== null)
})

export const getEmailEffect = (maildir: string, filename: string) => Effect.gen(function* () {
  const flags = filenameFlags(filename)
  const dir = flags.isRead ? "cur" : "new"
  const filePath = join(maildir, dir, filename)
  const buf = yield* Effect.tryPromise({
    try: () => readFile(filePath),
    catch: (cause) => new MailDirError({ message: "Failed to read file", cause }),
  })
  const parsed = yield* Effect.tryPromise({
    try: () => simpleParser(buf),
    catch: (cause) => new MailDirError({ message: "Failed to parse email", cause }),
  })

  const body = parsed.text
    || (parsed.html ? parsed.html.replace(/<[^>]*>/g, "").trim() : "")
    || "(no content)"

  return {
    id: filename,
    from: parsed.from?.text || "Unknown",
    subject: parsed.subject || "(no subject)",
    date: parsed.date || new Date(0),
    isRead: flags.isRead,
    body,
  }
})
