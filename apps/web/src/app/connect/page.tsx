"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

// ─── Agent Framework Data ───

const AGENTS = [
  {
    name: "Claude Code",
    protocol: "MCP",
    description: "Anthropic's CLI agent with native MCP tool support",
    icon: "C",
    color: "from-orange-500/20 to-orange-600/5",
  },
  {
    name: "OpenAI Codex",
    protocol: "HTTP",
    description: "OpenAI's code agent using function calling via HTTP tools",
    icon: "O",
    color: "from-emerald-500/20 to-emerald-600/5",
  },
  {
    name: "Google Gemini",
    protocol: "HTTP",
    description: "Google's multimodal agent with external tool support",
    icon: "G",
    color: "from-blue-500/20 to-blue-600/5",
  },
  {
    name: "Moonshot Kimi",
    protocol: "HTTP",
    description: "Moonshot AI's agent with web browsing and API access",
    icon: "K",
    color: "from-purple-500/20 to-purple-600/5",
  },
  {
    name: "LangChain Agent",
    protocol: "HTTP",
    description: "Framework-agnostic agents using LangChain tool abstraction",
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

export default function ConnectPage() {
  const [activeSection, setActiveSection] = useState<"mcp" | "http">("mcp");

  return (
    <div className="max-w-5xl mx-auto space-y-12 animate-fade-in pb-16">
      {/* ─── Hero ─── */}
      <div className="text-center space-y-4 pt-4">
        <h1 className="text-4xl font-bold tracking-tight">
          Connect Your <span className="text-brand-400">AI Agent</span> to NexusX
        </h1>
        <p className="text-lg text-zinc-400 max-w-2xl mx-auto">
          Give any AI agent instant access to a marketplace of APIs.
          Pay per call in USDC. No subscriptions, no rate limit negotiations.
        </p>
      </div>

      {/* ─── How It Works ─── */}
      <div className="card p-8">
        <h2 className="text-xl font-bold text-zinc-100 mb-6 text-center">
          How It Works
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <StepCard
            step={1}
            title="Discover APIs"
            description="Browse the marketplace or let the AI orchestrator automatically find the right API for your task."
            icon="&#9672;"
          />
          <StepCard
            step={2}
            title="Pay with USDC"
            description="Automatic per-call payments on Base L2. Your agent signs a payment, and the gateway verifies and proxies the request."
            icon="&#9670;"
          />
          <StepCard
            step={3}
            title="Get Results"
            description="Pay only on success. If the upstream API fails, your agent keeps the USDC. No wasted spend."
            icon="&#10003;"
          />
        </div>
      </div>

      {/* ─── Protocol Toggle ─── */}
      <div className="space-y-6">
        <div className="flex justify-center gap-2">
          <button
            onClick={() => setActiveSection("mcp")}
            className={cn(
              "px-6 py-2.5 rounded-lg text-sm font-medium transition-all",
              activeSection === "mcp"
                ? "bg-brand-600/20 text-brand-300 border border-brand-600/30"
                : "bg-surface-3 text-zinc-400 border border-transparent hover:text-zinc-200"
            )}
          >
            MCP Agents
          </button>
          <button
            onClick={() => setActiveSection("http")}
            className={cn(
              "px-6 py-2.5 rounded-lg text-sm font-medium transition-all",
              activeSection === "http"
                ? "bg-brand-600/20 text-brand-300 border border-brand-600/30"
                : "bg-surface-3 text-zinc-400 border border-transparent hover:text-zinc-200"
            )}
          >
            HTTP Agents
          </button>
        </div>

        {activeSection === "mcp" && <McpSection />}
        {activeSection === "http" && <HttpSection />}
      </div>

      {/* ─── Supported Agents Grid ─── */}
      <div className="space-y-6">
        <h2 className="text-xl font-bold text-zinc-100 text-center">
          Works With Any AI Agent
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {AGENTS.map((agent) => (
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

      {/* ─── Quick Start ─── */}
      <div className="card p-8 border-brand-600/20">
        <h2 className="text-xl font-bold text-zinc-100 mb-6">Quick Start</h2>
        <div className="space-y-4">
          <QuickStep
            step={1}
            title="Get an API Key"
            description="Sign up and generate an API key from the Buyer > API Keys section."
          />
          <QuickStep
            step={2}
            title="Configure Your Agent"
            description="Add the NexusX MCP server config (for MCP agents) or set the gateway URL as a tool endpoint (for HTTP agents)."
          />
          <QuickStep
            step={3}
            title="Fund Your Wallet"
            description="Deposit USDC on Base to your agent wallet. The gateway accepts x402 payments automatically."
          />
          <QuickStep
            step={4}
            title="Make Your First Call"
            description='Ask your agent to use NexusX: "translate this text to French" — the orchestrator handles API selection and payment.'
          />
        </div>
      </div>
    </div>
  );
}

// ─── MCP Section ───

function McpSection() {
  return (
    <div className="space-y-6">
      <div className="card p-6">
        <h3 className="text-lg font-semibold text-zinc-100 mb-2">
          For MCP-Compatible Agents
        </h3>
        <p className="text-sm text-zinc-400 mb-4">
          Agents like Claude Code, Cline, and other MCP clients connect to NexusX
          through the{" "}
          <span className="font-mono text-brand-300">@nexusx/mcp-server</span>.
          This gives them access to all marketplace APIs as MCP tools.
        </p>

        <div className="space-y-4">
          <div>
            <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
              1. Add MCP Server Config
            </h4>
            <CodeBlock>{`// claude_desktop_config.json or .claude/settings.json
{
  "mcpServers": {
    "nexusx": {
      "command": "npx",
      "args": ["-y", "@nexusx/mcp-server"],
      "env": {
        "NEXUSX_API_KEY": "nxs_your_api_key",
        "NEXUSX_GATEWAY_URL": "https://gateway.nexusx.io"
      }
    }
  }
}`}</CodeBlock>
          </div>

          <div>
            <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
              2. Use the Orchestrator Tool
            </h4>
            <p className="text-sm text-zinc-400 mb-2">
              The <span className="font-mono text-brand-300">nexusx</span> tool
              understands natural language. Just describe what you need:
            </p>
            <CodeBlock>{`// Your agent automatically calls:
{
  "tool": "nexusx",
  "arguments": {
    "task": "translate this text to French",
    "input": { "text": "Hello, how are you?" }
  }
}

// The orchestrator:
// 1. Classifies intent → "translate"
// 2. Selects best API → deepl-translation-api
// 3. Handles payment → signs USDC transfer
// 4. Returns result → translated text`}</CodeBlock>
          </div>

          <div>
            <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
              3. Available MCP Resources
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
              <ResourceRow uri="nexusx://listings" description="Browse all APIs" />
              <ResourceRow uri="nexusx://categories" description="Category tree" />
              <ResourceRow uri="nexusx://prices" description="Live price ticks" />
              <ResourceRow uri="nexusx://wallet" description="Wallet balance" />
              <ResourceRow uri="nexusx://bundles" description="Composite tools" />
              <ResourceRow uri="nexusx://reliability/{slug}" description="API reliability" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── HTTP Section ───

function HttpSection() {
  return (
    <div className="space-y-6">
      <div className="card p-6">
        <h3 className="text-lg font-semibold text-zinc-100 mb-2">
          For HTTP-Based Agents
        </h3>
        <p className="text-sm text-zinc-400 mb-4">
          Any agent that can make HTTP requests can use NexusX. Call the gateway
          directly with an API key or use the x402 payment protocol for
          wallet-based payments.
        </p>

        <div className="space-y-4">
          <div>
            <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
              1. Gateway Endpoint
            </h4>
            <CodeBlock>{`Base URL: https://gateway.nexusx.io

# Call any API by its slug:
POST /v1/{listing-slug}/{path}

# Examples:
POST /v1/openai-gpt4-turbo/chat/completions
POST /v1/deepl-translation-api/translate
POST /v1/sentiment-analysis-pro/sentiment
POST /v1/text-embeddings-v3/embed`}</CodeBlock>
          </div>

          <div>
            <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
              2. Authentication Options
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-surface-2 rounded-lg p-4">
                <h5 className="text-sm font-medium text-zinc-200 mb-2">
                  API Key (Simple)
                </h5>
                <p className="text-xs text-zinc-400 mb-2">
                  Pre-funded account. Gateway debits per call.
                </p>
                <code className="text-xs font-mono text-brand-300 block">
                  Authorization: Bearer nxs_your_key
                </code>
              </div>
              <div className="bg-surface-2 rounded-lg p-4">
                <h5 className="text-sm font-medium text-zinc-200 mb-2">
                  x402 Payment (On-Chain)
                </h5>
                <p className="text-xs text-zinc-400 mb-2">
                  Per-call USDC payments on Base L2. No account needed.
                </p>
                <code className="text-xs font-mono text-brand-300 block">
                  X-Payment: &lt;signed-eip3009&gt;
                </code>
              </div>
            </div>
          </div>

          <div>
            <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
              3. Example: cURL
            </h4>
            <CodeBlock>{`# Sentiment analysis
curl -X POST https://gateway.nexusx.io/v1/sentiment-analysis-pro/sentiment \\
  -H "Authorization: Bearer nxs_your_key" \\
  -H "Content-Type: application/json" \\
  -d '{"text": "This product is amazing!"}'

# Response includes NexusX headers:
# X-NexusX-Price-USDC: 0.001000
# X-NexusX-Latency-Ms: 45
# X-NexusX-Request-Id: req_abc123`}</CodeBlock>
          </div>

          <div>
            <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
              4. x402 Payment Flow
            </h4>
            <CodeBlock>{`# Step 1: Make request (no payment)
POST /v1/openai-gpt4-turbo/chat/completions
→ 402 Payment Required
→ { "price": "0.010000", "network": "base", ... }

# Step 2: Sign EIP-3009 transferWithAuthorization
→ Agent wallet signs USDC transfer authorization

# Step 3: Retry with payment header
POST /v1/openai-gpt4-turbo/chat/completions
X-Payment: <base64-encoded-signed-payment>
→ 200 OK (payment settled after success)`}</CodeBlock>
          </div>
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

function QuickStep({
  step,
  title,
  description,
}: {
  step: number;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-4">
      <div className="w-8 h-8 rounded-full bg-brand-600/20 border border-brand-600/30 flex items-center justify-center text-sm font-bold text-brand-400 shrink-0">
        {step}
      </div>
      <div>
        <h4 className="text-sm font-medium text-zinc-100">{title}</h4>
        <p className="text-sm text-zinc-400 mt-0.5">{description}</p>
      </div>
    </div>
  );
}

function ResourceRow({ uri, description }: { uri: string; description: string }) {
  return (
    <div className="flex items-center gap-2 bg-surface-2 rounded-lg px-3 py-2">
      <code className="text-xs font-mono text-brand-300 flex-1 truncate">
        {uri}
      </code>
      <span className="text-xs text-zinc-500 shrink-0">{description}</span>
    </div>
  );
}

function CodeBlock({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group">
      <pre className="bg-surface-1 border border-surface-4 rounded-lg p-4 overflow-x-auto">
        <code className="text-xs font-mono text-zinc-300 whitespace-pre">
          {children}
        </code>
      </pre>
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity px-2 py-1 text-2xs bg-surface-3 text-zinc-400 hover:text-zinc-200 rounded border border-surface-4"
      >
        {copied ? "Copied!" : "Copy"}
      </button>
    </div>
  );
}
