import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Command } from "commander";
import chalk from "chalk";

import { loadConfig, saveConfig, configFilePath } from "./config.js";
import { extractTitle } from "./title.js";
import { version } from "../package.json";

const dim = chalk.dim;
const green = chalk.green;
const red = chalk.red;
const cyan = chalk.cyan;
const yellow = chalk.yellow;

const config = await loadConfig();
const API_KEY = config?.api_key ?? process.env.RELAY_API_KEY ?? process.env.POSTHTML_API_KEY ?? "";
const BASE_URL = (config?.url ?? process.env.POST_URL ?? "https://posthtml.vercel.app").replace(/\/+$/, "");

async function api(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      ...init?.headers,
      "x-api-key": API_KEY,
      "Content-Type": "application/json",
    },
  });
  // Error bodies aren't always JSON (proxies return HTML) — don't crash on parse
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    // leave body null; fall back to status text below
  }
  if (!res.ok) {
    const detail = body?.error ?? body?.message ?? (body !== null ? JSON.stringify(body) : res.statusText);
    if (res.status === 401) {
      console.error(red.bold("✗ Error 401: Unauthorized"), detail);
      console.error(dim(`Get a key at ${BASE_URL}/dashboard, then save it with: relay setup`));
    } else {
      console.error(red.bold(`✗ Error ${res.status}:`), detail);
    }
    process.exit(1);
  }
  return body;
}

function printPublishOutput(url: string, isPrivate?: boolean) {
  console.log(`\n${dim("Page URL:")} ${cyan(url)}`);
  const visibility = isPrivate ? red("[private]") : green("[public]");
  console.log(`${dim("Shareable:")} ${visibility}`);
}

import { readSecret } from "./input.js";

/**
 * Parse the --data / --data-file options shared by `publish` and `update`.
 * Returns null if neither was passed. Exits with an error on invalid JSON.
 */
function parseDataOption(options: { data?: string; dataFile?: string }): Record<string, unknown> | null {
  if (options.dataFile) {
    const content = readFileSync(resolve(options.dataFile), "utf-8");
    try {
      const parsed = JSON.parse(content);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        console.error(red(`✗ File "${options.dataFile}" must contain a JSON object`));
        process.exit(1);
      }
      return parsed;
    } catch {
      console.error(red(`✗ File "${options.dataFile}" is not valid JSON`));
      process.exit(1);
    }
  }
  if (options.data) {
    try {
      const parsed = JSON.parse(options.data);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        console.error(red("✗ --data must be a JSON object"));
        process.exit(1);
      }
      return parsed;
    } catch {
      console.error(red("✗ --data must be valid JSON"));
      process.exit(1);
    }
  }
  return null;
}

const program = new Command()
  .name("relay")
  .description("Relay CLI — publish, list, delete, and update pages")
  .version(version);

program
  .command("publish <file>")
  .description("Publish an HTML or Markdown page file")
  .option("-d, --data <json>", "JSON data to attach (merged into page data)")
  .option("--data-file <path>", "JSON file to merge into post.data")
  .option("-t, --title <title>", "Override the extracted title")
  .option("--mark", "Treat the file as Markdown (converted to HTML server-side)")
  .option("--private", "Make the page private (owner-only access)")
  .option("--public", "Make the page public (default, shareable)")
  .action(async (file: string, options: { data?: string; dataFile?: string; title?: string; mark?: boolean; private?: boolean; public?: boolean }) => {
    if (options.private && options.public) {
      console.error(red("✗ --private and --public are mutually exclusive"));
      process.exit(1);
    }
    const html = readFileSync(resolve(file), "utf-8");
    const data = parseDataOption(options);

    let isPrivate: boolean | undefined;
    if (options.private) isPrivate = true;
    else if (options.public) isPrivate = false;

    process.stdout.write(`${dim("→ Validating HTML structure...")}\n`);
    const isValid = /<!DOCTYPE html>/i.test(html);
    process.stdout.write(isValid ? `${green("✓ Valid markup")}\n\n` : `${yellow("⚠ No DOCTYPE found — continuing")}\n\n`);

    process.stdout.write(`${dim("→ Publishing...")}\n`);
    const title = options.title ?? extractTitle(html, file);
    const body: Record<string, unknown> = { html, title };
    if (options.mark) body.type = "markdown";
    if (isPrivate !== undefined) body.isPrivate = isPrivate;
    const result = await api("/api/posts", {
      method: "POST",
      body: JSON.stringify(body),
    });

    if (data) {
      process.stdout.write(`${dim("→ Attaching data...")}\n`);
      await api(`/api/posts/${result.id}/data`, {
        method: "PATCH",
        body: JSON.stringify(data),
      });
      process.stdout.write(`${green("✓ Data attached")}\n`);
    }

    process.stdout.write(`${green("✓ Publish complete")}\n`);
    printPublishOutput(result.url, result.isPrivate);
  });

