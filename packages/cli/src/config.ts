import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

export interface ExtermConfig {
  lastHost?: string;
  lastToken?: string;
  lastProjectDir?: string;
  preferredPort?: number;
}

const CONFIG_DIR = join(homedir(), ".exterm");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

async function ensureConfigDir(): Promise<void> {
  if (!existsSync(CONFIG_DIR)) {
    await mkdir(CONFIG_DIR, { recursive: true });
  }
}

export async function loadConfig(): Promise<ExtermConfig> {
  await ensureConfigDir();
  if (!existsSync(CONFIG_FILE)) {
    return {};
  }
  try {
    const content = await readFile(CONFIG_FILE, "utf-8");
    return JSON.parse(content) as ExtermConfig;
  } catch {
    return {};
  }
}

export async function saveConfig(config: Partial<ExtermConfig>): Promise<void> {
  await ensureConfigDir();
  const existing = await loadConfig();
  const updated = { ...existing, ...config };
  await writeFile(CONFIG_FILE, JSON.stringify(updated, null, 2), "utf-8");
}

export async function getLastHost(): Promise<string | undefined> {
  const config = await loadConfig();
  return config.lastHost;
}

export async function setLastHost(host: string): Promise<void> {
  await saveConfig({ lastHost: host });
}

export async function getLastToken(): Promise<string | undefined> {
  const config = await loadConfig();
  return config.lastToken;
}

export async function setLastToken(token: string): Promise<void> {
  await saveConfig({ lastToken: token });
}

export async function getLastProjectDir(): Promise<string | undefined> {
  const config = await loadConfig();
  return config.lastProjectDir;
}

export async function setLastProjectDir(dir: string): Promise<void> {
  await saveConfig({ lastProjectDir: dir });
}

export async function getPreferredPort(): Promise<number | undefined> {
  const config = await loadConfig();
  return config.preferredPort;
}

export async function setPreferredPort(port: number): Promise<void> {
  await saveConfig({ preferredPort: port });
}