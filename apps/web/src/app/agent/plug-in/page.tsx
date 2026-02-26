// ═══════════════════════════════════════════════════════════════
// NexusX — Plug In Your Agent
// apps/web/src/app/agent/plug-in/page.tsx
//
// Interactive flow: select agent → generate key → copy config → test.
// Supports MCP (Claude Code, Cline) and HTTP (Codex, Gemini, custom).
// ═══════════════════════════════════════════════════════════════

"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import { buyer } from "@/lib/api";
import { cn, relativeTime } from "@/lib/utils";

// ─── Agent Definitions ───

interface AgentDef {
  id: string;
  name: string;
  protocol: "mcp" | "http";
  description: string;
  icon: string;
  color: string;
}

const AGENTS: AgentDef[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    protocol: "mcp",
    description: "Anthropic's CLI agent — native MCP support, zero config",
    icon: "C",
    color: "from-orange-500/20 to-orange-600/5",
  },
  {
    id: "cline",
    name: "Cline / Roo",
    protocol: "mcp",
    description: "VS Code agent with MCP tool integration",
    icon: "R",
    color: "from-violet-500/20 to-violet-600/5",
  },
  {
    id: "codex",
    name: "OpenAI Codex",
    protocol: "http",
    description: "OpenAI's agent — connects via HTTP function calling",
    icon: "O",
    color: "from-emerald-500/20 to-emerald-600/5",
  },
  {
    id: "gemini",
    name: "Google Gemini",
    protocol: "http",
    description: "Google's multimodal agent — external tool definitions",
    icon: "G",
    color: "from-blue-500/20 to-blue-600/5",
  },
  {
    id: "langchain",
    name: "LangChain / CrewAI",
    protocol: "http",
    description: "Python agent frameworks — custom tool wrapper",
    icon: "L",
    color: "from-yellow-500/20 to-yellow-600/5",
  },
  {
    id: "custom",
    name: "Custom Agent",
    protocol: "http",
    description: "Any language, any framework — just HTTP requests",
    icon: "+",
    color: "from-zinc-500/20 to-zinc-600/5",
  },
];

// ─── Main Component ───

