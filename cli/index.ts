import { FileFinder } from "@ff-labs/fff-node"
import {
  createCliRenderer, Box, ASCIIFont, Text,
  SelectRenderable, SelectRenderableEvents, BoxRenderable,
  TabSelectRenderable, TabSelectRenderableEvents,
  ScrollBoxRenderable, TextAttributes,
} from "@opentui/core"
import { Effect } from "effect"
import { loadConfigEffect } from "./config"
import { listEnvelopesEffect, getEmailEffect, formatDate, listFoldersEffect, cleanFolderName } from "./maildir"
import { syncNowEffect } from "./mbsync"
import { searchEmailsEffect, encodeSearchValue, decodeSearchValue } from "./search"
import type { FoundEmail } from "./search"
import type { EmailEnvelope } from "./types"
import { readFile } from "node:fs/promises"
import { simpleParser } from "mailparser"
import { watch } from "node:fs"
import { join } from "node:path"

const renderer = await createCliRenderer({ exitOnCtrlC: true })
const config = await Effect.runPromise(loadConfigEffect())

let finder: FileFinder
const finderResult = FileFinder.create({ basePath: config.maildir, aiMode: true })
if (finderResult.ok) {
  finder = finderResult.value
} else {
  console.error("fff init:", finderResult.error)
  process.exit(1)
}

let envelopes: EmailEnvelope[] = []
let syncInProgress = false
let selectedEmailId: string | null = null
let reloadTimer: ReturnType<typeof setTimeout> | null = null
let currentFolder = "INBOX"
let searchMode = false
let searchQuery = ""
let searchResults: FoundEmail[] | null = null
let indexReady = false

const mainContent = new BoxRenderable(renderer, {
  id: "main-content",
  flexGrow: 2,
  backgroundColor: "#16213e",
  borderStyle: "rounded",
  borderColor: "#0f3460",
  flexDirection: "column",
  padding: 0,
})

function runUi<A>(effect: Effect.Effect<A, unknown, never>) {
  void Effect.runPromise(effect).catch(() => {
    setStatus("unexpected error")
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
      ASCIIFont({ text: "ffail", font: "huge", color: "#e94560" }),
      Text({ content: msg ?? "select an email", fg: "#555555" }),
    ),
  )
}

function setStatus(msg: string) {
  for (const child of [...statusBar.getChildren()]) child.destroy()
  statusBar.add(Text({ content: ` ${msg}`, fg: "#888888" }))
}

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
}).pipe(Effect.catchAll(() => Effect.sync(() => setStatus("error loading folder"))))

const openEmailEffect = (id: string) => Effect.gen(function* () {
  selectedEmailId = id
  clearMainContent()
  mainContent.add(Text({ content: "Loading...", fg: "#555555" }))

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
      fg: "#CCCCCC",
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
      Text({ content: email.from, fg: "#e94560", attributes: TextAttributes.BOLD }),
      Text({ content: email.subject, fg: "#FFFFFF" }),
      Text({ content: formatDate(email.date), fg: "#555555" }),
      Text({ content: "" }),
      bodyScroll,
    ),
  )
}).pipe(
  Effect.catchAll(() => Effect.sync(() => {
    showSplash("error loading email")
  }))
)


const switchFolderEffect = (name: string) => Effect.gen(function* () {
  exitSearchMode()
  currentFolder = name
  selectedEmailId = null
  showSplash("loading...")
  setStatus(`${cleanFolderName(name)} — loading...`)
  yield* loadEmailsEffect
  const f = envelopes.length
  setStatus(`${cleanFolderName(name)} — ${f} email${f === 1 ? "" : "s"}`)
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
}).pipe(
  Effect.catchAll(() => Effect.sync(() => {
    setStatus("error loading folders")
  }))
)

function exitSearchMode() {
  searchMode = false
  searchQuery = ""
  searchResults = null
}

const openEmailFromSearchEffect = (folder: string, filename: string, subdir: "cur" | "new") =>
  Effect.gen(function* () {
    selectedEmailId = filename
    clearMainContent()
    mainContent.add(Text({ content: "Loading...", fg: "#555555" }))

    const filePath = join(config.maildir, folder, subdir, filename)
    const buf = yield* Effect.tryPromise({
      try: () => readFile(filePath),
      catch: (cause) => new Error(`read failed: ${cause}`),
    })
    const parsed = yield* Effect.tryPromise({
      try: () => simpleParser(buf),
      catch: (cause) => new Error(`parse failed: ${cause}`),
    })
    const email = {
      id: filename,
      from: parsed.from?.text || "Unknown",
      subject: parsed.subject || "(no subject)",
      date: parsed.date || new Date(0),
      isRead: subdir === "cur",
      body: parsed.text || (parsed.html ? parsed.html.replace(/<[^>]*>/g, "").trim() : "") || "(no content)",
    }
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
        fg: "#CCCCCC",
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
        Text({ content: `${cleanFolderName(folder)} — ${email.from}`, fg: "#e94560", attributes: TextAttributes.BOLD }),
        Text({ content: email.subject, fg: "#FFFFFF" }),
        Text({ content: formatDate(email.date), fg: "#555555" }),
        Text({ content: "" }),
        bodyScroll,
      ),
    )
    setStatus(`search result — ${cleanFolderName(folder)}`)
  }).pipe(
    Effect.catchAll(() => Effect.sync(() => showSplash("error loading email"))),
  )

