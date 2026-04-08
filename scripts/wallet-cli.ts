#!/usr/bin/env npx tsx
/**
 * OpenScholar Wallet Gateway CLI
 *
 * Interactive CLI for testing the OpenAI-compatible wallet gateway.
 * Supports login via browser, model listing, balance checking, single
 * prompts, and multi-turn chat with streaming.
 *
 * Usage:
 *   npx tsx scripts/wallet-cli.ts login
 *   npx tsx scripts/wallet-cli.ts models
 *   npx tsx scripts/wallet-cli.ts balance
 *   npx tsx scripts/wallet-cli.ts prompt "What is photosynthesis?"
 *   npx tsx scripts/wallet-cli.ts chat --model google/gemini-2.5-flash
 *
 * Environment:
 *   OPENSCHOLAR_API_KEY   - Wallet API key (overrides saved config)
 *   OPENSCHOLAR_BASE_URL  - Override gateway base URL
 *   OPENSCHOLAR_APP_URL   - Override app URL for login flow
 */

import * as readline from "node:readline";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";

// ─── ANSI helpers ──────────────────────────────────────────

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  underline: "\x1b[4m",

  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  gray: "\x1b[90m",

  bgRed: "\x1b[41m",
  bgGreen: "\x1b[42m",
  bgBlue: "\x1b[44m",
  bgMagenta: "\x1b[45m",
} as const;

function styled(text: string, ...styles: string[]): string {
  return `${styles.join("")}${text}${c.reset}`;
}

// ─── Persistent config (~/.openscholar/config.json) ────────

const CONFIG_DIR = path.join(os.homedir(), ".openscholar");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

interface SavedConfig {
  apiKey?: string;
  baseUrl?: string;
  appUrl?: string;
  defaultModel?: string;
}

function loadSavedConfig(): SavedConfig {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    return JSON.parse(raw) as SavedConfig;
  } catch {
    return {};
  }
}

function savePersistentConfig(update: SavedConfig): void {
  const existing = loadSavedConfig();
  const merged = { ...existing, ...update };

  // Remove undefined keys
  for (const key of Object.keys(merged) as Array<keyof SavedConfig>) {
    if (merged[key] === undefined) delete merged[key];
  }

  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2) + "\n", "utf-8");
}

function clearSavedConfig(): void {
  try {
    fs.unlinkSync(CONFIG_PATH);
  } catch {
    // Already gone
  }
}

// ─── Config ────────────────────────────────────────────────

const DEFAULT_BASE_URL = "https://formal-rabbit-271.convex.site";
const DEFAULT_APP_URL = "http://localhost:3000";

interface CLIConfig {
  apiKey: string;
  baseUrl: string;
  appUrl: string;
  model: string | null;
  temperature: number | null;
  maxTokens: number | null;
  reasoningEffort: "none" | "low" | "medium" | "high" | null;
  webSearch: boolean;
  stream: boolean;
  systemPrompt: string | null;
}

function parseArgs(): { command: string; positional: string[]; config: CLIConfig } {
  const args = process.argv.slice(2);
  const saved = loadSavedConfig();

  // Priority: --flag > env var > saved config > default
  const config: CLIConfig = {
    apiKey: process.env.OPENSCHOLAR_API_KEY ?? saved.apiKey ?? "",
    baseUrl: process.env.OPENSCHOLAR_BASE_URL ?? saved.baseUrl ?? DEFAULT_BASE_URL,
    appUrl: process.env.OPENSCHOLAR_APP_URL ?? saved.appUrl ?? DEFAULT_APP_URL,
    model: saved.defaultModel ?? null,
    temperature: null,
    maxTokens: null,
    reasoningEffort: null,
    webSearch: true,
    stream: true,
    systemPrompt: null,
  };

  const positional: string[] = [];
  let command = "help";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    if (arg === "--key" || arg === "-k") {
      config.apiKey = args[++i] ?? "";
    } else if (arg === "--base-url" || arg === "-u") {
      config.baseUrl = args[++i] ?? DEFAULT_BASE_URL;
    } else if (arg === "--app-url") {
      config.appUrl = args[++i] ?? DEFAULT_APP_URL;
    } else if (arg === "--model" || arg === "-m") {
      config.model = args[++i] ?? null;
    } else if (arg === "--temperature" || arg === "-t") {
      config.temperature = parseFloat(args[++i] ?? "");
    } else if (arg === "--max-tokens") {
      config.maxTokens = parseInt(args[++i] ?? "", 10);
    } else if (arg === "--reasoning") {
      config.reasoningEffort = (args[++i] ?? "medium") as CLIConfig["reasoningEffort"];
    } else if (arg === "--no-web-search") {
      config.webSearch = false;
    } else if (arg === "--no-stream") {
      config.stream = false;
    } else if (arg === "--system" || arg === "-s") {
      config.systemPrompt = args[++i] ?? null;
    } else if (arg === "--help" || arg === "-h") {
      command = "help";
    } else if (!arg.startsWith("-")) {
      positional.push(arg);
    }
  }

  if (positional.length > 0) {
    command = positional.shift()!;
  }

  return { command, positional, config };
}

