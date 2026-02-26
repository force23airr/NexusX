"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { ListingDetail } from "@/types";

interface Props {
  listing: ListingDetail;
}

const TABS = ["x402 Payment", "MCP Tool", "cURL / HTTP", "Agent SDKs"] as const;
type Tab = (typeof TABS)[number];

export function IntegrationPanel({ listing }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("x402 Payment");

  return (
    <div className="space-y-4">
      {/* Tab bar */}
      <div className="flex gap-1 border-b border-surface-4 pb-px">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "px-4 py-2 text-sm font-medium rounded-t-lg transition-colors",
              activeTab === tab
                ? "text-brand-300 border-b-2 border-brand-400 bg-surface-2"
                : "text-zinc-500 hover:text-zinc-300"
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="card p-5">
        {activeTab === "x402 Payment" && <X402Tab listing={listing} />}
        {activeTab === "MCP Tool" && <McpTab listing={listing} />}
        {activeTab === "cURL / HTTP" && <CurlTab listing={listing} />}
        {activeTab === "Agent SDKs" && <AgentSdkTab listing={listing} />}
      </div>
    </div>
  );
}

// ─── x402 Payment Tab ───

function X402Tab({ listing }: { listing: ListingDetail }) {
  return (
    <div className="space-y-4">
      <h4 className="text-sm font-semibold text-zinc-200">
        x402 Payment Protocol Flow
      </h4>
      <p className="text-sm text-zinc-400">
        NexusX uses the{" "}
        <span className="text-brand-300 font-medium">x402 HTTP payment protocol</span>{" "}
        for automatic per-call USDC payments on Base L2. Here&apos;s how it works:
      </p>

      <div className="bg-surface-2 rounded-lg p-4 font-mono text-xs text-zinc-300 space-y-2">
        <div className="text-zinc-500">{"// 1. Agent makes API call (no payment yet)"}</div>
        <div>
          POST /v1/<span className="text-brand-300">{listing.slug}</span>/endpoint
        </div>
        <div className="text-zinc-500 mt-3">{"// 2. Gateway returns 402 with payment requirements"}</div>
        <div>HTTP 402 Payment Required</div>
        <div className="text-zinc-500">
          {`{`}
        </div>
        <div className="pl-4">&quot;price&quot;: &quot;{listing.currentPriceUsdc.toFixed(6)}&quot;,</div>
        <div className="pl-4">&quot;currency&quot;: &quot;USDC&quot;,</div>
        <div className="pl-4">&quot;network&quot;: &quot;base&quot;</div>
        <div className="text-zinc-500">
          {`}`}
        </div>
        <div className="text-zinc-500 mt-3">{"// 3. Agent signs EIP-3009 payment & retries"}</div>
        <div>
          POST /v1/<span className="text-brand-300">{listing.slug}</span>/endpoint
        </div>
        <div>X-Payment: &lt;signed-payment-header&gt;</div>
        <div className="text-zinc-500 mt-3">{"// 4. Gateway verifies payment, proxies to your API, settles on success"}</div>
        <div className="text-emerald-400">HTTP 200 OK</div>
      </div>

      <div className="bg-surface-2 rounded-lg p-4 text-sm">
        <h5 className="font-medium text-zinc-200 mb-2">Revenue Split</h5>
        <div className="grid grid-cols-2 gap-2 text-zinc-400">
          <div>Current price per call:</div>
          <div className="text-zinc-200 font-mono">${listing.currentPriceUsdc.toFixed(6)} USDC</div>
          <div>Platform fee (12%):</div>
          <div className="text-zinc-200 font-mono">${(listing.currentPriceUsdc * 0.12).toFixed(6)} USDC</div>
          <div>You receive (88%):</div>
          <div className="text-emerald-400 font-mono">${(listing.currentPriceUsdc * 0.88).toFixed(6)} USDC</div>
        </div>
      </div>
    </div>
  );
}

// ─── MCP Tool Tab ───

function McpTab({ listing }: { listing: ListingDetail }) {
  const toolName = `nexusx_${listing.slug.replace(/-/g, "_")}`;

  return (
    <div className="space-y-4">
      <h4 className="text-sm font-semibold text-zinc-200">
        MCP (Model Context Protocol) Integration
      </h4>
      <p className="text-sm text-zinc-400">
        AI agents like Claude Code connect via MCP. They can use the{" "}
        <span className="font-mono text-brand-300">nexusx</span> orchestrator tool
        or call your listing directly.
      </p>

      <div>
        <h5 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
          Orchestrator (recommended)
        </h5>
        <CodeBlock language="json">{`{
  "tool": "nexusx",
  "arguments": {
    "task": "Use ${listing.name}",
    "input": ${listing.sampleRequest ? JSON.stringify(listing.sampleRequest, null, 2) : '{ "text": "your input here" }'}
  }
}`}</CodeBlock>
      </div>

      <div>
        <h5 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
          Direct tool call
        </h5>
        <CodeBlock language="json">{`{
  "tool": "${toolName}",
  "arguments": {
    "path": "/",
    "method": "POST",
    "body": ${listing.sampleRequest ? JSON.stringify(listing.sampleRequest, null, 2) : '{ "text": "your input here" }'}
  }
}`}</CodeBlock>
      </div>

      <div>
        <h5 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
          MCP Server Configuration
        </h5>
        <CodeBlock language="json">{`{
  "mcpServers": {
    "nexusx": {
      "command": "npx",
      "args": ["-y", "@nexusx/mcp-server"],
      "env": {
        "NEXUSX_API_KEY": "your-api-key",
        "NEXUSX_GATEWAY_URL": "https://gateway.nexusx.io"
      }
    }
  }
}`}</CodeBlock>
      </div>
    </div>
  );
}

