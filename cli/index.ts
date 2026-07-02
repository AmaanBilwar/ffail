import {
  createCliRenderer, Box, ASCIIFont, Text,
  SelectRenderable, SelectRenderableEvents, BoxRenderable,
  TabSelectRenderable, TabSelectRenderableEvents,
  ScrollBoxRenderable, TextAttributes,
} from "@opentui/core"

import { loadConfig } from "./config"
import { listEnvelopes, getEmail, formatDate, listFolders, cleanFolderName } from "./maildir"
import { syncNow } from "./mbsync"
import type { EmailEnvelope } from "./types"
import { watch } from "node:fs"
import { join } from "node:path"

const renderer = await createCliRenderer({ exitOnCtrlC: true })
const config = await loadConfig()

let envelopes: EmailEnvelope[] = []
let syncInProgress = false
let selectedEmailId: string | null = null
let reloadTimer: ReturnType<typeof setTimeout> | null = null
let currentFolder = "INBOX"

const mainContent = new BoxRenderable(renderer, {
  id: "main-content",
  flexGrow: 2,
  backgroundColor: "#16213e",
  borderStyle: "rounded",
  borderColor: "#0f3460",
  flexDirection: "column",
  padding: 0,
})

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

function updateEmailList() {
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
}

function folderPath(): string {
  return join(config.maildir, currentFolder)
}

async function loadEmails() {
  try {
    envelopes = await listEnvelopes(folderPath(), 50)
    updateEmailList()
  } catch {
    setStatus("error loading folder")
  }
}

async function openEmail(id: string) {
  selectedEmailId = id
  clearMainContent()
  mainContent.add(Text({ content: "Loading...", fg: "#555555" }))

  try {
    const email = await getEmail(folderPath(), id)
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
          width: "100%",
          height: "100%",
        },
        Text({ content: email.from, fg: "#e94560", attributes: TextAttributes.BOLD }),
        Text({ content: email.subject, fg: "#FFFFFF" }),
        Text({ content: formatDate(email.date), fg: "#555555" }),
        Text({ content: "" }),
        bodyScroll,
      ),
    )
  } catch {
    clearMainContent()
    showSplash("error loading email")
  }
}

async function switchFolder(name: string) {
  currentFolder = name
  selectedEmailId = null
  showSplash("loading...")
  setStatus(`${cleanFolderName(name)} — loading...`)
  await loadEmails()
  const f = envelopes.length
  setStatus(`${cleanFolderName(name)} — ${f} email${f === 1 ? "" : "s"}`)
  emailSelect.focus()
}

async function loadFoldersIntoTabs() {
  const folders = await listFolders(config.maildir)
  const currentValid = folders.find(f => f.name === currentFolder)
  if (!currentValid) currentFolder = "INBOX"

  folderTabs.setOptions(
    folders.map((f, i) => ({
      name: f.unread > 0 ? `${cleanFolderName(f.name)} · ${f.unread}` : cleanFolderName(f.name),
      description: f.name,
      value: f.name,
    }))
  )

  const idx = folders.findIndex(f => f.name === currentFolder)
  if (idx >= 0) folderTabs.setSelectedIndex(idx)
}

async function triggerSync() {
  if (syncInProgress) return
  syncInProgress = true
  setStatus("syncing...")
  showSplash("syncing...")

  const result = await syncNow()
  syncInProgress = false

  if (result.success) {
    setStatus("sync complete")
    await loadFoldersIntoTabs()
    await loadEmails()
  } else {
    setStatus("sync failed — check mbsync config")
    showSplash("sync failed")
  }
}

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
  if (option.value && typeof option.value === "string") openEmail(option.value)
})

const sidebarBox = new BoxRenderable(renderer, {
  id: "sidebar",
  flexGrow: 1,
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

folderTabs.on(TabSelectRenderableEvents.ITEM_SELECTED, (_index, option) => {
  if (option.value && typeof option.value === "string" && option.value !== currentFolder) {
    switchFolder(option.value)
  }
})
folderTabs.on(TabSelectRenderableEvents.SELECTION_CHANGED, (_index, option) => {
  if (option.value && typeof option.value === "string" && option.value !== currentFolder) {
    switchFolder(option.value)
  }
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
  if (sequence === "\x1b") {
    selectedEmailId = null
    showSplash()
    emailSelect.focus()
    return true
  }
  if (sequence === "r") {
    triggerSync()
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
      Text({ content: " [r] sync  [esc] back", fg: "#555555" }),
      statusBar,
    ),
  ),
)

loadFoldersIntoTabs().then(async () => {
  await loadEmails()
  const f = envelopes.length
  setStatus(`Inbox — ${f} email${f === 1 ? "" : "s"}`)
})

try {
  watch(config.maildir, { recursive: true }, () => {
    if (reloadTimer) clearTimeout(reloadTimer)
    reloadTimer = setTimeout(() => {
      loadFoldersIntoTabs()
      loadEmails()
    }, 500)
  })
} catch {
  // file watching unavailable
}
