# @androff/relay-cli

Relay — CLI tool to publish HTML pages and get a shareable URL.

```
npm install -g @androff/relay-cli
```

## Setup

```bash
# Interactive — prompts for key, input is hidden
relay setup

# Non-interactive (env var is safer than --key on multi-user systems)
RELAY_API_KEY=post_xxx relay setup
```

Get your API key from: [posthtml.vercel.app/dashboard](https://posthtml.vercel.app/dashboard)

Configuration saved to `$XDG_CONFIG_HOME/.relay/config.json` (default `~/.config/.relay/config.json`, legacy `~/.post/config.json` auto-migrated on first read), written at `0600`. The API key is stored in plaintext in this file — there is no OS keyring dependency, so the CLI behaves identically on headless/CI/WSL and inside tmux sessions.

## Commands

### `relay publish <file>`

Publish an HTML or Markdown file as a new page.

```bash
relay publish index.html
relay publish index.html --private                    # owner-only access
relay publish README.md --mark                        # Markdown → HTML server-side
relay publish index.html --title "My Page"            # override the extracted title
relay publish index.html --data '{"status":"draft"}'  # attach JSON data
relay publish index.html --data-file meta.json        # merge data from file
```

| Option | Description |
|---|---|
| `-d, --data <json>` | JSON data string to merge into post.data |
| `--data-file <path>` | JSON file to merge into post.data |
| `-t, --title <title>` | Override the title extracted from the file |
| `--mark` | Treat the file as Markdown (converted to HTML server-side) |
| `--private` | Restrict to owner-only access |
| `--public` | Make shareable (default) |

Without `--title`, the title is extracted from the file: the first `# heading` for Markdown, the `<title>` tag for HTML, or the file's basename as a fallback. Extracted titles are trimmed but keep their internal whitespace (no dasherization).

### `relay list` / `relay ls`

List your pages.

```bash
relay list
relay ls
```

### `relay update <id> <file>`

Update an existing page's HTML while preserving its ID and URL. Accepts Markdown with `--mark`.

```bash
relay update abc123 index.html
relay update abc123 README.md --mark
relay update abc123 index.html --title "Renamed Page"
relay update abc123 index.html --private
relay update abc123 index.html --public
```

| Option | Description |
|---|---|
| `-t, --title <title>` | Override the title extracted from the file |
| `--mark` | Treat the file as Markdown (converted to HTML server-side) |
| `--private` | Restrict to owner-only access |
| `--public` | Make shareable (default) |

`--title` and the extraction rules behave exactly as in `relay publish`.

### `relay delete <id>`

Delete a page.

```bash
relay delete abc123
```

### `relay data get <id>`

Get the JSON data attached to a page.

```bash
relay data get abc123
```

### `relay data set <id>`

Merge JSON data into a page. Provide either `--key` + `--value` (one key) or `--file` (whole object).

```bash
# Set a single key
relay data set abc123 --key status --value '"draft"'

# Merge entire JSON file
relay data set abc123 --file meta.json
```

| Option | Description |
|---|---|
| `-k, --key <key>` | JSON key to set |
| `-v, --value <value>` | JSON value (required with `--key`) |
| `-f, --file <path>` | JSON file to merge (whole object) |

### `relay setup`

Save your API key to the config file at `$XDG_CONFIG_HOME/.relay/config.json` (written at `0600`).

```bash
relay setup
relay setup --key post_xxx    # pass directly (avoid on shared systems)
```

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `POST_URL` | `https://posthtml.vercel.app` | Server base URL (used when the config file has no `url`) |
| `RELAY_API_KEY` | — | API key (used when no key is stored in the config file) |
| `POSTHTML_API_KEY` | — | Legacy alias for `RELAY_API_KEY` (deprecated, still honored) |

API key priority: config file > `RELAY_API_KEY` > `POSTHTML_API_KEY` > error. A config file that exists but has no `api_key` (e.g. url-only) does not shadow the env vars.

`relay setup` itself resolves `--key` > `RELAY_API_KEY` > `POSTHTML_API_KEY` > interactive prompt.