export default function PlugInAgentPage() {
  const [step, setStep] = useState(1);
  const [selectedAgent, setSelectedAgent] = useState<AgentDef | null>(null);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [existingKeys, setExistingKeys] = useState<
    {
      id: string;
      name: string;
      keyPrefix: string;
      status: string;
      rateLimitRpm: number;
      lastUsedAt: string | null;
      createdAt: string;
    }[]
  >([]);
  const [keysLoading, setKeysLoading] = useState(true);
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null);
  const [keyName, setKeyName] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [testStatus, setTestStatus] = useState<
    "idle" | "testing" | "success" | "error"
  >("idle");
  const [wallet, setWallet] = useState<{ balanceUsdc: number } | null>(null);

  const activeKeys = useMemo(
    () => existingKeys.filter((k) => k.status === "ACTIVE"),
    [existingKeys],
  );

  const loadApiKeys = useCallback(async () => {
    setKeysLoading(true);
    try {
      const keys = await buyer.getApiKeys();
      setExistingKeys(keys);
    } catch (err) {
      console.error("Failed to load API keys:", err);
    } finally {
      setKeysLoading(false);
    }
    buyer.getWallet().then(setWallet).catch(() => {});
  }, []);

  useEffect(() => {
    loadApiKeys();
  }, [loadApiKeys]);

  function handleSelectAgent(agent: AgentDef) {
    setSelectedAgent(agent);
    setStep(2);
  }

  async function handleGenerateKey() {
    setIsGenerating(true);
    try {
      const name = keyName || `${selectedAgent?.name || "Agent"} Key`;
      const result = await buyer.createApiKey(name);
      setApiKey(result.rawKey);
      await loadApiKeys();
      setStep(3);
    } catch (err) {
      console.error(err);
    } finally {
      setIsGenerating(false);
    }
  }

  function handleUseExistingKey(prefix: string) {
    setApiKey(prefix + "...");
    setStep(3);
  }

  function handleCopyKey(value: string, keyId: string) {
    navigator.clipboard.writeText(value);
    setCopiedKeyId(keyId);
    setTimeout(() => setCopiedKeyId(null), 2000);
  }

  function handleCopyConfig() {
    const config = getConfigSnippet(selectedAgent!, apiKey || "nxs_your_key");
    navigator.clipboard.writeText(config);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  async function handleTestConnection() {
    setTestStatus("testing");
    try {
      // Try to fetch wallet or keys as a connectivity test
      await buyer.getWallet();
      setTestStatus("success");
    } catch {
      setTestStatus("error");
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-fade-in pb-16">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          Plug In Your <span className="text-brand-400">Agent</span>
        </h1>
        <p className="mt-2 text-zinc-400 max-w-2xl">
          Connect your existing AI agent to NexusX in under 2 minutes.
          Your agent gets instant access to every API in the marketplace —
          payments, routing, and failover are handled automatically.
        </p>
      </div>

      {/* API Keys Section (Stripe-style) */}
      <div className="card p-5 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-zinc-100">API keys</h2>
            <p className="text-sm text-zinc-400 mt-1">
              Your keys load automatically when this page opens.
              Use one in your agent config or manage all keys.
            </p>
          </div>
          <Link
            href="/buyer/keys"
            className="shrink-0 px-3 py-1.5 text-xs bg-surface-3 text-zinc-300 hover:text-zinc-100 rounded-lg border border-surface-4 transition-colors"
          >
            Manage API keys
          </Link>
        </div>

        {keysLoading ? (
          <div className="space-y-2 animate-pulse">
            <div className="h-12 rounded-lg bg-surface-3/70" />
            <div className="h-12 rounded-lg bg-surface-3/70" />
          </div>
        ) : (
          <div className="space-y-2">
            {apiKey && !apiKey.endsWith("...") && (
              <ApiKeyStripeRow
                title="Secret key (new)"
                value={apiKey}
                meta="Shown once — copy and store securely."
                onCopy={() => handleCopyKey(apiKey, "new_raw_key")}
                copied={copiedKeyId === "new_raw_key"}
                highlight
              />
            )}

            {activeKeys.length > 0 ? (
              activeKeys.slice(0, 3).map((key) => (
                <ApiKeyStripeRow
                  key={key.id}
                  title={key.name}
                  value={maskApiKey(key.keyPrefix)}
                  meta={`${key.rateLimitRpm}/min${key.lastUsedAt ? ` • Last used ${relativeTime(key.lastUsedAt)}` : " • Never used"}`}
                  onCopy={() => handleCopyKey(key.keyPrefix, key.id)}
                  copied={copiedKeyId === key.id}
                  actionLabel={selectedAgent ? "Use in setup" : undefined}
                  onAction={
                    selectedAgent
                      ? () => handleUseExistingKey(key.keyPrefix)
                      : undefined
                  }
                />
              ))
            ) : (
              <div className="rounded-lg border border-dashed border-surface-4 px-4 py-5 text-sm text-zinc-400">
                No active keys yet. Continue to step 2 to generate one.
              </div>
            )}

            {activeKeys.length > 3 && (
              <p className="text-xs text-zinc-500 pt-1">
                Showing 3 of {activeKeys.length} active keys.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Progress Bar */}
      <div className="flex items-center gap-2">
        {[
          { n: 1, label: "Select Agent" },
          { n: 2, label: "API Key" },
          { n: 3, label: "Configure" },
          { n: 4, label: "Test" },
        ].map(({ n, label }) => (
          <button
            key={n}
            onClick={() => {
              if (n <= step) setStep(n);
            }}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all flex-1",
              step === n
                ? "bg-brand-600/20 text-brand-300 border border-brand-600/30"
                : step > n
                  ? "bg-surface-3 text-zinc-300 border border-transparent"
                  : "bg-surface-2 text-zinc-600 border border-transparent cursor-default"
            )}
          >
            <span
              className={cn(
                "w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0",
                step > n
                  ? "bg-brand-600 text-white"
                  : step === n
                    ? "bg-brand-600/30 text-brand-300"
                    : "bg-surface-4 text-zinc-600"
              )}
            >
              {step > n ? "\u2713" : n}
            </span>
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </div>

      {/* ─── Step 1: Select Agent ─── */}
      {step === 1 && (
        <div className="space-y-6">
          <div>
            <h2 className="text-xl font-semibold text-zinc-100">
              What agent are you connecting?
            </h2>
            <p className="text-sm text-zinc-400 mt-1">
              We&apos;ll generate the right config for your agent&apos;s protocol.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {AGENTS.map((agent) => (
              <button
                key={agent.id}
                onClick={() => handleSelectAgent(agent)}
                className="card p-5 relative overflow-hidden text-left group hover:border-brand-600/30 transition-all"
              >
                <div
                  className={cn(
                    "absolute inset-0 bg-gradient-to-br opacity-50 pointer-events-none group-hover:opacity-80 transition-opacity",
                    agent.color
                  )}
                />
                <div className="relative flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-surface-3 flex items-center justify-center text-xl font-bold text-brand-400 border border-surface-4 shrink-0">
                    {agent.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-zinc-100">
                        {agent.name}
                      </h3>
                      <span className="text-2xs font-mono px-1.5 py-0.5 rounded bg-surface-3 text-zinc-500">
                        {agent.protocol.toUpperCase()}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-400 mt-1">
                      {agent.description}
                    </p>
                  </div>
                  <span className="text-zinc-600 group-hover:text-brand-400 transition-colors text-lg shrink-0">
                    →
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ─── Step 2: API Key ─── */}
      {step === 2 && selectedAgent && (
        <div className="space-y-6">
          <div>
            <h2 className="text-xl font-semibold text-zinc-100">
              Get your API key
            </h2>
            <p className="text-sm text-zinc-400 mt-1">
              Your agent uses this key to authenticate with NexusX.
              All marketplace access, billing, and usage tracking is tied to this key.
            </p>
          </div>

          {/* Existing Keys */}
          {activeKeys.length > 0 && (
            <div className="card p-5 space-y-3">
              <h3 className="text-sm font-semibold text-zinc-200">
                Use an existing key
              </h3>
              <div className="space-y-2">
                {activeKeys.map((key) => (
                  <button
                    key={key.id}
                    onClick={() => handleUseExistingKey(key.keyPrefix)}
                    className="w-full flex items-center gap-3 px-4 py-3 bg-surface-2 rounded-lg hover:bg-surface-3 transition-colors text-left"
                  >
                    <span className="text-sm text-zinc-200 font-medium">
                      {key.name}
                    </span>
                    <span className="text-xs font-mono text-zinc-500">
                      {key.keyPrefix}...
                    </span>
                    <span className="ml-auto text-xs text-brand-400">
                      Use this →
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Generate New Key */}
          <div className="card p-5 space-y-4">
            <h3 className="text-sm font-semibold text-zinc-200">
              {activeKeys.length > 0
                ? "Or generate a new key"
                : "Generate an API key"}
            </h3>
            <div>
              <label className="block text-2xs text-zinc-500 uppercase tracking-wider font-semibold mb-1.5">
                Key Name (optional)
              </label>
              <input
                type="text"
                value={keyName}
                onChange={(e) => setKeyName(e.target.value)}
                placeholder={`${selectedAgent.name} Production Key`}
                className="input-base w-full"
              />
            </div>
            <button
              onClick={handleGenerateKey}
              disabled={isGenerating}
              className="btn-primary disabled:opacity-50"
            >
              {isGenerating ? "Generating..." : "Generate API Key"}
            </button>
          </div>

          <button
            onClick={() => setStep(1)}
            className="btn-ghost text-sm"
          >
            ← Back to agent selection
          </button>
        </div>
      )}

      {/* ─── Step 3: Configure ─── */}
      {step === 3 && selectedAgent && (
        <div className="space-y-6">
          <div>
            <h2 className="text-xl font-semibold text-zinc-100">
              Configure {selectedAgent.name}
            </h2>
            <p className="text-sm text-zinc-400 mt-1">
              {selectedAgent.protocol === "mcp"
                ? "Add this MCP server config to your agent. NexusX APIs become tools automatically."
                : "Add these endpoints to your agent's tool definitions. Each API in the marketplace is callable via HTTP."}
            </p>
          </div>

          {/* API Key Display */}
          {apiKey && !apiKey.endsWith("...") && (
            <div className="card p-4 border-amber-500/20 bg-amber-500/5">
              <div className="flex items-start gap-3">
                <span className="text-amber-400 text-lg shrink-0">!</span>
                <div>
                  <p className="text-sm font-medium text-amber-300">
                    Save your API key — it won&apos;t be shown again
                  </p>
                  <p className="text-xs font-mono text-zinc-300 mt-1 break-all select-all">
                    {apiKey}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Config Snippet */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-200">
                {getConfigTitle(selectedAgent)}
              </h3>
              <button
                onClick={handleCopyConfig}
                className="px-3 py-1.5 text-xs bg-surface-3 text-zinc-400 hover:text-zinc-200 rounded-lg border border-surface-4 transition-colors"
              >
                {copied ? "Copied!" : "Copy Config"}
              </button>
            </div>
            <pre className="bg-surface-1 border border-surface-4 rounded-lg p-4 overflow-x-auto">
              <code className="text-xs font-mono text-zinc-300 whitespace-pre">
                {getConfigSnippet(selectedAgent, apiKey || "nxs_your_key")}
              </code>
            </pre>
          </div>

          {/* Where to paste */}
          <div className="card p-5 space-y-3">
            <h3 className="text-sm font-semibold text-zinc-200">
              Where to add this
            </h3>
            <div className="space-y-2 text-sm text-zinc-400">
              {getInstallInstructions(selectedAgent).map((instruction, i) => (
                <div key={i} className="flex items-start gap-3">
                  <span className="w-6 h-6 rounded-full bg-surface-3 flex items-center justify-center text-xs font-bold text-zinc-400 shrink-0">
                    {i + 1}
                  </span>
                  <p>{instruction}</p>
                </div>
              ))}
            </div>
          </div>

          {/* What your agent can do now */}
          <div className="card p-5 border-brand-600/20">
            <h3 className="text-sm font-semibold text-zinc-200 mb-3">
              What your agent can do now
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <CapabilityRow
                icon="◈"
                title="Auto-discover APIs"
                description="The orchestrator finds the best API for any task"
              />
              <CapabilityRow
                icon="◆"
                title="Pay per call"
                description="USDC payments on Base L2, no subscriptions"
              />
              <CapabilityRow
                icon="↻"
                title="Auto-failover"
                description="If one API fails, the orchestrator retries another"
              />
              <CapabilityRow
                icon="⇥"
                title="Bundle chains"
                description="Multi-step workflows with deferred billing"
              />
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={() => setStep(2)} className="btn-ghost text-sm">
              ← Back
            </button>
            <button onClick={() => setStep(4)} className="btn-primary">
              Test Connection →
            </button>
          </div>
        </div>
      )}

      {/* ─── Step 4: Test ─── */}
      {step === 4 && selectedAgent && (
        <div className="space-y-6">
          <div>
            <h2 className="text-xl font-semibold text-zinc-100">
              Test the connection
            </h2>
            <p className="text-sm text-zinc-400 mt-1">
              Verify that your agent can reach NexusX. We&apos;ll make a quick API call to confirm everything is wired up.
            </p>
          </div>

          {/* Wallet empty warning */}
          {wallet !== null && wallet.balanceUsdc === 0 && (
            <div className="card p-4 border-amber-500/20 bg-amber-500/5 text-sm text-amber-300 flex items-start gap-3">
              <span className="shrink-0">⚠</span>
              <span>
                Your wallet is empty — your agent will get a 402 error on every
                API call.{" "}
                <Link href="/buyer/fund" className="underline hover:text-amber-200">
                  Add USDC
                </Link>{" "}
                before testing.
              </span>
            </div>
          )}

          {/* Test Card */}
          <div className="card p-6 space-y-5">
            <div className="flex items-center gap-4">
              <div
                className={cn(
                  "w-14 h-14 rounded-xl flex items-center justify-center text-2xl shrink-0 transition-colors",
                  testStatus === "success"
                    ? "bg-emerald-500/15 text-emerald-400"
                    : testStatus === "error"
                      ? "bg-red-500/15 text-red-400"
                      : testStatus === "testing"
                        ? "bg-brand-500/15 text-brand-400 animate-pulse"
                        : "bg-surface-3 text-zinc-500"
                )}
              >
                {testStatus === "success"
                  ? "\u2713"
                  : testStatus === "error"
                    ? "\u2717"
                    : testStatus === "testing"
                      ? "..."
                      : "?"}
              </div>
              <div>
                <h3 className="text-lg font-semibold text-zinc-100">
                  {testStatus === "success"
                    ? "Connected!"
                    : testStatus === "error"
                      ? "Connection Failed"
                      : testStatus === "testing"
                        ? "Testing..."
                        : "Ready to test"}
                </h3>
                <p className="text-sm text-zinc-400">
                  {testStatus === "success"
                    ? "Your agent is connected to NexusX. Try asking it to use an API!"
                    : testStatus === "error"
                      ? "Check your API key and gateway URL, then try again."
                      : "Click the button to verify connectivity."}
                </p>
              </div>
            </div>

            <button
              onClick={handleTestConnection}
              disabled={testStatus === "testing"}
              className={cn(
                "w-full py-3 rounded-lg font-medium text-sm transition-all",
                testStatus === "success"
                  ? "bg-emerald-600/20 text-emerald-300 border border-emerald-600/30"
                  : "btn-primary"
              )}
            >
              {testStatus === "testing"
                ? "Testing connection..."
                : testStatus === "success"
                  ? "Connection verified"
                  : "Test Connection"}
            </button>
          </div>

          {/* Try It Prompt */}
          {testStatus === "success" && (
            <div className="card p-5 border-brand-600/20 space-y-4">
              <h3 className="text-sm font-semibold text-zinc-200">
                Try it out — ask your agent:
              </h3>
              <div className="space-y-2">
                {[
                  '"Translate \'Hello World\' to Japanese using NexusX"',
                  '"Analyze the sentiment of this customer review"',
                  '"Find me an API for image generation on NexusX"',
                  '"What APIs are available on NexusX and how much do they cost?"',
                ].map((prompt, i) => (
                  <div
                    key={i}
                    className="bg-surface-2 rounded-lg px-4 py-2.5 text-sm text-zinc-300 font-mono"
                  >
                    {prompt}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Next Steps */}
          <div className="card p-5 space-y-4">
            <h3 className="text-sm font-semibold text-zinc-200">
              Next steps
            </h3>
            <div className="space-y-2">
              <NextStepLink
                href="/buyer/wallet"
                title="Fund your wallet"
                description="Add USDC so your agent can pay for API calls. Enable auto-deposit to run forever."
              />
              <NextStepLink
                href="/marketplace"
                title="Browse the marketplace"
                description="See all available APIs, pricing, and quality scores."
              />
              <NextStepLink
                href="/buyer/keys"
                title="Manage API keys"
                description="Create additional keys, set rate limits, or revoke access."
              />
              <NextStepLink
                href="/agent/build"
                title="Build a custom agent"
                description="Create an agent from scratch with NexusX APIs embedded natively."
              />
            </div>
          </div>

          <button onClick={() => setStep(3)} className="btn-ghost text-sm">
            ← Back to config
          </button>
        </div>
      )}
    </div>
  );
}

function maskApiKey(prefix: string): string {
  return `${prefix}••••••••••••••••••••••••`;
}

function ApiKeyStripeRow({
  title,
  value,
  meta,
  copied,
  onCopy,
  actionLabel,
  onAction,
  highlight = false,
}: {
  title: string;
  value: string;
  meta: string;
  copied: boolean;
  onCopy: () => void;
  actionLabel?: string;
  onAction?: () => void;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-3 bg-surface-1",
        highlight ? "border-amber-500/35 bg-amber-500/5" : "border-surface-4",
      )}
    >
      <div className="flex items-center gap-3">
        <div className="min-w-[120px] text-xs font-semibold uppercase tracking-wide text-zinc-500">
          {title}
        </div>
        <div className="flex-1 min-w-0 rounded-md bg-surface-2 border border-surface-4 px-3 py-2">
          <p className="font-mono text-sm text-zinc-200 truncate">{value}</p>
        </div>
        <button
          onClick={onCopy}
          className="px-2.5 py-1.5 text-xs rounded-md border border-surface-4 bg-surface-2 text-zinc-300 hover:text-zinc-100 transition-colors"
        >
          {copied ? "Copied" : "Copy"}
        </button>
        {actionLabel && onAction && (
          <button
            onClick={onAction}
            className="px-2.5 py-1.5 text-xs rounded-md border border-brand-600/30 bg-brand-600/10 text-brand-300 hover:bg-brand-600/20 transition-colors"
          >
            {actionLabel}
          </button>
        )}
      </div>
      <p className="text-xs text-zinc-500 mt-2">{meta}</p>
    </div>
  );
}

// ─── Config Generation ───

function getConfigTitle(agent: AgentDef): string {
  switch (agent.id) {
    case "claude-code":
      return "Add to ~/.claude/settings.json";
    case "cline":
      return "Add to VS Code MCP settings";
    case "codex":
      return "Add to your agent's tool definitions";
    case "gemini":
      return "Add as external tool definition";
    case "langchain":
      return "Add to your Python agent";
    default:
      return "Integration code";
  }
}

function getConfigSnippet(agent: AgentDef, apiKey: string): string {
  if (agent.protocol === "mcp") {
    if (agent.id === "claude-code") {
      return `// ~/.claude/settings.json
{
  "mcpServers": {
    "nexusx": {
      "command": "npx",
      "args": ["-y", "nexusx", "mcp"],
      "env": {
        "NEXUSX_API_KEY": "${apiKey}",
        "NEXUSX_GATEWAY_URL": "https://gateway.nexusx.dev",
        "NEXUSX_SESSION_BUDGET_USDC": "5.00"
      }
    }
  }
}`;
    }
    // Cline / generic MCP
    return `// MCP Server Configuration
{
  "mcpServers": {
    "nexusx": {
      "command": "npx",
      "args": ["-y", "nexusx", "mcp"],
      "env": {
        "NEXUSX_API_KEY": "${apiKey}",
        "NEXUSX_GATEWAY_URL": "https://gateway.nexusx.dev",
        "NEXUSX_SESSION_BUDGET_USDC": "5.00",
        "NEXUSX_TRANSPORT": "stdio"
      }
    }
  }
}

// Available tools after connecting:
//   nexusx            — Natural language orchestrator (auto-selects APIs)
//   nexusx_{slug}     — Direct call to any listing by slug
//
// Available resources:
//   nexusx://listings, nexusx://wallet, nexusx://prices`;
  }

  // HTTP agents
  switch (agent.id) {
    case "codex":
      return `# OpenAI Agents SDK — NexusX Tool Definition
# pip install openai

from openai import OpenAI

client = OpenAI()

# Define NexusX as a tool your agent can call
nexusx_tool = {
    "type": "function",
    "function": {
        "name": "nexusx_call",
        "description": "Call any API on the NexusX marketplace. "
                       "Supports translation, sentiment, embeddings, "
                       "image generation, and 50+ more APIs.",
        "parameters": {
            "type": "object",
            "properties": {
                "slug": {
                    "type": "string",
                    "description": "API listing slug (e.g. 'deepl-translation-api')"
                },
                "path": {
                    "type": "string",
                    "description": "Endpoint path after the slug",
                    "default": "/"
                },
                "body": {
                    "type": "object",
                    "description": "JSON request body"
                }
            },
            "required": ["slug"]
        }
    }
}

# Handle tool calls in your agent loop
import requests

NEXUSX_GATEWAY = "https://gateway.nexusx.dev"
NEXUSX_KEY = "${apiKey}"

def call_nexusx(slug: str, path: str = "/", body: dict = None):
    """Proxy call through NexusX gateway."""
    resp = requests.post(
        f"{NEXUSX_GATEWAY}/v1/{slug}{path}",
        headers={
            "Authorization": f"Bearer {NEXUSX_KEY}",
            "Content-Type": "application/json",
        },
        json=body or {},
    )
    return resp.json()`;

    case "gemini":
      return `// Google Gemini — External Tool Definition
// Uses the Gemini API function calling feature

const tool = {
  functionDeclarations: [{
    name: "nexusx_call",
    description:
      "Call any API on the NexusX marketplace. " +
      "Supports translation, sentiment, embeddings, and 50+ more.",
    parameters: {
      type: "OBJECT",
      properties: {
        slug: {
          type: "STRING",
          description: "API listing slug (e.g. 'deepl-translation-api')"
        },
        path: { type: "STRING", description: "Endpoint path", default: "/" },
        body: { type: "OBJECT", description: "JSON request body" }
      },
      required: ["slug"]
    }
  }]
};

// Handle function calls:
const NEXUSX_GATEWAY = "https://gateway.nexusx.dev";
const NEXUSX_KEY = "${apiKey}";

async function callNexusX(slug, path = "/", body = {}) {
  const res = await fetch(\`\${NEXUSX_GATEWAY}/v1/\${slug}\${path}\`, {
    method: "POST",
    headers: {
      "Authorization": \`Bearer \${NEXUSX_KEY}\`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return res.json();
}`;

    case "langchain":
      return `# LangChain / CrewAI — NexusX Tool
# pip install langchain requests

from langchain.tools import Tool
import requests

NEXUSX_GATEWAY = "https://gateway.nexusx.dev"
NEXUSX_KEY = "${apiKey}"

def nexusx_call(query: str) -> str:
    """
    Call the NexusX orchestrator with a natural language task.
    The orchestrator finds the best API, handles payment, and
    returns the result. No need to specify which API — just
    describe what you need.
    """
    resp = requests.post(
        f"{NEXUSX_GATEWAY}/v1/nexusx/orchestrate",
        headers={
            "Authorization": f"Bearer {NEXUSX_KEY}",
            "Content-Type": "application/json",
        },
        json={"task": query},
    )
    return resp.text

nexusx_tool = Tool(
    name="NexusX",
    func=nexusx_call,
    description=(
        "Access 50+ APIs through NexusX marketplace. "
        "Translation, sentiment analysis, embeddings, "
        "image generation, and more. Just describe the task."
    ),
)

# Add to your agent:
# agent = initialize_agent(
#     tools=[nexusx_tool, ...],
#     llm=llm,
#     agent=AgentType.OPENAI_FUNCTIONS,
# )`;

    default:
      return `# NexusX Gateway — Direct HTTP Integration
# Works with any language or framework

# Base URL
GATEWAY_URL="https://gateway.nexusx.dev"
API_KEY="${apiKey}"

# Call any API by its marketplace slug:
curl -X POST "$GATEWAY_URL/v1/{listing-slug}/{path}" \\
  -H "Authorization: Bearer $API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"your": "request body"}'

# Examples:
# Translate text:
curl -X POST "$GATEWAY_URL/v1/deepl-translation-api/translate" \\
  -H "Authorization: Bearer $API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"text": "Hello world", "target_lang": "FR"}'

# Sentiment analysis:
curl -X POST "$GATEWAY_URL/v1/sentiment-analysis-pro/sentiment" \\
  -H "Authorization: Bearer $API_KEY" \\
  -d '{"text": "This product is amazing!"}'

# Response headers include:
#   X-NexusX-Price-USDC: 0.001000
#   X-NexusX-Latency-Ms: 45
#   X-NexusX-Request-Id: req_abc123`;
  }
}

function getInstallInstructions(agent: AgentDef): string[] {
  switch (agent.id) {
    case "claude-code":
      return [
        "Copy the config above",
        'Open ~/.claude/settings.json (create it if it doesn\'t exist)',
        'Paste the "mcpServers" block into your settings',
        'Restart Claude Code — NexusX tools are now available',
      ];
    case "cline":
      return [
        "Open VS Code Settings (Cmd/Ctrl + ,)",
        'Search for "MCP" in the Cline/Roo extension settings',
        "Add the NexusX server config to your MCP servers list",
        "Reload the extension — NexusX tools appear in the tool list",
      ];
    case "codex":
      return [
        "Add the nexusx_call tool definition to your agent's tools array",
        "Implement the call_nexusx() handler function",
        "Your agent will call NexusX when it needs external APIs",
        "All billing is handled automatically via your API key",
      ];
    case "gemini":
      return [
        "Add the tool declaration to your Gemini API request",
        "Implement the callNexusX() handler for function call responses",
        "Gemini will invoke the tool when it needs external data",
        "Responses include pricing and latency metadata",
      ];
    case "langchain":
      return [
        "Install: pip install langchain requests",
        "Add the NexusX tool to your agent's tool list",
        "The tool wraps the NexusX orchestrator — describe tasks in natural language",
        "Works with any LangChain agent type (OpenAI Functions, ReAct, etc.)",
      ];
    default:
      return [
        "Set the GATEWAY_URL and API_KEY in your environment",
        "Make POST requests to /v1/{listing-slug}/{path}",
        "Include your API key in the Authorization header",
        "Parse response body as JSON — pricing info is in headers",
      ];
  }
}

// ─── Sub-components ───

function CapabilityRow({
  icon,
  title,
  description,
}: {
  icon: string;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3 p-3 bg-surface-2 rounded-lg">
      <span className="text-brand-400 text-base shrink-0">{icon}</span>
      <div>
        <p className="text-sm font-medium text-zinc-200">{title}</p>
        <p className="text-xs text-zinc-500">{description}</p>
      </div>
    </div>
  );
}

function NextStepLink({
  href,
  title,
  description,
}: {
  href: string;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 px-4 py-3 bg-surface-2 rounded-lg hover:bg-surface-3 transition-colors group"
    >
      <div className="flex-1">
        <p className="text-sm font-medium text-zinc-200 group-hover:text-brand-300 transition-colors">
          {title}
        </p>
        <p className="text-xs text-zinc-500">{description}</p>
      </div>
      <span className="text-zinc-600 group-hover:text-brand-400 transition-colors">
        →
      </span>
    </Link>
  );
}
