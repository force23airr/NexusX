"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { buyer } from "@/lib/api";
import { cn } from "@/lib/utils";

// ─── Agent Types ───

type AgentId =
  | "claude-code"
  | "claude-desktop"
  | "cline"
  | "openai"
  | "langchain"
  | "http";

interface AgentOption {
  id: AgentId;
  label: string;
  protocol: "mcp" | "http";
  pasteInto: string;
}

const AGENT_OPTIONS: AgentOption[] = [
  {
    id: "claude-code",
    label: "Claude Code",
    protocol: "mcp",
    pasteInto: "~/.claude/settings.json",
  },
  {
    id: "claude-desktop",
    label: "Claude Desktop",
    protocol: "mcp",
    pasteInto: "claude_desktop_config.json",
  },
  {
    id: "cline",
    label: "Cline / Roo",
    protocol: "mcp",
    pasteInto: "VS Code MCP settings",
  },
  {
    id: "openai",
    label: "OpenAI Agents",
    protocol: "http",
    pasteInto: "your agent's tool definitions",
  },
  {
    id: "langchain",
    label: "LangChain",
    protocol: "http",
    pasteInto: "your Python agent",
  },
  {
    id: "http",
    label: "HTTP / cURL",
    protocol: "http",
    pasteInto: "any HTTP client",
  },
];

// ─── Supported Agents Grid Data ───

const SUPPORTED_AGENTS = [
  {
    name: "Claude Code",
    protocol: "MCP",
    description: "Anthropic's CLI agent with native MCP tool support",
    icon: "C",
    color: "from-orange-500/20 to-orange-600/5",
  },
  {
    name: "Claude Desktop",
    protocol: "MCP",
    description: "Claude's desktop app with MCP server integration",
    icon: "C",
    color: "from-orange-500/20 to-orange-600/5",
  },
  {
    name: "Cline / Roo",
    protocol: "MCP",
    description: "VS Code agent with native MCP tool support",
    icon: "R",
    color: "from-violet-500/20 to-violet-600/5",
  },
  {
    name: "OpenAI Agents",
    protocol: "HTTP",
    description: "OpenAI's agent SDK using function calling",
    icon: "O",
    color: "from-emerald-500/20 to-emerald-600/5",
  },
  {
    name: "LangChain / CrewAI",
    protocol: "HTTP",
    description: "Python agent frameworks with custom tool wrappers",
    icon: "L",
    color: "from-yellow-500/20 to-yellow-600/5",
  },
  {
    name: "Custom Agent",
    protocol: "HTTP",
    description: "Any agent that can make HTTP requests or use MCP",
    icon: "+",
    color: "from-zinc-500/20 to-zinc-600/5",
  },
];

// ─── Config Generator ───

function getConfig(
  agent: AgentId,
  apiKey: string,
  budget: string
): string {
  const mcpConfig = (extra?: Record<string, string>) =>
    JSON.stringify(
      {
        mcpServers: {
          nexusx: {
            command: "npx",
            args: ["-y", "nexusx", "mcp"],
            env: {
              NEXUSX_API_KEY: apiKey,
              NEXUSX_GATEWAY_URL: "https://gateway.nexusx.dev",
              NEXUSX_SESSION_BUDGET_USDC: budget,
              ...extra,
            },
          },
        },
      },
      null,
      2
    );

  switch (agent) {
    case "claude-code":
      return `// ~/.claude/settings.json\n${mcpConfig()}`;

    case "claude-desktop":
      return `// claude_desktop_config.json\n${mcpConfig()}`;

    case "cline":
      return `// VS Code MCP settings (Cline / Roo extension)\n${mcpConfig({ NEXUSX_TRANSPORT: "stdio" })}`;

    case "openai":
      return `# OpenAI Agents SDK — NexusX Tool Definition
# pip install openai requests

import requests

NEXUSX_GATEWAY = "https://gateway.nexusx.dev"
NEXUSX_KEY = "${apiKey}"

nexusx_tool = {
    "type": "function",
    "function": {
        "name": "nexusx",
        "description": (
            "Call any API on NexusX marketplace via natural language. "
            "Supports translation, sentiment, embeddings, and 50+ more."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "task": {
                    "type": "string",
                    "description": "Natural language description of what you need"
                },
                "input": {
                    "type": "object",
                    "description": "Input data for the API call"
                }
            },
            "required": ["task"]
        }
    }
}

def call_nexusx(task: str, input: dict = None) -> str:
    resp = requests.post(
        f"{NEXUSX_GATEWAY}/v1/nexusx/orchestrate",
        headers={
            "Authorization": f"Bearer {NEXUSX_KEY}",
            "Content-Type": "application/json",
        },
        json={"task": task, "input": input or {}},
    )
    return resp.text`;

    case "langchain":
      return `# LangChain / CrewAI — NexusX Tool
# pip install langchain requests

from langchain.tools import Tool
import requests

NEXUSX_GATEWAY = "https://gateway.nexusx.dev"
NEXUSX_KEY = "${apiKey}"

def nexusx_call(query: str) -> str:
    """Call the NexusX orchestrator with a natural language task."""
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
        "Translation, sentiment, embeddings, image generation and more. "
        "Just describe what you need in natural language."
    ),
)`;

    case "http":
    default:
      return `# NexusX Gateway — Direct HTTP Integration

GATEWAY="https://gateway.nexusx.dev"
API_KEY="${apiKey}"

# Call the orchestrator (auto-selects API by intent):
curl -X POST "$GATEWAY/v1/nexusx/orchestrate" \\
  -H "Authorization: Bearer $API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"task": "translate Hello World to French"}'

# Or call a specific listing directly:
curl -X POST "$GATEWAY/v1/deepl-translation-api/translate" \\
  -H "Authorization: Bearer $API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"text": "Hello World", "target_lang": "FR"}'`;
  }
}

