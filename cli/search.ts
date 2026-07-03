import { Effect } from "effect"
import type { FileFinder, GrepMatch } from "@ff-labs/fff-node"

const HEADER_RE = /^[A-Za-z][A-Za-z0-9_-]*:/

export interface FoundEmail {
  folder: string
  filename: string
  subdir: "cur" | "new"
  lineContent: string
  lineNumber: number
  matchType: "header" | "body"
}

function classifyMatch(line: string, lineNumber: number): "header" | "body" {
  if (HEADER_RE.test(line) && lineNumber <= 50) return "header"
  return "body"
}

export function parseGrepMatch(match: GrepMatch): FoundEmail {
  const parts = match.relativePath.split("/")
  const filename = parts.pop()!
  let folder = parts.join("/")
  let subdir: "cur" | "new" = "cur"
  if (folder.endsWith("/cur")) { folder = folder.slice(0, -4); subdir = "cur" }
  else if (folder.endsWith("/new")) { folder = folder.slice(0, -4); subdir = "new" }
  const lineContent = match.lineContent.trim()
  return { folder, filename, subdir, lineContent, lineNumber: match.lineNumber, matchType: classifyMatch(lineContent, match.lineNumber) }
}

export function encodeSearchValue(found: FoundEmail): string {
  return JSON.stringify({ f: found.folder, n: found.filename, s: found.subdir })
}

export function decodeSearchValue(value: string): { folder: string; filename: string; subdir: "cur" | "new" } | null {
  try {
    const d = JSON.parse(value) as Record<string, unknown>
    if (d && typeof d.f === "string" && typeof d.n === "string" && (d.s === "cur" || d.s === "new"))
      return { folder: d.f, filename: d.n, subdir: d.s }
    return null
  } catch {
    return null
  }
}

export const searchEmailsEffect = (finder: FileFinder, query: string, pageSize = 50) =>
  Effect.gen(function* () {
    if (query.length < 2) return { items: [] as FoundEmail[], total: 0 }

    const result = yield* Effect.try({
      try: () => {
        const r = finder.grep(query, {
          mode: "fuzzy",
          smartCase: true,
          pageSize,
          maxFileSize: 5 * 1024 * 1024,
          maxMatchesPerFile: 2,
        })
        if (!r.ok) throw new Error(r.error)
        return r.value
      },
      catch: (e) => new Error(`search failed: ${e}`),
    })

    const items = result.items.map(parseGrepMatch)
    items.sort((a, b) => {
      if (a.matchType !== b.matchType) return a.matchType === "header" ? -1 : 1
      return 0
    })

    return { items, total: result.totalMatched } as const
  }).pipe(
    Effect.catchAll(() => Effect.succeed({ items: [] as FoundEmail[], total: 0 } as const)),
  )
