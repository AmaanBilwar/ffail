import { readFile, writeFile, mkdir } from "node:fs/promises"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { FfailConfig } from "./types"

const CONFIG_DIR = join(homedir(), ".ffail")
const CONFIG_PATH = join(CONFIG_DIR, "config.json")

const DEFAULT_CONFIG: FfailConfig = {
  maildir: join(CONFIG_DIR, "mail"),
  defaultAccount: "INBOX",
}

export async function loadConfig(): Promise<FfailConfig> {
  if (!existsSync(CONFIG_PATH)) {
    await mkdir(CONFIG_DIR, { recursive: true })
    await writeFile(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2))
    return { ...DEFAULT_CONFIG }
  }

  const data = await readFile(CONFIG_PATH, "utf-8")
  return { ...DEFAULT_CONFIG, ...JSON.parse(data) }
}
