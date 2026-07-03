import { FileFinder } from "@ff-labs/fff-node"
import {
  createCliRenderer, Box, ASCIIFont, Text,
  SelectRenderable, SelectRenderableEvents, BoxRenderable,
  TabSelectRenderable, TabSelectRenderableEvents,
  ScrollBoxRenderable, TextAttributes,
} from "@opentui/core"
import { Cause, Effect, Exit } from "effect"
import { loadConfigEffect } from "./config"
import { listEnvelopesEffect, getEmailEffect, formatDate, listFoldersEffect, cleanFolderName } from "./maildir"
import { syncNowEffect } from "./mbsync"
import type { EmailEnvelope } from "./types"
import { watch } from "node:fs"
import { join } from "node:path"

const renderer = await createCliRenderer({ exitOnCtrlC: true })
const configExit = await Effect.runPromiseExit(loadConfigEffect())
if (Exit.isFailure(configExit)) {
  process.stderr.write(`${Cause.pretty(configExit.cause)}\n`)
  process.exit(1)
}
const config = configExit.value
const finderResult = FileFinder.create({ basePath: config.maildir, aiMode: true })
const finder = finderResult.ok ? finderResult.value : null

let finderReady = false
if (finder) {
  void finder.waitForIndexReady(20000).then((result) => {
    finderReady = result.ok && result.value
  })
}

let envelopes: EmailEnvelope[] = []
let syncInProgress = false
let selectedEmailId: string | null = null
let reloadTimer: ReturnType<typeof setTimeout> | null = null
let currentFolder = "INBOX"
let searchMode = false
let searchPromptMode = false
let searchQuery = ""
let searchStatus = ""
let lastSearchOptions: { name: string; description: string; value: string }[] = []
let canReturnToSearch = false

const MONO_BG = "#000000"
const MONO_FG = "#FFFFFF"

const mainContent = new BoxRenderable(renderer, {
  id: "main-content",
  flexGrow: 2,
  backgroundColor: MONO_BG,
  borderStyle: "rounded",
  borderColor: MONO_FG,
  flexDirection: "column",
  padding: 0,
})

function describeError(error: unknown): string {
  if (typeof error === "object" && error !== null && "_tag" in error) { const tag = typeof error._tag === "string" ? error._tag : "error"
    if ("message" in error && typeof error.message === "string") {
      return `${tag}: ${error.message}`
    }
    return tag
  }
  if (error instanceof Error) return error.message
  return "unexpected error"
}

function runUi<A>(effect: Effect.Effect<A, unknown, never>) {
  void Effect.runPromiseExit(effect).then((exit) => {
    if (Exit.isFailure(exit)) {
      setStatus(describeError(Cause.squash(exit.cause)))
    }
  })
}

function clearMainContent() {
  for (const child of [...mainContent.getChildren()]) child.destroy()
}

function showSplash(msg?: string) {
  clearMainContent()
  mainContent.add(
    Box(
      {
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        width: "100%",
        height: "100%",
      },
      ASCIIFont({ text: "ffail", font: "huge", color: MONO_FG }),
      Text({ content: msg ?? "select an email", fg: MONO_FG }),
    ),
  )
}

function setStatus(msg: string) {
  for (const child of [...statusBar.getChildren()]) child.destroy()
  statusBar.add(Text({ content: ` ${msg}`, fg: MONO_FG }))
}

function folderStatus() {
  const count = envelopes.length
  return `${cleanFolderName(currentFolder)} — ${count} email${count === 1 ? "" : "s"}`
}

function restoreFolderListEffect() {
  return Effect.gen(function* () {
    searchMode = false
    searchPromptMode = false
    searchQuery = ""
    searchStatus = ""
    lastSearchOptions = []
    canReturnToSearch = false
    selectedEmailId = null
    yield* loadEmailsEffect
    showSplash()
    setStatus(folderStatus())
    emailSelect.focus()
  })
}

function restoreSearchResultsEffect() {
  return Effect.sync(() => {
    searchMode = true
    searchPromptMode = false
    searchQuery = ""
    canReturnToSearch = false
    selectedEmailId = null

    emailSelect.options = lastSearchOptions.length === 0
      ? [{ name: "(no matches)", description: "try a different query", value: "" }]
      : lastSearchOptions

    showSplash("search results")
    setStatus(searchStatus)
    emailSelect.focus()
  })
}