// ─── cURL / HTTP Tab ───

function CurlTab({ listing }: { listing: ListingDetail }) {
  const sampleBody = listing.sampleRequest
    ? JSON.stringify(listing.sampleRequest)
    : '{"text": "hello"}';

  return (
    <div className="space-y-4">
      <h4 className="text-sm font-semibold text-zinc-200">
        Direct HTTP API
      </h4>
      <p className="text-sm text-zinc-400">
        Call the NexusX gateway directly with an API key or x402 payment header.
      </p>

      <div>
        <h5 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
          API Key Authentication
        </h5>
        <CodeBlock language="bash">{`curl -X POST \\
  https://gateway.nexusx.io/v1/${listing.slug} \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '${sampleBody}'`}</CodeBlock>
      </div>

      <div>
        <h5 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
          Gateway Response Headers
        </h5>
        <CodeBlock language="http">{`X-NexusX-Request-Id: req_abc123
X-NexusX-Listing: ${listing.slug}
X-NexusX-Price-USDC: ${listing.currentPriceUsdc.toFixed(6)}
X-NexusX-Fee-USDC: ${(listing.currentPriceUsdc * 0.12).toFixed(6)}
X-NexusX-Latency-Ms: 45`}</CodeBlock>
      </div>

      <div>
        <h5 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
          Sandbox Mode (free, for testing)
        </h5>
        <CodeBlock language="bash">{`curl -X POST \\
  https://gateway.nexusx.io/v1/${listing.slug} \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "X-NexusX-Sandbox: true" \\
  -H "Content-Type: application/json" \\
  -d '${sampleBody}'`}</CodeBlock>
      </div>
    </div>
  );
}

// ─── Agent SDKs Tab ───

function AgentSdkTab({ listing }: { listing: ListingDetail }) {
  const toolName = `nexusx_${listing.slug.replace(/-/g, "_")}`;

  return (
    <div className="space-y-4">
      <h4 className="text-sm font-semibold text-zinc-200">
        Agent Framework Examples
      </h4>
      <p className="text-sm text-zinc-400">
        Connect from popular AI agent frameworks.
      </p>

      <div>
        <h5 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
          Claude Code (MCP Config)
        </h5>
        <CodeBlock language="json">{`// Add to .claude/settings.json or claude_desktop_config.json
{
  "mcpServers": {
    "nexusx": {
      "command": "npx",
      "args": ["-y", "@nexusx/mcp-server"],
      "env": {
        "NEXUSX_API_KEY": "your-api-key"
      }
    }
  }
}`}</CodeBlock>
      </div>

      <div>
        <h5 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
          OpenAI Agents SDK (Python)
        </h5>
        <CodeBlock language="python">{`from agents import Agent, Tool
import httpx

async def call_${listing.slug.replace(/-/g, "_")}(input: dict) -> dict:
    """Call ${listing.name} via NexusX gateway."""
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            "https://gateway.nexusx.io/v1/${listing.slug}",
            headers={"Authorization": "Bearer YOUR_API_KEY"},
            json=input,
        )
        return resp.json()

tool = Tool(
    name="${toolName}",
    description="${listing.description.slice(0, 100)}",
    function=call_${listing.slug.replace(/-/g, "_")},
)`}</CodeBlock>
      </div>

      <div>
        <h5 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
          LangChain (TypeScript)
        </h5>
        <CodeBlock language="typescript">{`import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

const ${listing.slug.replace(/-/g, "_")}Tool = new DynamicStructuredTool({
  name: "${toolName}",
  description: "${listing.description.slice(0, 100)}",
  schema: z.object({
    text: z.string().describe("Input text"),
  }),
  func: async (input) => {
    const res = await fetch(
      "https://gateway.nexusx.io/v1/${listing.slug}",
      {
        method: "POST",
        headers: {
          "Authorization": "Bearer YOUR_API_KEY",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input),
      }
    );
    return JSON.stringify(await res.json());
  },
});`}</CodeBlock>
      </div>
    </div>
  );
}

// ─── Code Block Component ───

function CodeBlock({
  children,
  language,
}: {
  children: string;
  language: string;
}) {
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
      <span className="absolute bottom-2 right-2 text-2xs text-zinc-600 font-mono">
        {language}
      </span>
    </div>
  );
}
