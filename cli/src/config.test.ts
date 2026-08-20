import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, existsSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

// Config-file isolation: configPaths() reads XDG_CONFIG_HOME fresh on every
// call, so pointing it at a temp dir per test fully isolates state (os.homedir
// caches the real home and can't be redirected). The legacy ~/.post migration
// path uses homedir(), so that one test writes there and cleans up after.
let xdg = "";

async function importConfig() {
  const mod = await import("./config.js");
  return mod;
}

beforeEach(() => {
  xdg = mkdtempSync(join(tmpdir(), "post-cli-test-"));
  process.env.XDG_CONFIG_HOME = xdg;
});

afterEach(() => {
  delete process.env.XDG_CONFIG_HOME;
  rmSync(join(homedir(), ".post"), { recursive: true, force: true });
});

describe("saveConfig", () => {
  it("stores the key and url in the config file at 0600", async () => {
    const { saveConfig, loadConfig, configFileMode } = await importConfig();
    await saveConfig({ api_key: "post_abc", url: "https://x.example" });

    const file = join(xdg, ".relay", "config.json");
    expect(existsSync(file)).toBe(true);
    expect(JSON.parse(readFileSync(file, "utf-8"))).toEqual({ api_key: "post_abc", url: "https://x.example" });
    expect(await loadConfig()).toEqual({ api_key: "post_abc", url: "https://x.example" });
    expect(configFileMode()).toBe(0o600);
  });

  it("writes a url-only config without an api_key", async () => {
    const { saveConfig } = await importConfig();
    await saveConfig({ url: "https://y.example" });
    const file = join(xdg, ".relay", "config.json");
    expect(JSON.parse(readFileSync(file, "utf-8"))).toEqual({ url: "https://y.example" });
  });
});

describe("loadConfig", () => {
  it("returns an empty config when nothing is stored", async () => {
    const { loadConfig } = await importConfig();
    expect(await loadConfig()).toEqual({ api_key: undefined, url: undefined });
  });

  it("honors XDG_CONFIG_HOME when set", async () => {
    const { loadConfig } = await importConfig();
    const xdg2 = mkdtempSync(join(tmpdir(), "post-cli-xdg-"));
    process.env.XDG_CONFIG_HOME = xdg2;
    mkdirSync(join(xdg2, ".relay"), { recursive: true });
    writeFileSync(join(xdg2, ".relay", "config.json"), JSON.stringify({ api_key: "post_xdg" }));

    expect((await loadConfig()).api_key).toBe("post_xdg");
  });

  it("migrates a legacy ~/.post/config.json on first read", async () => {
    const { loadConfig } = await importConfig();
    mkdirSync(join(homedir(), ".post"), { recursive: true });
    writeFileSync(join(homedir(), ".post", "config.json"), JSON.stringify({ api_key: "post_old", url: "https://z.example" }));

    expect(await loadConfig()).toEqual({ api_key: "post_old", url: "https://z.example" });
    expect(existsSync(join(homedir(), ".post", "config.json"))).toBe(false);
    expect(JSON.parse(readFileSync(join(xdg, ".relay", "config.json"), "utf-8"))).toEqual({ api_key: "post_old", url: "https://z.example" });
  });
});
