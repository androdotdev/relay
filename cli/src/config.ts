import { homedir } from "node:os";
import { writeFileSync, readFileSync, mkdirSync, existsSync, statSync, rmSync } from "node:fs";
import { resolve } from "node:path";

// Config file lives at $XDG_CONFIG_HOME/.relay/config.json (0600), falling
// back to ~/.config/.relay/config.json when XDG_CONFIG_HOME is unset. The API
// key is stored here in plaintext at 0600 — there is no OS keyring dependency,
// so the CLI behaves identically on headless/CI/WSL and inside tmux sessions.
// Paths are resolved per call so tests can swap HOME / XDG_CONFIG_HOME.

export interface PtdConfig {
  api_key?: string;
  url?: string;
}

function configPaths() {
  const base = process.env.XDG_CONFIG_HOME || resolve(homedir(), ".config");
  const dir = resolve(base, ".relay");
  return { dir, file: resolve(dir, "config.json") };
}

/** Absolute path to the config file — used for user-facing messages. */
export function configFilePath(): string {
  return configPaths().file;
}

// One-time move from the pre-XDG location (~/.post/config.json). Runs only
// when the XDG file doesn't exist yet; copies then removes the old file.
function migrateLegacyConfig(): void {
  const { dir, file } = configPaths();
  if (existsSync(file)) return;
  const legacy = resolve(homedir(), ".post", "config.json");
  if (!existsSync(legacy)) return;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(file, readFileSync(legacy, "utf-8"), { mode: 0o600 });
  rmSync(legacy, { force: true });
}

function readFileConfig(): PtdConfig | null {
  migrateLegacyConfig();
  const { file } = configPaths();
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf-8")) as PtdConfig;
  } catch {
    return null;
  }
}

function writeFileConfig(config: PtdConfig): void {
  const { dir, file } = configPaths();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(file, JSON.stringify(config, null, 2), { mode: 0o600 });
}

/** Key resolution: the config file, then "". */
export async function loadConfig(): Promise<PtdConfig> {
  const file = readFileConfig();
  return {
    api_key: file?.api_key,
    url: file?.url,
  };
}

/**
 * Persist config to the config file (0600). The API key is written in
 * plaintext — there is no OS keyring, so behavior is identical everywhere.
 */
export async function saveConfig(config: PtdConfig): Promise<void> {
  writeFileConfig(config);
}

/** Config file permission check — 0600 as written, loosened only by umask. */
export function configFileMode(): number | null {
  const { file } = configPaths();
  if (!existsSync(file)) return null;
  return statSync(file).mode & 0o777;
}