function parseMaildirRelativePath(relativePath: string): { folder: string; id: string } | null {
  const normalized = relativePath.replaceAll("\\", "/")
  const parts = normalized.split("/")

  if (parts.length < 3) return null

  const mailboxDir = parts[parts.length - 2]
  const id = parts[parts.length - 1]

  if ((mailboxDir !== "new" && mailboxDir !== "cur") || !id) return null

  const folder = parts.slice(0, -2).join("/")
  if (!folder) return null

  return { folder, id }
}

function summarizeLine(line: string): string {
  const compact = line.replace(/\s+/g, " ").trim()
  if (!compact) return "(match in message body)"
  return compact.length > 88 ? `${compact.slice(0, 85)}...` : compact
}

const refreshFinderIndexEffect = Effect.sync(() => {
  if (!finder) return
  void finder.scanFiles()
})

const searchEmailsEffect = (query: string) => Effect.sync(() => {
  if (!finder) {
    setStatus(`search unavailable — ${finderResult.ok ? "index not ready" : finderResult.error}`)
    return
  }

  const result = finder.grep(query, {
    mode: "plain",
    pageSize: 200,
    maxMatchesPerFile: 2,
    timeBudgetMs: 2500,
  })

  if (!result.ok) {
    setStatus(`search failed — ${result.error}`)
    return
  }

  const seen = new Set<string>()
  const options: { name: string; description: string; value: string }[] = result.value.items.flatMap((item) => {
    const parsed = parseMaildirRelativePath(item.relativePath)
    if (!parsed) return []

    const key = `${parsed.folder}/${parsed.id}`
    if (seen.has(key)) return []
    seen.add(key)

    return [{
      name: item.fileName,
      description: `${cleanFolderName(parsed.folder)} · ${item.lineNumber}: ${summarizeLine(item.lineContent)}`,
      value: item.relativePath,
    }]
  })

  searchMode = true
  canReturnToSearch = false
  selectedEmailId = null
  lastSearchOptions = options

  emailSelect.options = options.length === 0
    ? [{ name: "(no matches)", description: "try a different query", value: "" }]
    : options

  if (finderReady) {
    searchStatus = `search "${query}" — ${options.length} match${options.length === 1 ? "" : "es"}`
  } else {
    searchStatus = `search "${query}" — ${options.length} match${options.length === 1 ? "" : "es"} (indexing...)`
  }
  setStatus(searchStatus)
  emailSelect.focus()
})

const loadEmailsEffect = Effect.gen(function* () {
  const nextEnvelopes = yield* listEnvelopesEffect(join(config.maildir, currentFolder), 50)
  envelopes = nextEnvelopes
  emailSelect.options = envelopes.length === 0
    ? [{ name: "(empty)", description: "no emails in this folder", value: "" }]
    : envelopes.map(e => ({
        name: e.isRead ? e.from : `● ${e.from}`,
        description: e.subject,
        value: e.id,
      }))

  if (selectedEmailId) {
    const stillExists = envelopes.some(e => e.id === selectedEmailId)
    if (!stillExists) selectedEmailId = null
  }
  if (!selectedEmailId) showSplash()
}).pipe(Effect.catchAll((error) => Effect.sync(() => setStatus(`error loading folder: ${describeError(error)}`))))

const openEmailEffect = (id: string) => Effect.gen(function* () {
  selectedEmailId = id
  clearMainContent()
  mainContent.add(Text({ content: "Loading...", fg: MONO_FG }))

  const email = yield* getEmailEffect(join(config.maildir, currentFolder), id)
  clearMainContent()

  const bodyScroll = new ScrollBoxRenderable(renderer, {
    id: "email-body-scroll",
    width: "100%",
    flexGrow: 1,
    scrollY: true,
    scrollX: true,
    viewportCulling: true,
  })
  bodyScroll.add(
    Text({
      content: email.body,
      fg: MONO_FG,
      selectable: true,
    }),
  )

  mainContent.add(
    Box(
      {
        flexDirection: "column",
        padding: 1,
        gap: 0,
        flexGrow: 1,
      },
      Text({ content: email.from, fg: MONO_FG, attributes: TextAttributes.BOLD }),
      Text({ content: email.subject, fg: MONO_FG }),
      Text({ content: formatDate(email.date), fg: MONO_FG }),
      Text({ content: "" }),
      bodyScroll,
    ),
  )
}).pipe(Effect.catchAll((error) => Effect.sync(() => {
  showSplash("error loading email")
  setStatus(describeError(error))
})))