program
  .command("list")
  .alias("ls")
  .description("List your pages")
  .action(async () => {
    process.stdout.write(`${dim("→ Fetching your pages...")}\n`);
    const posts = await api("/api/posts");
    if (posts.length === 0) {
      process.stdout.write(`${dim("No pages found.")}\n`);
      return;
    }
    process.stdout.write(`${green(`✓ ${posts.length} page${posts.length === 1 ? "" : "s"} loaded`)}\n\n`);
    const header = `${dim("Page ID")}          ${dim("Title")}                  ${dim("Created")}        ${dim("Access")}`;
    const sep = dim("─".repeat(72));
    console.log(`\n${header}\n${sep}`);
    for (const p of posts) {
      const title = p.title || dim("(untitled)");
      const created = dim(new Date(p.createdAt).toLocaleDateString());
      const access = p.isPrivate ? red("private") : green("public");
      console.log(`${cyan(p.id)}  ${title}  ${created}  ${access}`);
    }
    console.log();
  });

program
  .command("delete <id>")
  .description("Delete a page")
  .action(async (id: string) => {
    process.stdout.write(`${dim("→ Deleting page...")}\n`);
    await api(`/api/posts/${id}`, { method: "DELETE" });
    process.stdout.write(`${green(`✓ Page ${id} deleted`)}\n`);
  });

