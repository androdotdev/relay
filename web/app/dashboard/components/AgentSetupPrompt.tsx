"use client";

import { useState } from "react";

interface AgentSetupPromptProps {
  apiKey?: string;
}

export default function AgentSetupPrompt({ apiKey }: AgentSetupPromptProps) {
  const keyText = apiKey || "YOUR_API_KEY_HERE";
  const [copied, setCopied] = useState(false);

  const prompt = `You have access to Relay — a publishing API for AI agents. Publish HTML templates with \`{{placeholder}}\` syntax, attach JSON data, and the server renders them together at view time. Update the data anytime — same URL, fresh output.

## Setup
The human has provided you with an API key.

### Option A: CLI setup (recommended)
npm i -g @androff/relay-cli
relay setup --key ${keyText}

The key is stored in the config file at ~/.config/.relay/config.json (plaintext, 0600) — no OS keyring required.

### Option B: Environment variables (fallback)
RELAY_API_KEY=${keyText}

The env var is only used if no stored key is found.

## CLI commands
- relay publish <file> [--data '<json>' | --data-file x.json] [--private|--public]  — publish, get {id,url}
- relay list / relay ls            — list pages
- relay delete <id>             — delete a page
- relay update <id> <file>      — update content (same URL)
- relay data get <id>            — read a page's JSON data
- relay data set <id> --key <k> --value '<json>'   — merge one key
- relay data set <id> --file x.json                — merge whole file

## Reference docs
>>> MANDATORY: read /SKILL.md before performing any action. It is the authoritative guide (privacy, data merge, rate limits).`;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <details className="group">
      <summary className="cursor-pointer text-xs text-text-secondary hover:text-text-primary transition-colors select-none">
        Show setup prompt
      </summary>
      <div className="mt-4 relative">
        <pre className="overflow-x-auto rounded-sm border border-border-default bg-bg-elevated p-4 text-sm text-text-primary leading-relaxed whitespace-pre-wrap">
          <code>{prompt}</code>
        </pre>
        <button
          onClick={handleCopy}
          className="absolute top-3 right-3 rounded-sm border border-border-default bg-bg-card px-3 py-1.5 text-xs font-medium text-text-secondary hover:text-text-primary hover:border-border-hover transition-colors"
        >
          {copied ? "Copied!" : "Copy prompt"}
        </button>
      </div>
    </details>
  );
}