// ─── Main Component ───

export default function ConnectPage() {
  const [keys, setKeys] = useState<
    { id: string; name: string; keyPrefix: string; status: string }[]
  >([]);
  const [wallet, setWallet] = useState<{
    balanceUsdc: number;
    address: string;
  } | null>(null);
  const [rawKey, setRawKey] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<AgentId>("claude-code");
  const [budget, setBudget] = useState("5.00");
  const [isGenerating, setIsGenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    Promise.all([buyer.getApiKeys(), buyer.getWallet()])
      .then(([k, w]) => {
        setKeys(k);
        setWallet(w);
      })
      .catch(() => {});
  }, []);

  const activeKey = keys.find((k) => k.status === "ACTIVE");
  const displayKey = rawKey
    ? rawKey
    : activeKey
      ? `${activeKey.keyPrefix}...`
      : "nxs_your_api_key";
  const isPlaceholder = !rawKey && !activeKey;

  async function handleGenerateKey() {
    setIsGenerating(true);
    try {
      const result = await buyer.createApiKey("Agent Key");
      setRawKey(result.rawKey);
      const refreshed = await buyer.getApiKeys();
      setKeys(refreshed);
    } catch (err) {
      console.error(err);
    } finally {
      setIsGenerating(false);
    }
  }

  function handleCopy() {
    const config = getConfig(selectedAgent, displayKey, budget);
    navigator.clipboard.writeText(config);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  const agentOption = AGENT_OPTIONS.find((a) => a.id === selectedAgent)!;
  const config = getConfig(selectedAgent, displayKey, budget);

  return (
    <div className="max-w-5xl mx-auto space-y-12 animate-fade-in pb-16">
      {/* ─── Hero ─── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pt-4">
        <div className="space-y-2">
          <h1 className="text-4xl font-bold tracking-tight">
            Connect Your <span className="text-brand-400">AI Agent</span>
          </h1>
          <p className="text-lg text-zinc-400 max-w-xl">
            One config snippet. Instant access to every API in the marketplace.
            Pay per call in USDC on Base.
          </p>
        </div>

        {wallet !== null && (
          <div className="flex items-center gap-3 shrink-0">
            <div
              className={cn(
                "px-3 py-1.5 rounded-lg text-sm font-mono font-medium border",
                wallet.balanceUsdc > 0
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                  : "bg-amber-500/10 text-amber-400 border-amber-500/20"
              )}
            >
              {wallet.balanceUsdc > 0
                ? `$${wallet.balanceUsdc.toFixed(2)} USDC`
                : "Wallet empty"}
            </div>
            <Link
              href="/buyer/fund"
              className="px-3 py-1.5 text-xs rounded-lg bg-surface-3 border border-surface-4 text-zinc-300 hover:text-zinc-100 transition-colors"
            >
              Fund Wallet
            </Link>
          </div>
        )}
      </div>

      {/* ─── Live Config Generator ─── */}
      <div className="card p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-zinc-100">
            Your Agent Config
          </h2>
          {wallet !== null && wallet.balanceUsdc === 0 && (
            <div className="text-xs text-amber-400 flex items-center gap-1.5">
              <span>⚠</span>
              <span>
                Wallet empty —{" "}
                <Link href="/buyer/fund" className="underline hover:text-amber-300">
                  add USDC
                </Link>{" "}
                before making calls
              </span>
            </div>
          )}
        </div>

        {/* Agent Picker */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
            Select your agent
          </p>
          <div className="flex flex-wrap gap-2">
            {AGENT_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                onClick={() => setSelectedAgent(opt.id)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-sm font-medium transition-all border",
                  selectedAgent === opt.id
                    ? "bg-brand-600/20 text-brand-300 border-brand-600/30"
                    : "bg-surface-3 text-zinc-400 border-transparent hover:text-zinc-200 hover:border-surface-5"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Budget Input (MCP only) */}
        {agentOption.protocol === "mcp" && (
          <div className="flex items-center gap-3">
            <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider whitespace-nowrap">
              USDC budget / session
            </label>
            <div className="flex items-center gap-1.5 bg-surface-2 border border-surface-4 rounded-lg px-3 py-1.5">
              <span className="text-zinc-500 text-sm">$</span>
              <input
                type="number"
                min="0"
                step="0.5"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                className="w-16 bg-transparent text-sm text-zinc-200 outline-none"
              />
              <span className="text-zinc-500 text-xs">USDC</span>
            </div>
          </div>
        )}

        {/* Config Block */}
        <div className="relative group">
          <pre className="bg-surface-1 border border-surface-4 rounded-lg p-4 overflow-x-auto">
            <code className="text-xs font-mono text-zinc-300 whitespace-pre">
              {config}
            </code>
          </pre>
          <button
            onClick={handleCopy}
            className={cn(
              "absolute top-2 right-2 px-2.5 py-1 text-xs rounded-md border transition-all",
              copied
                ? "bg-emerald-600/20 text-emerald-300 border-emerald-600/30"
                : "bg-surface-3 text-zinc-400 border-surface-4 opacity-0 group-hover:opacity-100 hover:text-zinc-200"
            )}
          >
            {copied ? "Copied ✓" : "Copy"}
          </button>
        </div>

        {/* Footer row */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            {isPlaceholder ? (
              <button
                onClick={handleGenerateKey}
                disabled={isGenerating}
                className="text-sm text-brand-400 hover:text-brand-300 transition-colors disabled:opacity-50"
              >
                {isGenerating
                  ? "Generating..."
                  : "No key yet — generate one →"}
              </button>
            ) : rawKey ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-amber-400">
                  ⚠ Copy your key — it won&apos;t be shown again
                </span>
                <Link
                  href="/buyer/keys"
                  className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors underline"
                >
                  Manage keys
                </Link>
              </div>
            ) : (
              <Link
                href="/buyer/keys"
                className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                Manage keys →
              </Link>
            )}
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs text-zinc-500">
              Paste into:{" "}
              <code className="text-zinc-400">{agentOption.pasteInto}</code>
            </span>
            <button
              onClick={handleCopy}
              className={cn(
                "px-4 py-2 rounded-lg text-sm font-medium transition-all border",
                copied
                  ? "bg-emerald-600/20 text-emerald-300 border-emerald-600/30"
                  : "bg-brand-600/20 text-brand-300 border-brand-600/30 hover:bg-brand-600/30"
              )}
            >
              {copied ? "Copied ✓" : "Copy Config"}
            </button>
          </div>
        </div>
      </div>

      {/* ─── How It Works ─── */}
      <div className="space-y-6">
        <h2 className="text-xl font-bold text-zinc-100 text-center">
          How It Works
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <StepCard
            step={1}
            title="Paste & Connect"
            description="Add the config snippet to your agent. NexusX starts as a tool your agent can call automatically."
            icon="&#9672;"
          />
          <StepCard
            step={2}
            title="Agent Calls APIs"
            description="Describe what you need in natural language. The orchestrator finds the right API and handles payment."
            icon="&#9670;"
          />
          <StepCard
            step={3}
            title="Pay on Success"
            description="USDC is debited from your wallet only when a call succeeds. Failed calls cost nothing."
            icon="&#10003;"
          />
        </div>
      </div>

      {/* ─── Supported Agents Grid ─── */}
      <div className="space-y-6">
        <h2 className="text-xl font-bold text-zinc-100 text-center">
          Works With Any AI Agent
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {SUPPORTED_AGENTS.map((agent) => (
            <div
              key={agent.name}
              className="card p-5 relative overflow-hidden group hover:border-surface-5 transition-colors"
            >
              <div
                className={cn(
                  "absolute inset-0 bg-gradient-to-br opacity-50 pointer-events-none",
                  agent.color
                )}
              />
              <div className="relative">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-lg bg-surface-3 flex items-center justify-center text-lg font-bold text-brand-400 border border-surface-4">
                    {agent.icon}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-zinc-100">
                      {agent.name}
                    </p>
                    <span className="text-2xs text-zinc-500 font-mono">
                      {agent.protocol}
                    </span>
                  </div>
                </div>
                <p className="text-xs text-zinc-400">{agent.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ───

function StepCard({
  step,
  title,
  description,
  icon,
}: {
  step: number;
  title: string;
  description: string;
  icon: string;
}) {
  return (
    <div className="text-center space-y-3">
      <div className="w-14 h-14 rounded-2xl bg-brand-600/10 border border-brand-600/20 flex items-center justify-center text-2xl text-brand-400 mx-auto">
        {icon}
      </div>
      <div>
        <p className="text-2xs text-brand-400 font-semibold uppercase tracking-wider">
          Step {step}
        </p>
        <h3 className="text-base font-semibold text-zinc-100 mt-1">{title}</h3>
        <p className="text-sm text-zinc-400 mt-1">{description}</p>
      </div>
    </div>
  );
}