const runSearchEffect = (query: string) =>
  Effect.gen(function* () {
    setStatus(`searching: ${query}...`)
    const { items } = yield* searchEmailsEffect(finder, query)
    searchResults = items

    if (items.length === 0) {
      setStatus(`search "${query}" — no results`)
      return
    }

    emailSelect.options = items.map((e) => ({
      name: `${e.matchType === "header" ? "H" : "B"} ${cleanFolderName(e.folder)} ${e.lineContent.slice(0, 58)}`,
      description: e.lineContent,
      value: encodeSearchValue(e),
    }))
    emailSelect.focus()
    setStatus(`search "${query}" — ${items.length} result${items.length === 1 ? "" : "s"}`)
  })

const triggerSyncEffect = Effect.gen(function* () {
  if (syncInProgress) return

  syncInProgress = true
  yield* Effect.gen(function* () {
    setStatus("syncing...")
    showSplash("syncing...")

    const result = yield* syncNowEffect.pipe(
      Effect.catchAll(() => Effect.succeed({ success: false, output: "" })),
    )

    if (result.success) {
      setStatus("sync complete")
      yield* loadFoldersIntoTabsEffect
      yield* loadEmailsEffect
    } else {
      setStatus("sync failed — check mbsync config")
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
  selectedBackgroundColor: "#e94560",
  selectedTextColor: "#FFFFFF",
  textColor: "#CCCCCC",
  descriptionColor: "#888888",
})

emailSelect.focus()
emailSelect.on(SelectRenderableEvents.ITEM_SELECTED, (_index, option) => {
  if (!option.value || typeof option.value !== "string") return

  if (searchResults !== null) {
    const found = decodeSearchValue(option.value)
    if (found) {
      const f = found
      exitSearchMode()
      runUi(openEmailFromSearchEffect(f.folder, f.filename, f.subdir))
    }
  } else {
    runUi(openEmailEffect(option.value))
  }
})

const sidebarBox = new BoxRenderable(renderer, {
  id: "sidebar",
  flexGrow: 1,
  minWidth: 30,
  backgroundColor: "#1a1a2e",
  borderStyle: "rounded",
  borderColor: "#0f3460",
  flexDirection: "column",
  padding: 0,
})
sidebarBox.add(emailSelect)

const folderTabs = new TabSelectRenderable(renderer, {
  id: "folder-tabs",
  width: "100%",
  options: [{ name: "loading...", description: "", value: "" }],
  backgroundColor: "#0f3460",
  textColor: "#888888",
  selectedBackgroundColor: "#e94560",
  selectedTextColor: "#FFFFFF",
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
  backgroundColor: "#0f3460",
  flexDirection: "row",
  paddingLeft: 1,
})

showSplash("loading...")
setStatus("loading...")

renderer.addInputHandler((sequence) => {
  if (searchMode) {
    // viewing search results — let nav/Enter through to SelectRenderable
    if (searchResults !== null) {
      if (sequence === "\x1b") {
        exitSearchMode()
        runUi(loadEmailsEffect)
        showSplash()
        emailSelect.focus()
        return true
      }
      return false
    }

    // typing query
    if (sequence === "\r") {
      runUi(runSearchEffect(searchQuery))
      return true
    }
    if (sequence === "\x1b") {
      exitSearchMode()
      showSplash()
      emailSelect.focus()
      return true
    }
    if (sequence === "\x7f" || sequence === "\b") {
      searchQuery = searchQuery.slice(0, -1)
      setStatus(`/${searchQuery}`)
      return true
    }
    if (sequence.length === 1 && sequence >= " ") {
      searchQuery += sequence
      setStatus(`/${searchQuery}`)
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
    selectedEmailId = null
    showSplash()
    emailSelect.focus()
    return true
  }
  if (sequence === "/") {
    if (!indexReady) {
      setStatus("indexing emails...")
      return true
    }
    searchMode = true
    searchQuery = ""
    searchResults = null
    setStatus("/")
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
        backgroundColor: "#0f3460",
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
        backgroundColor: "#0f3460",
        paddingLeft: 1,
      },
      Text({ content: " [/] search  [r] sync  [esc] back", fg: "#555555" }),
      statusBar,
    ),
  ),
)

runUi(
  Effect.gen(function* () {
    setStatus("indexing...")
    yield* Effect.promise(() => finder.waitForIndexReady(20000))
    indexReady = true
    yield* loadFoldersIntoTabsEffect
    yield* loadEmailsEffect
    const f = envelopes.length
    setStatus(`Inbox — ${f} email${f === 1 ? "" : "s"}`)
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
        })
      )
    }, 500)
  })
} catch {
  // file watching unavailable
}
