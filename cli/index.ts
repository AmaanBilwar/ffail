import {
  createCliRenderer, Box, ASCIIFont, Text,
  SelectRenderable, SelectRenderableEvents, BoxRenderable,
} from "@opentui/core"

interface Email {
  id: number
  from: string
  subject: string
  body: string
  date: string
}

const emails: Email[] = [
  {
    id: 1,
    from: "Alice Johnson",
    subject: "Team standup notes",
    body: "Hey team,\n\nHere are the notes from today's standup:\n\n- Backend API changes are on track\n- Frontend needs design review\n- Deploy scheduled for Friday\n\nLet me know if I missed anything.\n\nBest,\nAlice",
    date: "Jan 15",
  },
  {
    id: 2,
    from: "Bob Chen",
    subject: "Re: Project timeline update",
    body: "Thanks for the update.\n\nI've reviewed the timeline and made a few adjustments. The new ETA is end of Q2.\n\nKey blockers:\n- Third-party SDK integration\n- Security audit sign-off\n\nLet's discuss in tomorrow's sync.\n\nCheers,\nBob",
    date: "Jan 14",
  },
  {
    id: 3,
    from: "Carol Davis",
    subject: "Lunch this Friday?",
    body: "Hey everyone,\n\nAnyone up for trying that new ramen place this Friday? I heard the tonkotsu is amazing.\n\nI was thinking around 12:30pm. Let me know if you're in!\n\n--\nCarol",
    date: "Jan 13",
  },
  {
    id: 4,
    from: "GitHub",
    subject: "[repo] PR #142 review requested",
    body: "You have been requested to review PR #142: Add user authentication flow.\n\nAuthor: @bobchen\n\nChanges: +245 / -67 lines\n\nFiles changed:\n- src/auth/login.tsx\n- src/auth/hooks.ts\n- src/api/session.ts\n\nView on GitHub: https://github.com/org/repo/pull/142",
    date: "Jan 12",
  },
  {
    id: 5,
    from: "Sarah Miller",
    subject: "Q1 Budget Report",
    body: "Hi all,\n\nPlease find attached the Q1 budget report for review.\n\nSummary:\n- Revenue: $1.2M (+15% vs Q4)\n- Expenses: $890K\n- Net: $310K\n\nHighlights:\n- Engineering costs down 8%\n- Marketing spend up 22% (new campaign)\n\nLet me know if you have questions.\n\nBest,\nSarah",
    date: "Jan 11",
  },
  {
    id: 6,
    from: "David Park",
    subject: "Server maintenance window",
    body: "Team,\n\nScheduled maintenance this Saturday from 2-4 AM PST.\n\nImpact:\n- All services will be unavailable for ~2 hours\n- Database migration in progress\n- New CDN configuration being deployed\n\nPlease push any deployments before Friday EOD.\n\nThanks,\nDavid",
    date: "Jan 10",
  },
  {
    id: 7,
    from: "Emily Watson",
    subject: "Design system updates",
    body: "Hey team,\n\nI've published the new component library (v2.1.0) with the updated design tokens.\n\nWhat's new:\n- New color palette\n- Updated typography scale\n- New button variants\n- Dark mode support\n\nCheck it out at: https://design-system.internal/\n\nCheers,\nEmily",
    date: "Jan 09",
  },
  {
    id: 8,
    from: "Frank Lopez",
    subject: "Client feedback - proposal draft",
    body: "All,\n\nThe client reviewed our proposal draft and provided feedback.\n\nAction items:\n1. Reduce scope to core features only\n2. Add pricing breakdown table\n3. Include case study references\n4. Revise timeline (they want it faster)\n\nI'll send out the updated version by Wednesday.\n\n- Frank",
    date: "Jan 08",
  },
]

const renderer = await createCliRenderer({
  exitOnCtrlC: true,
})

const mainContent = new BoxRenderable(renderer, {
  id: "main-content",
  flexGrow: 2,
  backgroundColor: "#16213e",
  borderStyle: "rounded",
  borderColor: "#0f3460",
  flexDirection: "column",
})

function clearMainContent() {
  for (const child of [...mainContent.getChildren()]) {
    child.destroy()
  }
}

function showSplash() {
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
      Text({ content: "select an email from the sidebar", fg: "#555555" }),
    ),
  )
}

function showEmail(email: Email) {
  clearMainContent()
  mainContent.add(
    Box(
      {
        flexDirection: "column",
        padding: 2,
        gap: 1,
        width: "100%",
      },
      Text({ content: `From:    ${email.from}`, fg: "#e94560" }),
      Text({ content: `Subject: ${email.subject}`, fg: "#FFFFFF" }),
      Text({ content: `Date:    ${email.date}`, fg: "#888888" }),
      Text({ content: "─".repeat(50), fg: "#333333" }),
      Text({ content: email.body, fg: "#CCCCCC" }),
    ),
  )
}

showSplash()

const emailSelect = new SelectRenderable(renderer, {
  id: "email-select",
  width: "100%",
  height: "100%",
  options: emails.map(e => ({
    name: e.from,
    description: e.subject,
    value: e.id,
  })),
  selectedBackgroundColor: "#e94560",
  selectedTextColor: "#FFFFFF",
  textColor: "#CCCCCC",
  descriptionColor: "#888888",
})

emailSelect.focus()
emailSelect.on(SelectRenderableEvents.ITEM_SELECTED, (_index, option) => {
  const email = emails.find(e => e.id === option.value)
  if (email) showEmail(email)
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

renderer.addInputHandler((sequence) => {
  if (sequence === "\x1b") {
    showSplash()
    emailSelect.focus()
    return true
  }
  return false
})

renderer.root.add(
  Box(
    {
      flexDirection: "row",
      width: "100%",
      height: "100%",
    },
    sidebarBox,
    mainContent,
  ),
)