// ─── Browser opener ────────────────────────────────────────

function openBrowser(url: string): boolean {
  try {
    const platform = process.platform;
    if (platform === "darwin") {
      execSync(`open "${url}"`, { stdio: "ignore" });
    } else if (platform === "win32") {
      execSync(`start "" "${url}"`, { stdio: "ignore" });
    } else {
      execSync(`xdg-open "${url}"`, { stdio: "ignore" });
    }
    return true;
  } catch {
    return false;
  }
}

// ─── Readline prompt helper ────────────────────────────────

function ask(prompt: string, options?: { mask?: boolean }): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    if (options?.mask) {
      // Mask input for secrets
      const stdout = process.stdout;
      const onData = (char: Buffer) => {
        const str = char.toString();
        if (str === "\n" || str === "\r" || str === "\r\n") return;
        stdout.clearLine(0);
        stdout.cursorTo(0);
        stdout.write(prompt + "*".repeat(rl.line.length));
      };
      process.stdin.on("data", onData);
      rl.question(prompt, (answer) => {
        process.stdin.removeListener("data", onData);
        rl.close();
        resolve(answer.trim());
      });
    } else {
      rl.question(prompt, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    }
  });
}

// ─── HTTP helpers ──────────────────────────────────────────

async function apiGet<T>(config: CLIConfig, path: string, auth = true): Promise<T> {
  const headers: Record<string, string> = {};
  if (auth) headers["Authorization"] = `Bearer ${config.apiKey}`;

  const res = await fetch(`${config.baseUrl}${path}`, { headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  return res.json() as Promise<T>;
}

async function apiPostStream(
  config: CLIConfig,
  path: string,
  body: unknown,
): Promise<Response> {
  const res = await fetch(`${config.baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return res;
}

// ─── Key validation ────────────────────────────────────────

interface BalanceResponse {
  free: number;
  paid: number;
  total: number;
}

async function validateKey(config: CLIConfig): Promise<BalanceResponse | null> {
  try {
    return await apiGet<BalanceResponse>(config, "/api/wallet/balance");
  } catch {
    return null;
  }
}

// ─── SSE stream consumer ───────────────────────────────────

interface StreamStats {
  firstTokenMs: number | null;
  totalMs: number;
  content: string;
  finishReason: string | null;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    prompt_tokens_details?: { cached_tokens?: number };
    completion_tokens_details?: { reasoning_tokens?: number };
  } | null;
}

async function consumeSSEStream(
  res: Response,
  onDelta: (text: string) => void,
): Promise<StreamStats> {
  const stats: StreamStats = {
    firstTokenMs: null,
    totalMs: 0,
    content: "",
    finishReason: null,
    usage: null,
  };

  const t0 = performance.now();
  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") continue;

      try {
        const chunk = JSON.parse(data);

        if (chunk.error) {
          throw new Error(chunk.error.message ?? "Stream error");
        }

        if (chunk.usage && (!chunk.choices || chunk.choices.length === 0)) {
          stats.usage = chunk.usage;
          continue;
        }

        const choice = chunk.choices?.[0];
        if (!choice) continue;

        if (choice.finish_reason) {
          stats.finishReason = choice.finish_reason;
        }

        const text = choice.delta?.content;
        if (text) {
          if (stats.firstTokenMs === null) {
            stats.firstTokenMs = performance.now() - t0;
          }
          stats.content += text;
          onDelta(text);
        }

        const toolCalls = choice.delta?.tool_calls;
        if (toolCalls) {
          for (const tc of toolCalls) {
            if (tc.function?.name) {
              onDelta(styled(`\n[tool: ${tc.function.name}] `, c.cyan, c.dim));
            }
            if (tc.function?.arguments) {
              onDelta(styled(tc.function.arguments, c.dim));
            }
          }
        }

        if (chunk.usage) {
          stats.usage = chunk.usage;
        }
      } catch (e) {
        if (e instanceof SyntaxError) continue;
        throw e;
      }
    }
  }

  stats.totalMs = performance.now() - t0;
  return stats;
}

// ─── Commands: Auth ────────────────────────────────────────

async function cmdLogin(config: CLIConfig): Promise<void> {
  console.log(styled("\n  OpenScholar Login", c.bold, c.magenta));
  console.log();

  // Check if already logged in
  if (config.apiKey && config.apiKey.startsWith("wk_")) {
    const balance = await validateKey(config);
    if (balance) {
      console.log(styled("  You're already logged in!", c.green));
      console.log(styled(`  Key: ${config.apiKey.slice(0, 7)}...`, c.dim));
      console.log(styled(`  Balance: ${balance.total} credits\n`, c.dim));

      const answer = await ask(styled("  Log in with a different key? (y/N): ", c.bold));
      if (answer.toLowerCase() !== "y") {
        console.log(styled("  Keeping existing session.\n", c.dim));
        return;
      }
      console.log();
    }
  }

  // Step 1: Open browser to connect page
  const connectUrl = `${config.appUrl}/connect?mode=manual&app_name=${encodeURIComponent("OpenScholar CLI")}`;

  console.log(styled("  Step 1: Authorize in your browser", c.bold));
  console.log();

  const opened = openBrowser(connectUrl);
  if (opened) {
    console.log(styled("  \u2713 Browser opened. Sign in and click \"Approve\".", c.green));
  } else {
    console.log(styled("  Could not open browser. Open this URL manually:\n", c.yellow));
    console.log(styled(`  ${connectUrl}`, c.cyan, c.underline));
  }

  console.log();
  console.log(styled("  Step 2: Copy the API key shown after approval", c.bold));
  console.log();

  // Step 2: Prompt for the key
  const rawKey = await ask(styled("  Paste your API key here: ", c.bold));

  if (!rawKey) {
    console.log(styled("\n  Login cancelled.\n", c.yellow));
    return;
  }

  if (!rawKey.startsWith("wk_")) {
    console.log(styled("\n  \u2717 Invalid key format. Wallet keys start with 'wk_'.", c.red));
    console.log(styled("  Please try again.\n", c.dim));
    return;
  }

  // Step 3: Validate the key
  console.log(styled("\n  Validating key...", c.dim));
  const testConfig = { ...config, apiKey: rawKey };
  const balance = await validateKey(testConfig);

  if (!balance) {
    console.log(styled("  \u2717 Invalid or revoked key. Please try again.\n", c.red));
    return;
  }

  // Step 4: Save to config
  savePersistentConfig({
    apiKey: rawKey,
    baseUrl: config.baseUrl !== DEFAULT_BASE_URL ? config.baseUrl : undefined,
    appUrl: config.appUrl !== DEFAULT_APP_URL ? config.appUrl : undefined,
  });

  console.log(styled("  \u2713 Logged in successfully!", c.bold, c.green));
  console.log();
  console.log(`  ${styled("Key:", c.dim)}     ${rawKey.slice(0, 7)}...${"*".repeat(8)}`);
  console.log(`  ${styled("Credits:", c.dim)} ${balance.total} (${balance.free} free + ${balance.paid} paid)`);
  console.log(`  ${styled("Saved:", c.dim)}   ${CONFIG_PATH}`);
  console.log();
  console.log(styled("  You can now use all commands without --key.", c.dim));
  console.log(styled("  Try: ", c.dim) + styled("wallet-cli chat", c.green));
  console.log();
}

async function cmdLogout(_config: CLIConfig): Promise<void> {
  console.log(styled("\n  Logout", c.bold, c.magenta));

  const saved = loadSavedConfig();
  if (!saved.apiKey) {
    console.log(styled("  No saved session found.\n", c.dim));
    return;
  }

  console.log(styled(`  Removing saved key: ${saved.apiKey.slice(0, 7)}...`, c.dim));
  clearSavedConfig();
  console.log(styled("  \u2713 Logged out. Config cleared.\n", c.green));
}

async function cmdStatus(config: CLIConfig): Promise<void> {
  console.log(styled("\n  Status", c.bold, c.magenta));
  console.log();

  // Config source
  const saved = loadSavedConfig();
  const envKey = process.env.OPENSCHOLAR_API_KEY;
  let source: string;

  if (envKey) {
    source = "OPENSCHOLAR_API_KEY env var";
  } else if (saved.apiKey) {
    source = CONFIG_PATH;
  } else {
    source = "(none)";
  }

  console.log(`  ${styled("Config:", c.dim)}    ${source}`);
  console.log(`  ${styled("Gateway:", c.dim)}   ${config.baseUrl}`);
  console.log(`  ${styled("App URL:", c.dim)}   ${config.appUrl}`);

  if (!config.apiKey) {
    console.log();
    console.log(styled("  Not logged in.", c.yellow));
    console.log(styled("  Run: ", c.dim) + styled("wallet-cli login", c.green));
    console.log();
    return;
  }

  console.log(`  ${styled("Key:", c.dim)}       ${config.apiKey.slice(0, 7)}...${"*".repeat(8)}`);
  console.log();

  // Validate key
  process.stdout.write(styled("  Checking key validity... ", c.dim));
  const balance = await validateKey(config);

  if (balance) {
    console.log(styled("\u2713 Valid", c.green));
    console.log();

    const barWidth = 30;
    const paidRatio = balance.total > 0 ? balance.paid / balance.total : 0;
    const freeRatio = balance.total > 0 ? balance.free / balance.total : 0;
    const paidBlocks = Math.round(paidRatio * barWidth);
    const freeBlocks = Math.round(freeRatio * barWidth);
    const emptyBlocks = barWidth - paidBlocks - freeBlocks;

    const bar =
      styled("\u2588".repeat(paidBlocks), c.green) +
      styled("\u2588".repeat(freeBlocks), c.cyan) +
      styled("\u2591".repeat(emptyBlocks), c.dim);

    console.log(`  ${bar}`);
    console.log(`  ${styled("Credits:", c.bold)} ${styled(String(balance.total), c.bold, c.white)} (${balance.free} free + ${balance.paid} paid)`);
  } else {
    console.log(styled("\u2717 Invalid or revoked", c.red));
    console.log(styled("  Run: ", c.dim) + styled("wallet-cli login", c.green) + styled(" to re-authenticate", c.dim));
  }
  console.log();
}

// ─── Commands: Models & Balance ────────────────────────────

interface ModelEntry {
  id: string;
  name: string;
  owned_by: string;
  context_window?: number;
  max_completion_tokens?: number;
  capabilities: string[];
  category?: string;
  pricing: {
    input_per_million_tokens: number;
    output_per_million_tokens: number;
    reasoning_per_million_tokens?: number;
    currency: string;
  };
}

interface ModelsResponse {
  object: string;
  data: ModelEntry[];
}

async function cmdModels(config: CLIConfig): Promise<void> {
  console.log(styled("\n  Models", c.bold, c.magenta));
  console.log(styled("  Fetching available models...\n", c.dim));

  const res = await apiGet<ModelsResponse>(config, "/api/wallet/v1/models", false);

  const grouped = new Map<string, ModelEntry[]>();
  for (const m of res.data) {
    const provider = m.owned_by;
    if (!grouped.has(provider)) grouped.set(provider, []);
    grouped.get(provider)!.push(m);
  }

  let idx = 0;
  for (const [provider, models] of Array.from(grouped.entries())) {
    console.log(styled(`  ${provider.toUpperCase()}`, c.bold, c.cyan));
    for (const m of models) {
      idx++;
      const num = styled(`${String(idx).padStart(3)}.`, c.dim);
      const badges: string[] = [];
      if (m.capabilities.includes("web_search")) badges.push(styled("\uD83C\uDF10", c.green));
      if (m.capabilities.includes("reasoning")) badges.push(styled("\uD83E\uDDE0", c.yellow));
      if (m.capabilities.includes("tools")) badges.push(styled("\uD83D\uDD27", c.blue));
      if (m.capabilities.includes("structured_outputs")) badges.push(styled("\uD83D\uDCCB", c.cyan));
      const badgeStr = badges.length > 0 ? badges.join("") + " " : "   ";

      const ctx = m.context_window
        ? styled(` ${(m.context_window / 1000).toFixed(0)}k`, c.dim)
        : "";
      const pricing = styled(
        `$${m.pricing.input_per_million_tokens.toFixed(2)}/$${m.pricing.output_per_million_tokens.toFixed(2)}`,
        c.gray,
      );
      const isFree = m.pricing.input_per_million_tokens === 0 && m.pricing.output_per_million_tokens === 0;
      const priceTag = isFree ? styled(" FREE*", c.green, c.bold) : ` ${pricing}`;

      console.log(`  ${num} ${badgeStr}${styled(m.id, c.green)}${ctx}${priceTag}`);
    }
    console.log();
  }

  console.log(styled("  Legend: ", c.dim) +
    styled("\uD83C\uDF10", c.green) + styled(" web  ", c.dim) +
    styled("\uD83E\uDDE0", c.yellow) + styled(" reasoning  ", c.dim) +
    styled("\uD83D\uDD27", c.blue) + styled(" tools  ", c.dim) +
    styled("\uD83D\uDCCB", c.cyan) + styled(" structured output", c.dim),
  );
  console.log(styled(`  ${res.data.length} models \u2502 *FREE models: web search still costs ~$0.004/result`, c.dim));
  console.log();
}

async function cmdBalance(config: CLIConfig): Promise<void> {
  requireKey(config);
  console.log(styled("\n  Balance", c.bold, c.magenta));
  console.log(styled("  Checking credit balance...\n", c.dim));

  const bal = await apiGet<BalanceResponse>(config, "/api/wallet/balance");

  const barWidth = 30;
  const paidRatio = bal.total > 0 ? bal.paid / bal.total : 0;
  const freeRatio = bal.total > 0 ? bal.free / bal.total : 0;
  const paidBlocks = Math.round(paidRatio * barWidth);
  const freeBlocks = Math.round(freeRatio * barWidth);
  const emptyBlocks = barWidth - paidBlocks - freeBlocks;

  const bar =
    styled("\u2588".repeat(paidBlocks), c.green) +
    styled("\u2588".repeat(freeBlocks), c.cyan) +
    styled("\u2591".repeat(emptyBlocks), c.dim);

  console.log(`  ${bar}`);
  console.log(`  ${styled("Total:", c.bold)} ${styled(String(bal.total), c.bold, c.white)} credits`);
  console.log(`    ${styled("\u25CF", c.green)} Paid:  ${bal.paid}`);
  console.log(`    ${styled("\u25CF", c.cyan)} Free:  ${bal.free}`);
  console.log();
}

// ─── Commands: Prompt & Chat ───────────────────────────────

interface ChatCompletionResponse {
  id: string;
  model: string;
  choices: Array<{
    message: {
      content: string | null;
      tool_calls?: Array<{
        function: { name: string; arguments: string };
      }>;
      annotations?: Array<{
        type: string;
        url_citation?: { url: string; title?: string };
      }>;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    prompt_tokens_details?: { cached_tokens?: number };
    completion_tokens_details?: { reasoning_tokens?: number };
  };
}

async function cmdPrompt(config: CLIConfig, prompt: string): Promise<void> {
  requireKey(config);
  const model = await resolveModel(config);
  const webLabel = config.webSearch ? styled(" \uD83C\uDF10", c.green) : "";
  console.log(styled(`\n  Model: ${model}`, c.dim) + webLabel);
  console.log(styled("  Generating...\n", c.dim));

  const messages: Array<{ role: string; content: string }> = [];
  if (config.systemPrompt) {
    messages.push({ role: "system", content: config.systemPrompt });
  }
  messages.push({ role: "user", content: prompt });

  const body: Record<string, unknown> = {
    model,
    messages,
    stream: config.stream,
  };
  if (config.temperature !== null) body.temperature = config.temperature;
  if (config.maxTokens !== null) body.max_completion_tokens = config.maxTokens;
  if (config.reasoningEffort) body.reasoning_effort = config.reasoningEffort;
  if (config.webSearch) body.web_search_options = { search_context_size: "medium" };
  if (config.stream) body.stream_options = { include_usage: true };

  if (config.stream) {
    const res = await apiPostStream(config, "/api/wallet/v1/chat/completions", body);
    process.stdout.write("  ");
    const stats = await consumeSSEStream(res, (text) => {
      process.stdout.write(text);
    });
    console.log("\n");
    printStreamStats(stats);
  } else {
    const res = await apiPostStream(config, "/api/wallet/v1/chat/completions", body);
    const data = (await res.json()) as ChatCompletionResponse;
    const content = data.choices[0]?.message?.content ?? "(no content)";
    console.log(`  ${content}\n`);
    printNonStreamStats(data);
  }
}

async function cmdChat(config: CLIConfig): Promise<void> {
  requireKey(config);
  let model = await resolveModel(config);

  const webStatus = config.webSearch
    ? styled("\uD83C\uDF10 ON", c.green, c.bold)
    : styled("OFF", c.red, c.dim);

  console.log(styled("\n  OpenScholar Chat", c.bold, c.magenta));
  console.log(styled(`  Model:  ${model}`, c.dim));
  console.log(`  ${styled("Web:    ", c.dim)}${webStatus}${config.webSearch ? "" : styled("  (use /web to enable)", c.dim)}`);
  if (config.reasoningEffort) {
    console.log(styled(`  Reason: ${config.reasoningEffort}`, c.dim));
  }
  console.log(styled("  Type /help for commands. Ctrl+C to exit.\n", c.dim));

  const messages: Array<{ role: string; content: string }> = [];
  if (config.systemPrompt) {
    messages.push({ role: "system", content: config.systemPrompt });
  }

  const buildPrompt = () =>
    config.webSearch
      ? styled("  you ", c.bold, c.green) + styled("\uD83C\uDF10", c.green) + styled("> ", c.bold, c.green)
      : styled("  you > ", c.bold, c.green);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: buildPrompt(),
    historySize: 200,
  });

  rl.prompt();

  for await (const line of rl) {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      continue;
    }

    // Slash commands
    if (input.startsWith("/")) {
      const handled = await handleSlashCommand(input, config, messages, model, rl);
      if (handled === "exit") {
        rl.close();
        return;
      }
      if (typeof handled === "object" && "newModel" in handled) {
        model = handled.newModel;
      }
      rl.prompt();
      continue;
    }

    messages.push({ role: "user", content: input });

    const body: Record<string, unknown> = {
      model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
    };
    if (config.temperature !== null) body.temperature = config.temperature;
    if (config.maxTokens !== null) body.max_completion_tokens = config.maxTokens;
    if (config.reasoningEffort) body.reasoning_effort = config.reasoningEffort;
    if (config.webSearch) body.web_search_options = { search_context_size: "medium" };

    try {
      process.stdout.write(styled("   ai > ", c.bold, c.magenta));
      const res = await apiPostStream(config, "/api/wallet/v1/chat/completions", body);
      const stats = await consumeSSEStream(res, (text) => {
        process.stdout.write(text);
      });
      console.log("\n");

      if (stats.content) {
        messages.push({ role: "assistant", content: stats.content });
      }

      printStreamStats(stats);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(styled(`\n  Error: ${msg}\n`, c.red));
      messages.pop();
    }

    rl.prompt();
  }
}

// ─── Slash commands in chat ────────────────────────────────

async function handleSlashCommand(
  input: string,
  config: CLIConfig,
  messages: Array<{ role: string; content: string }>,
  model: string,
  rl?: readline.Interface,
): Promise<"exit" | "continue" | { newModel: string }> {
  const [cmd, ...rest] = input.split(/\s+/);

  switch (cmd) {
    case "/help":
      console.log(styled("\n  Chat Commands:", c.bold));
      console.log("    /help               Show this help");
      console.log("    /clear              Clear conversation history");
      console.log("    /history            Show message history");
      console.log("    /system <prompt>    Set system prompt");
      console.log("    /temp <0.0-2.0>     Set temperature");
      console.log("    /tokens <n>         Set max output tokens");
      console.log("    /reasoning <level>  Set reasoning (none/low/medium/high)");
      console.log("    /web                Toggle web search on/off");
      console.log("    /model [id]         Show or switch model (number, ID, or name)");
      console.log("    /models             List available models");
      console.log("    /balance            Check credit balance");
      console.log("    /status             Show session info");
      console.log("    /exit               Exit chat");
      console.log();
      break;

    case "/clear":
      messages.length = 0;
      if (config.systemPrompt) {
        messages.push({ role: "system", content: config.systemPrompt });
      }
      console.log(styled("  Conversation cleared.\n", c.yellow));
      break;

    case "/history": {
      console.log(styled("\n  Conversation History:", c.bold));
      for (const msg of messages) {
        const role = msg.role === "user"
          ? styled("user", c.green)
          : msg.role === "assistant"
            ? styled("ai", c.magenta)
            : styled("system", c.yellow);
        const preview = msg.content.length > 80
          ? msg.content.slice(0, 80) + "..."
          : msg.content;
        console.log(`    [${role}] ${preview}`);
      }
      console.log();
      break;
    }

    case "/system":
      if (rest.length > 0) {
        const systemText = rest.join(" ");
        config.systemPrompt = systemText;
        const sysIdx = messages.findIndex((m) => m.role === "system");
        if (sysIdx >= 0) {
          messages[sysIdx]!.content = systemText;
        } else {
          messages.unshift({ role: "system", content: systemText });
        }
        console.log(styled(`  System prompt set: "${systemText}"\n`, c.yellow));
      } else {
        console.log(styled(`  Current system prompt: ${config.systemPrompt ?? "(none)"}\n`, c.dim));
      }
      break;

    case "/temp": {
      const val = parseFloat(rest[0] ?? "");
      if (isNaN(val) || val < 0 || val > 2) {
        console.log(styled("  Temperature must be between 0.0 and 2.0\n", c.red));
      } else {
        config.temperature = val;
        console.log(styled(`  Temperature set to ${val}\n`, c.yellow));
      }
      break;
    }

    case "/tokens": {
      const val = parseInt(rest[0] ?? "", 10);
      if (isNaN(val) || val < 1) {
        console.log(styled("  Max tokens must be a positive integer\n", c.red));
      } else {
        config.maxTokens = val;
        console.log(styled(`  Max tokens set to ${val}\n`, c.yellow));
      }
      break;
    }

    case "/reasoning": {
      const valid = ["none", "low", "medium", "high"] as const;
      const val = rest[0] as typeof valid[number];
      if (!valid.includes(val)) {
        console.log(styled(`  Reasoning must be one of: ${valid.join(", ")}\n`, c.red));
      } else {
        config.reasoningEffort = val;
        console.log(styled(`  Reasoning effort set to ${val}\n`, c.yellow));
      }
      break;
    }

    case "/web": {
      config.webSearch = !config.webSearch;
      const state = config.webSearch
        ? styled("\uD83C\uDF10 ON", c.green, c.bold)
        : styled("OFF", c.red);
      console.log(`  Web search: ${state}`);
      if (config.webSearch) {
        console.log(styled("  Model will search the web before answering.\n", c.dim));
      } else {
        console.log(styled("  Model will use training data only.\n", c.dim));
      }
      // Update the prompt indicator
      if (rl) {
        const newPrompt = config.webSearch
          ? styled("  you ", c.bold, c.green) + styled("\uD83C\uDF10", c.green) + styled("> ", c.bold, c.green)
          : styled("  you > ", c.bold, c.green);
        rl.setPrompt(newPrompt);
      }
      break;
    }

    case "/model": {
      if (rest.length > 0) {
        const newId = rest[0]!;
        // Try matching by number, short name, or full ID
        const models = await apiGet<ModelsResponse>(config, "/api/wallet/v1/models", false);
        const num = parseInt(newId, 10);
        let resolved: string | null = null;

        if (!isNaN(num) && num >= 1 && num <= models.data.length) {
          resolved = models.data[num - 1]!.id;
        } else {
          const match = models.data.find(
            (m) => m.id === newId || m.id.endsWith(`/${newId}`) || m.name.toLowerCase().includes(newId.toLowerCase()),
          );
          if (match) resolved = match.id;
          else resolved = newId; // pass through as-is
        }

        console.log(styled(`  Model switched: ${resolved}\n`, c.yellow));
        return { newModel: resolved };
      }
      console.log(styled(`  Current model: ${model}`, c.dim));
      console.log(styled("  Use /model <id> to switch (e.g. /model 6 or /model claude-haiku-4.5)\n", c.dim));
      break;
    }

    case "/models":
      await cmdModels(config);
      break;

    case "/balance":
      await cmdBalance(config);
      break;

    case "/status":
      await cmdStatus(config);
      break;

    case "/exit":
    case "/quit":
    case "/q":
      console.log(styled("  Goodbye!\n", c.dim));
      return "exit";

    default:
      console.log(styled(`  Unknown command: ${cmd}. Type /help for commands.\n`, c.red));
  }

  return "continue";
}

// ─── Model resolution ──────────────────────────────────────

async function resolveModel(config: CLIConfig): Promise<string> {
  if (config.model) return config.model;

  console.log(styled("\n  No model specified. Fetching available models...\n", c.dim));
  const res = await apiGet<ModelsResponse>(config, "/api/wallet/v1/models", false);

  if (res.data.length === 0) {
    console.log(styled("  No models available!", c.red));
    process.exit(1);
  }

  for (let i = 0; i < res.data.length; i++) {
    const m = res.data[i]!;
    const num = styled(`  ${String(i + 1).padStart(3)}.`, c.dim);
    const isFree = m.pricing.input_per_million_tokens === 0 && m.pricing.output_per_million_tokens === 0;
    const tag = isFree
      ? styled(" FREE", c.green, c.bold)
      : styled(` $${m.pricing.input_per_million_tokens.toFixed(2)}/$${m.pricing.output_per_million_tokens.toFixed(2)}`, c.gray);
    const ctx = m.context_window
      ? styled(` ${(m.context_window / 1000).toFixed(0)}k`, c.dim)
      : "";
    console.log(`${num} ${styled(m.id, c.green)}${ctx}${tag}`);
  }

  console.log();
  const answer = await ask(styled("  Select model (number or ID): ", c.bold));
  const num = parseInt(answer, 10);

  if (!isNaN(num) && num >= 1 && num <= res.data.length) {
    return res.data[num - 1]!.id;
  }

  const match = res.data.find(
    (m) => m.id === answer || m.id.endsWith(`/${answer}`),
  );
  if (match) return match.id;

  console.log(styled(`  Using "${answer}" as-is (may fail if not available)\n`, c.yellow));
  return answer;
}

// ─── Stats display ─────────────────────────────────────────

function printStreamStats(stats: StreamStats): void {
  const parts: string[] = [];

  if (stats.firstTokenMs !== null) {
    parts.push(`TTFT: ${stats.firstTokenMs.toFixed(0)}ms`);
  }
  parts.push(`Total: ${(stats.totalMs / 1000).toFixed(2)}s`);

  if (stats.usage) {
    const u = stats.usage;
    parts.push(`${u.prompt_tokens} in / ${u.completion_tokens} out`);
    if (u.prompt_tokens_details?.cached_tokens) {
      parts.push(`${u.prompt_tokens_details.cached_tokens} cached`);
    }
    if (u.completion_tokens_details?.reasoning_tokens) {
      parts.push(`${u.completion_tokens_details.reasoning_tokens} reasoning`);
    }

    if (stats.totalMs > 0 && u.completion_tokens > 0) {
      const tps = (u.completion_tokens / stats.totalMs) * 1000;
      parts.push(`${tps.toFixed(1)} tok/s`);
    }
  }

  if (stats.finishReason && stats.finishReason !== "stop") {
    parts.push(styled(`finish: ${stats.finishReason}`, c.yellow));
  }

  console.log(styled(`  ${parts.join(" \u2502 ")}`, c.dim));
  console.log();
}

function printNonStreamStats(data: ChatCompletionResponse): void {
  const parts: string[] = [];
  const u = data.usage;

  parts.push(`${u.prompt_tokens} in / ${u.completion_tokens} out / ${u.total_tokens} total`);
  if (u.prompt_tokens_details?.cached_tokens) {
    parts.push(`${u.prompt_tokens_details.cached_tokens} cached`);
  }
  if (u.completion_tokens_details?.reasoning_tokens) {
    parts.push(`${u.completion_tokens_details.reasoning_tokens} reasoning`);
  }

  const choice = data.choices[0];
  if (choice?.finish_reason && choice.finish_reason !== "stop") {
    parts.push(styled(`finish: ${choice.finish_reason}`, c.yellow));
  }

  const annotations = choice?.message?.annotations;
  if (annotations && annotations.length > 0) {
    console.log(styled("  Sources:", c.bold, c.cyan));
    for (const ann of annotations) {
      if (ann.url_citation) {
        const title = ann.url_citation.title ?? ann.url_citation.url;
        console.log(`    ${styled("\u2022", c.cyan)} ${title}`);
        if (ann.url_citation.title) {
          console.log(styled(`      ${ann.url_citation.url}`, c.dim));
        }
      }
    }
    console.log();
  }

  console.log(styled(`  ${parts.join(" \u2502 ")}`, c.dim));
  console.log();
}

// ─── Validation ────────────────────────────────────────────

function requireKey(config: CLIConfig): void {
  if (!config.apiKey) {
    console.log(styled("\n  Not logged in.", c.bold, c.red));
    console.log(styled("  Run: ", c.dim) + styled("wallet-cli login", c.green));
    console.log(styled("  Or set OPENSCHOLAR_API_KEY env var / use --key <wk_...>\n", c.dim));
    process.exit(1);
  }
  if (!config.apiKey.startsWith("wk_")) {
    console.log(styled("\n  Warning: API key doesn't start with 'wk_'. It may be invalid.\n", c.yellow));
  }
}

// ─── Help ──────────────────────────────────────────────────

function printHelp(): void {
  console.log(`
${styled("  OpenScholar Wallet CLI", c.bold, c.magenta)}
${styled("  Test the OpenAI-compatible wallet gateway\n", c.dim)}
${styled("  AUTH", c.bold)}
    ${styled("login", c.green)}                          Authenticate via browser & save key
    ${styled("logout", c.green)}                         Clear saved credentials
    ${styled("status", c.green)}                         Show current session & balance

${styled("  COMMANDS", c.bold)}
    ${styled("models", c.green)}                         List available models
    ${styled("balance", c.green)}                        Check credit balance
    ${styled("prompt", c.green)} ${styled("<text>", c.dim)}                   Send a single prompt
    ${styled("chat", c.green)}                           Interactive multi-turn chat

${styled("  OPTIONS", c.bold)}
    ${styled("--key, -k", c.cyan)} ${styled("<wk_...>", c.dim)}             API key (overrides saved session)
    ${styled("--model, -m", c.cyan)} ${styled("<id>", c.dim)}               Model ID (e.g. google/gemini-2.5-flash)
    ${styled("--temperature, -t", c.cyan)} ${styled("<0-2>", c.dim)}        Sampling temperature
    ${styled("--max-tokens", c.cyan)} ${styled("<n>", c.dim)}               Max output tokens
    ${styled("--reasoning", c.cyan)} ${styled("<level>", c.dim)}            Reasoning effort (none/low/medium/high)
    ${styled("--no-web-search", c.cyan)}                 Disable web search (on by default)
    ${styled("--system, -s", c.cyan)} ${styled("<prompt>", c.dim)}          System prompt
    ${styled("--no-stream", c.cyan)}                     Disable streaming (wait for full response)
    ${styled("--base-url, -u", c.cyan)} ${styled("<url>", c.dim)}           Override gateway URL
    ${styled("--app-url", c.cyan)} ${styled("<url>", c.dim)}                Override app URL (for login)

${styled("  EXAMPLES", c.bold)}
    ${styled("$", c.dim)} npx tsx scripts/wallet-cli.ts login
    ${styled("$", c.dim)} npx tsx scripts/wallet-cli.ts models
    ${styled("$", c.dim)} npx tsx scripts/wallet-cli.ts prompt "Explain CRISPR" -m anthropic/claude-sonnet-4.6
    ${styled("$", c.dim)} npx tsx scripts/wallet-cli.ts chat -m google/gemini-2.5-flash --reasoning high
    ${styled("$", c.dim)} npx tsx scripts/wallet-cli.ts status

${styled("  CONFIG", c.bold)}
    Credentials are saved to ${styled("~/.openscholar/config.json", c.cyan)}
    Priority: ${styled("--key flag", c.white)} > ${styled("OPENSCHOLAR_API_KEY env", c.white)} > ${styled("saved config", c.white)}

${styled("  CHAT COMMANDS", c.bold)}
    ${styled("/help", c.dim)}    ${styled("/clear", c.dim)}   ${styled("/history", c.dim)}   ${styled("/system", c.dim)}   ${styled("/temp", c.dim)}   ${styled("/tokens", c.dim)}   ${styled("/reasoning", c.dim)}
    ${styled("/web", c.dim)}     ${styled("/model", c.dim)}   ${styled("/models", c.dim)}    ${styled("/balance", c.dim)}  ${styled("/status", c.dim)}  ${styled("/exit", c.dim)}
`);
}

// ─── Main ──────────────────────────────────────────────────

async function main(): Promise<void> {
  const { command, positional, config } = parseArgs();

  try {
    switch (command) {
      case "login":
        await cmdLogin(config);
        break;

      case "logout":
        await cmdLogout(config);
        break;

      case "status":
      case "whoami":
        await cmdStatus(config);
        break;

      case "models":
        await cmdModels(config);
        break;

      case "balance":
        await cmdBalance(config);
        break;

      case "prompt": {
        const text = positional.join(" ");
        if (!text) {
          console.log(styled("\n  Error: Provide a prompt text.\n", c.red));
          console.log(styled('  Usage: wallet-cli prompt "Your question here"\n', c.dim));
          process.exit(1);
        }
        await cmdPrompt(config, text);
        break;
      }

      case "chat":
        await cmdChat(config);
        break;

      case "help":
      default:
        printHelp();
        break;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(styled(`\n  Error: ${msg}\n`, c.bold, c.red));
    process.exit(1);
  }
}

main();