const switchFolderEffect = (name: string, clearSearch = true) => Effect.gen(function* () {
  currentFolder = name
  selectedEmailId = null
  if (clearSearch) {
    searchMode = false
    searchPromptMode = false
    searchQuery = ""
    searchStatus = ""
    lastSearchOptions = []
    canReturnToSearch = false
  }
  showSplash("loading...")
  setStatus(`${cleanFolderName(name)} — loading...`)
  yield* loadEmailsEffect
  setStatus(folderStatus())
  emailSelect.focus()
})

const loadFoldersIntoTabsEffect = Effect.gen(function* () {
  const folders = yield* listFoldersEffect(config.maildir)
  const currentValid = folders.find(f => f.name === currentFolder)
  if (!currentValid) currentFolder = "INBOX"

  folderTabs.setOptions(
    folders.map((f) => ({
      name: f.unread > 0 ? `${cleanFolderName(f.name)} · ${f.unread}` : cleanFolderName(f.name),
      description: f.name,
      value: f.name,
    }))
  )
  const idx = folders.findIndex(f => f.name === currentFolder)
  if (idx >= 0) folderTabs.setSelectedIndex(idx)
}).pipe(Effect.catchAll((error) => Effect.sync(() => {
  setStatus(`error loading folders: ${describeError(error)}`)
})))

const triggerSyncEffect = Effect.gen(function* () {
  if (syncInProgress) return

  syncInProgress = true
  yield* Effect.gen(function* () {
    setStatus("syncing...")
    showSplash("syncing...")

    const result = yield* syncNowEffect.pipe(
      Effect.catchAll((error) => Effect.succeed({ success: false, output: describeError(error) })),
    )

    if (result.success) {
      setStatus("sync complete")
      yield* loadFoldersIntoTabsEffect
      yield* loadEmailsEffect
      yield* refreshFinderIndexEffect
    } else {
      setStatus(`sync failed — ${result.output || "check mbsync config"}`)
      showSplash("sync failed")
    }
  }).pipe(Effect.ensuring(
    Effect.sync(() => {
      syncInProgress = false
    })
  ))
})

const emailSelect = new SelectRenderable(renderer, {
  id: "email-select",
  width: "100%",
  flexGrow: 1,
  options: [],
  selectedBackgroundColor: MONO_FG,
  selectedTextColor: MONO_BG,
  textColor: MONO_FG,
  descriptionColor: MONO_FG,
})

emailSelect.focus()
emailSelect.on(SelectRenderableEvents.ITEM_SELECTED, (_index, option) => {
  if (!option.value || typeof option.value !== "string") return

  if (searchMode) {
    const parsed = parseMaildirRelativePath(option.value)
    if (!parsed) return

    runUi(Effect.gen(function* () {
      searchMode = false
      searchPromptMode = false
      searchQuery = ""
      canReturnToSearch = true
      yield* switchFolderEffect(parsed.folder, false)
      yield* openEmailEffect(parsed.id)
      setStatus(`${searchStatus} · [esc] back to results`)
    }))
    return
  }

  runUi(openEmailEffect(option.value))
})

const sidebarBox = new BoxRenderable(renderer, {
  id: "sidebar",
  flexGrow: 1,
  minWidth: 30,
  backgroundColor: MONO_BG,
  borderStyle: "rounded",
  borderColor: MONO_FG,
  flexDirection: "column",
  padding: 0,
})
sidebarBox.add(emailSelect)

