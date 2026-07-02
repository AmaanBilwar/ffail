import { simpleParser } from "mailparser"
import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import type { EmailEnvelope, Email } from "./types"

const HEADER_BYTES = 8192

function filenameFlags(filename: string): { isRead: boolean } {
  const m = filename.match(/:2,([SFRTD]*)$/)
  const flags = m?.[1] || ""
  return { isRead: flags.includes("S") }
}

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries.filter(e => e.isFile()).map(e => e.name)
  } catch {
    return []
  }
}

function formatDate(d: Date): string {
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  if (days < 7) return d.toLocaleDateString([], { weekday: "short" })
  return d.toLocaleDateString([], { month: "short", day: "numeric" })
}

export async function listEnvelopes(maildir: string, limit = 100): Promise<EmailEnvelope[]> {
  const [newFiles, curFiles] = await Promise.all([
    safeReaddir(join(maildir, "new")),
    safeReaddir(join(maildir, "cur")),
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

  const envelopes: EmailEnvelope[] = []

  for (const { file, isRead } of allFiles.slice(0, limit)) {
    try {
      const filePath = join(maildir, isRead ? "cur" : "new", file)
      const buf = await readFile(filePath)
      const headerSlice = buf.subarray(0, HEADER_BYTES)
      const parsed = await simpleParser(headerSlice)

      envelopes.push({
        id: file,
        from: parsed.from?.text || "Unknown",
        subject: parsed.subject || "(no subject)",
        date: parsed.date || new Date(0),
        isRead,
      })
    } catch {
      // skip corrupt files
    }
  }

  return envelopes
}

export async function getEmail(maildir: string, filename: string): Promise<Email> {
  const flags = filenameFlags(filename)
  const dir = flags.isRead ? "cur" : "new"
  const filePath = join(maildir, dir, filename)
  const buf = await readFile(filePath)
  const parsed = await simpleParser(buf)

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
}

export async function listFolders(maildirPath: string): Promise<{ name: string; unread: number }[]> {
  const result: { name: string; unread: number }[] = []

  async function countNew(dir: string): Promise<number> {
    try {
      const files = await readdir(dir)
      return files.length
    } catch { return 0 }
  }

  async function scan(dir: string, prefix: string) {
    let entries: { name: string; isDirectory: () => boolean }[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch { return }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === "tmp") continue
      const fullPath = join(dir, entry.name)

      const hasNew = await statExists(join(fullPath, "new"))
      const hasCur = await statExists(join(fullPath, "cur"))
      const folderName = prefix ? `${prefix}/${entry.name}` : entry.name

      if (hasNew || hasCur) {
        const unread = await countNew(join(fullPath, "new"))
        result.push({ name: folderName, unread })
      } else if (entry.name !== "new" && entry.name !== "cur") {
        await scan(fullPath, folderName)
      }
    }
  }

  await scan(maildirPath, "")
  return result.sort((a, b) => {
    if (a.name === "INBOX") return -1
    if (b.name === "INBOX") return 1
    return a.name.localeCompare(b.name)
  })
}

async function statExists(p: string): Promise<boolean> {
  try { await readdir(p); return true } catch { return false }
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