program
  .command("update <id> <file>")
  .description("Update a page with new HTML or Markdown content (preserves ID)")
  .option("-t, --title <title>", "Override the extracted title")
  .option("--mark", "Treat the file as Markdown (converted to HTML server-side)")
  .option("--private", "Make the page private (owner-only access)")
  .option("--public", "Make the page public (default, shareable)")
  .action(async (id: string, file: string, options: { title?: string; mark?: boolean; private?: boolean; public?: boolean }) => {
    if (options.private && options.public) {
      console.error(red("✗ --private and --public are mutually exclusive"));
      process.exit(1);
    }
    const html = readFileSync(resolve(file), "utf-8");

    let isPrivate: boolean | undefined;
    if (options.private) isPrivate = true;
    else if (options.public) isPrivate = false;

    process.stdout.write(`${dim("→ Validating HTML structure...")}\n`);
    const isValid = /<!DOCTYPE html>/i.test(html);
    process.stdout.write(isValid ? `${green("✓ Valid markup")}\n\n` : `${yellow("⚠ No DOCTYPE found — continuing")}\n\n`);

    process.stdout.write(`${dim(`→ Updating post ${id}...`)}\n`);
    const title = options.title ?? extractTitle(html, file);
    const body: Record<string, unknown> = { html, title };
    if (options.mark) body.type = "markdown";
    if (isPrivate !== undefined) body.isPrivate = isPrivate;
    const result = await api(`/api/posts/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    process.stdout.write(`${green("✓ Update complete")}\n`);
    printPublishOutput(result.url, result.isPrivate);
  });

program
  .command("setup")
  .description("Save API key to the config file")
  .option("-k, --key <key>", "API key (prompts if omitted)")
  .action(async (opts: { key?: string }) => {
    let key = opts.key ?? process.env.RELAY_API_KEY ?? process.env.POSTHTML_API_KEY;
    if (!key) {
      console.log(dim(`Get your API key from: ${BASE_URL}/dashboard`));
      key = await readSecret("Enter your API key: ");
    }
    if (!key) {
      console.error(red("No API key provided"));
      process.exit(1);
    }
    if (key.length > 100) {
      console.warn(yellow("Key looks longer than expected — check you didn't paste it twice."));
    }
    await saveConfig({ api_key: key });
    console.log(`${green("✓")} ${dim(`saved to ${configFilePath()}`)}`);
  });

// ── data ────────────────────────────────────────────────────────────────────
const dataCmd = program
  .command("data")
  .description("Manage page JSON data");

dataCmd
  .command("get <id>")
  .description("Get post data")
  .action(async (id: string) => {
    process.stdout.write(`${dim("→ Fetching post data...")}\n`);
    const data = await api(`/api/posts/${id}/data`);
    console.log(JSON.stringify(data, null, 2));
  });

dataCmd
  .command("set <id>")
  .description("Merge or overwrite data on a post")
  .option("-k, --key <key>", "JSON key to set")
  .option("-v, --value <value>", 'JSON value (required with --key, e.g. \'[{"repo":"cardfoi"}]\')')
  .option("-f, --file <path>", "JSON file to merge (whole object)")
  .option("-r, --replace", "Overwrite post data instead of merging")
  .action(async (id: string, options: { key?: string; value?: string; file?: string; replace?: boolean }) => {
    let body: Record<string, unknown>;

    if (options.file) {
      const content = readFileSync(resolve(options.file), "utf-8");
      try {
        body = JSON.parse(content);
      } catch {
        console.error(red(`✗ File "${options.file}" is not valid JSON`));
        process.exit(1);
      }
      if (typeof body !== "object" || Array.isArray(body)) {
        console.error(red('✗ File must contain a JSON object, not an array or primitive'));
        process.exit(1);
      }
    } else if (options.key) {
      if (options.value === undefined) {
        console.error(red("✗ --value is required with --key"));
        process.exit(1);
      }
      try {
        body = { [options.key]: JSON.parse(options.value) };
      } catch {
        console.error(red("✗ --value must be valid JSON"));
        process.exit(1);
      }
    } else {
      console.error(red("✗ Provide either --key/--value or --file"));
      process.exit(1);
    }

    const verb = options.replace ? "Overwriting" : "Merging";
    process.stdout.write(`${dim(`→ ${verb} data into post...`)}\n`);
    const dataUrl = options.replace ? `/api/posts/${id}/data?replace=1` : `/api/posts/${id}/data`;
    const result = await api(dataUrl, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    console.log(JSON.stringify(result, null, 2));
  });
// ── token (scoped capability mint) ─────────────────────────────────────────────
program
  .command("token <id>")
  .description("Mint a scoped capability token for a post (for client-side plugins)")
  .option("-s, --scope <scope>", "Capability scope: data:patch | data:read | post:read", "data:patch")
  .option("--subkeys <keys>", "Comma-separated data subkeys the token may write (data:patch only)")
  .option("-p, --plugin <id>", "Plugin id to scope the token to")
  .option("-e, --expires <ms>", "Token lifetime in milliseconds (default 30 days)")
  .action(async (id: string, options: { scope?: string; subkeys?: string; plugin?: string; expires?: string }) => {
    if (!API_KEY) {
      console.error(red("No API key configured. Run `relay setup`."))
      process.exit(1)
    }
    const scope = options.scope ?? "data:patch"
    if (!["data:patch", "data:read", "post:read"].includes(scope)) {
      console.error(red(`Invalid scope: ${scope}`))
      process.exit(1)
    }
    const subkeys = options.subkeys
      ? options.subkeys.split(",").map((s) => s.trim()).filter(Boolean)
      : undefined
    const body: Record<string, unknown> = { scope }
    if (subkeys) body.subkeys = subkeys
    if (options.plugin) body.pluginId = options.plugin
    if (options.expires) body.expiresInMs = Number(options.expires)

    const res = await fetch(`${BASE_URL}/api/posts/${id}/token`, {
      method: "POST",
      headers: { "x-api-key": API_KEY, "content-type": "application/json" },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      console.error(red(`Failed: ${err.error ?? res.statusText}`))
      process.exit(1)
    }
    const json = await res.json()
    console.log(green("Scoped token minted:"))
    console.log(json.token)
    if (json.subkeys) console.log(dim(`subkeys: ${(json.subkeys as string[]).join(", ")}`))
  })

// Require API key for all commands except `setup`
program.hook("preAction", (thisCommand, actionCommand) => {
  if (actionCommand.name() !== "setup" && !API_KEY) {
    console.error(red.bold("✗ No API key configured."));
    console.error(dim("Set RELAY_API_KEY or run 'relay setup' to configure your API key."));
    process.exit(1);
  }
});

program.parseAsync(process.argv).catch((err) => {
  console.error(red(err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