const folderTabs = new TabSelectRenderable(renderer, {
  id: "folder-tabs",
  width: "100%",
  options: [{ name: "loading...", description: "", value: "" }],
  backgroundColor: MONO_BG,
  textColor: MONO_FG,
  selectedBackgroundColor: MONO_FG,
  selectedTextColor: MONO_BG,
  showUnderline: true,
  showDescription: false,
  tabWidth: 18,
})

function switchToFolderOption(option: { value?: unknown }) {
  if (option.value && typeof option.value === "string" && option.value !== currentFolder) {
    runUi(switchFolderEffect(option.value))
  }
}

folderTabs.on(TabSelectRenderableEvents.ITEM_SELECTED, (_index, option) => {
  switchToFolderOption(option)
})

const statusBar = new BoxRenderable(renderer, {
  id: "status-bar",
  height: 1,
  backgroundColor: MONO_BG,
  flexDirection: "row",
  paddingLeft: 1,
})

showSplash("loading...")
setStatus("loading...")

renderer.addInputHandler((sequence) => {
  if (searchPromptMode) {
    if (sequence === "\x1b") {
      searchPromptMode = false
      searchQuery = ""
      setStatus(searchStatus || folderStatus())
      return true
    }

    if (sequence === "\r" || sequence === "\n") {
      const query = searchQuery.trim()
      searchPromptMode = false
      searchQuery = ""

      if (!query) {
        setStatus(searchStatus || folderStatus())
        return true
      }

      runUi(searchEmailsEffect(query))
      return true
    }

    if (sequence === "\x7f") {
      searchQuery = searchQuery.slice(0, -1)
      setStatus(`search: ${searchQuery}`)
      return true
    }

    if (/^[ -~]$/.test(sequence)) {
      searchQuery += sequence
      setStatus(`search: ${searchQuery}`)
      return true
    }

    return true
  }

  if (sequence === "\x1b[D") {
    folderTabs.moveLeft()
    const option = folderTabs.getSelectedOption()
    if (option) switchToFolderOption(option)
    return true
  }
  if (sequence === "\x1b[C") {
    folderTabs.moveRight()
    const option = folderTabs.getSelectedOption()
    if (option) switchToFolderOption(option)
    return true
  }
  if (sequence === "\x1b") {
    if (searchMode) {
      runUi(restoreFolderListEffect())
      return true
    }

    if (selectedEmailId && canReturnToSearch) {
      runUi(restoreSearchResultsEffect())
      return true
    }

    selectedEmailId = null
    showSplash()
    emailSelect.focus()
    return true
  }
  if (sequence === "/") {
    searchPromptMode = true
    searchQuery = ""
    setStatus("search: ")
    return true
  }
  if (sequence === "r") {
    runUi(triggerSyncEffect)
    return true
  }
  return false
})

renderer.root.add(
  Box(
    {
      flexDirection: "column",
      width: "100%",
      height: "100%",
    },
    Box(
      {
        flexDirection: "row",
        width: "100%",
        backgroundColor: MONO_BG,
        paddingLeft: 0,
        paddingRight: 0,
      },
      folderTabs,
    ),
    Box(
      {
        flexDirection: "row",
        width: "100%",
        flexGrow: 1,
      },
      sidebarBox,
      mainContent,
    ),
    Box(
      {
        flexDirection: "row",
        height: 1,
        backgroundColor: MONO_BG,
        paddingLeft: 1,
      },
      Text({ content: " [/] search  [r] sync  [esc] back", fg: MONO_FG }),
      statusBar,
    ),
  ),
)

runUi(
  Effect.gen(function* () {
    yield* loadFoldersIntoTabsEffect
    yield* loadEmailsEffect
    setStatus(folderStatus())
  })
)

try {
  watch(config.maildir, { recursive: true }, () => {
    if (reloadTimer) clearTimeout(reloadTimer)
    reloadTimer = setTimeout(() => {
      runUi(
        Effect.gen(function* () {
          yield* loadFoldersIntoTabsEffect
          yield* loadEmailsEffect
          yield* refreshFinderIndexEffect
          if (!searchMode && !searchPromptMode) {
            setStatus(folderStatus())
          }
        })
      )
    }, 500)
  })
} catch {
  // file watching unavailable
}

process.on("exit", () => {
  finder?.destroy()
})
