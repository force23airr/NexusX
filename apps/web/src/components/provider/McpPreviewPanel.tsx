"use client";

import React, { useState, useMemo } from "react";
import type { DetectEndpoint, InputSchemaField } from "@/types";

interface McpPreviewPanelProps {
  name: string;
  description: string;
  sampleRequest: string;
  endpoints: DetectEndpoint[];
  inputSchemaFields: InputSchemaField[];
  floorPrice: string;
  ceilingPrice: string;
}

function slugifyToolName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

function deriveProperties(
  inputSchemaFields: InputSchemaField[],
  sampleRequest: string,
  endpoints: DetectEndpoint[]
): { properties: Record<string, unknown>; required: string[] } {
  let fields = inputSchemaFields;

  if (fields.length === 0 && sampleRequest.trim()) {
    try {
      const parsed = JSON.parse(sampleRequest);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        fields = Object.entries(parsed).map(([key, val]) => ({
          name: key,
          type: typeof val === "number" ? "number" : typeof val === "boolean" ? "boolean" : "string",
          required: false,
          description: "",
        }));
      }
    } catch { /* skip */ }
  }

  if (fields.length === 0) {
    const ep = endpoints.find((e) => e.requestSchema);
    if (ep?.requestSchema?.properties) {
      const req = Array.isArray(ep.requestSchema.required) ? (ep.requestSchema.required as string[]) : [];
      const props = ep.requestSchema.properties as Record<string, Record<string, unknown>>;
      fields = Object.entries(props).map(([key, prop]) => ({
        name: key,
        type: (prop.type as string) || "string",
        required: req.includes(key),
        description: (prop.description as string) || "",
      }));
    }
  }

  if (fields.length === 0) {
    fields = [{ name: "input", type: "string", required: true, description: "" }];
  }

  const properties: Record<string, unknown> = {};
  for (const f of fields) {
    const prop: Record<string, string> = { type: f.type };
    if (f.description) prop.description = f.description;
    properties[f.name] = prop;
  }

  return {
    properties,
    required: fields.filter((f) => f.required).map((f) => f.name),
  };
}

// ─── Syntax highlight JSON for display ───

function highlightJson(json: string): React.ReactNode[] {
  return json.split("\n").map((line, i) => {
    // Color keys, strings, numbers differently
    const colored = line
      // Keys (before colon)
      .replace(/"([^"]+)"(?=\s*:)/g, '<span class="text-brand-300">"$1"</span>')
      // String values (after colon)
      .replace(/:\s*"([^"]*)"(,?)$/g, ': <span class="text-emerald-300">"$1"</span>$2')
      // Booleans and numbers
      .replace(/:\s*(true|false|null|\d+\.?\d*)(,?)$/g, ': <span class="text-amber-300">$1</span>$2');

    return (
      <span key={i} dangerouslySetInnerHTML={{ __html: colored }} />
    );
  });
}

export default function McpPreviewPanel({
  name,
  description,
  sampleRequest,
  endpoints,
  inputSchemaFields,
  floorPrice,
  ceilingPrice,
}: McpPreviewPanelProps) {
  const [copied, setCopied] = useState(false);

  const toolName = name.trim() ? `nexusx_${slugifyToolName(name)}` : "";

  const { properties, required } = useMemo(
    () => deriveProperties(inputSchemaFields, sampleRequest, endpoints),
    [inputSchemaFields, sampleRequest, endpoints]
  );

  const toolDef = useMemo(() => {
    if (!toolName) return null;
    return {
      name: toolName,
      description: description || "Your API description",
      inputSchema: {
        type: "object" as const,
        properties,
        ...(required.length > 0 ? { required } : {}),
      },
    };
  }, [toolName, description, properties, required]);

  const toolJson = useMemo(() => toolDef ? JSON.stringify(toolDef, null, 2) : "", [toolDef]);

  const handleCopy = () => {
    if (!toolJson) return;
    navigator.clipboard.writeText(toolJson).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const floorNum = parseFloat(floorPrice) || 0;
  const ceilingNum = parseFloat(ceilingPrice) || 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-zinc-200">
            MCP Tool Preview
          </h3>
          <p className="text-2xs text-zinc-500 mt-0.5">
            What AI agents will see
          </p>
        </div>
        <span className="flex items-center gap-1.5 text-2xs text-zinc-500">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          Live
        </span>
      </div>

      {!toolName ? (
        /* ── Empty state — visible enough to read the format ── */
        <div className="rounded-lg border border-surface-4 bg-[#0d1117] p-5 space-y-3">
          <pre className="font-mono text-[13px] leading-relaxed whitespace-pre">
            <span className="text-zinc-600">{"{"}</span>{"\n"}
            {"  "}<span className="text-zinc-500">{'"name"'}</span><span className="text-zinc-600">:</span> <span className="text-zinc-500/70">{'"nexusx_your_api"'}</span><span className="text-zinc-600">,</span>{"\n"}
            {"  "}<span className="text-zinc-500">{'"description"'}</span><span className="text-zinc-600">:</span> <span className="text-zinc-500/70">{'"..."'}</span><span className="text-zinc-600">,</span>{"\n"}
            {"  "}<span className="text-zinc-500">{'"inputSchema"'}</span><span className="text-zinc-600">:</span> <span className="text-zinc-600">{"{"}</span>{"\n"}
            {"    "}<span className="text-zinc-500">{'"type"'}</span><span className="text-zinc-600">:</span> <span className="text-zinc-500/70">{'"object"'}</span><span className="text-zinc-600">,</span>{"\n"}
            {"    "}<span className="text-zinc-500">{'"properties"'}</span><span className="text-zinc-600">:</span> <span className="text-zinc-600">{"{ ... }"}</span>{"\n"}
            {"  "}<span className="text-zinc-600">{"}"}</span>{"\n"}
            <span className="text-zinc-600">{"}"}</span>
          </pre>
          <p className="text-xs text-zinc-500">
            Paste a URL and click <span className="text-zinc-400">Auto-Detect</span> to generate this
          </p>
        </div>
      ) : (
        /* ── Live JSON tool definition ── */
        <div className="space-y-3">
          {/* The JSON — this is the hero */}
          <div className="relative group">
            <pre className="bg-[#0d1117] border border-surface-4 rounded-lg p-4 text-[13px] font-mono leading-relaxed overflow-x-auto max-h-[400px] overflow-y-auto whitespace-pre">
              {highlightJson(toolJson)}
            </pre>
            <button
              type="button"
              onClick={handleCopy}
              className="absolute top-2.5 right-2.5 px-2.5 py-1 text-2xs bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-100 rounded border border-zinc-700 transition-all opacity-0 group-hover:opacity-100"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>

          {/* Agent usage example */}
          <div className="bg-surface-2 border border-surface-4 rounded-lg p-3">
            <span className="text-2xs text-zinc-500 uppercase tracking-wider font-semibold">
              Agent discovers via orchestrator
            </span>
            <pre className="text-xs font-mono text-zinc-400 mt-1.5 whitespace-pre-wrap">{
              `nexusx({ intent: "${(description || "...").slice(0, 50)}${description.length > 50 ? "..." : ""}" })`
            }</pre>
          </div>

          {/* Pricing + endpoints bar */}
          <div className="flex items-center justify-between text-xs">
            {(floorNum > 0 || ceilingNum > 0) ? (
              <div className="flex items-center gap-1.5 text-zinc-500">
                <span className="font-mono text-emerald-400">
                  {floorNum > 0 ? `$${floorNum.toFixed(4)}` : "---"}
                </span>
                <span className="text-zinc-700">&ndash;</span>
                <span className="font-mono text-emerald-400">
                  {ceilingNum > 0 ? `$${ceilingNum.toFixed(4)}` : "---"}
                </span>
                <span>USDC/call</span>
              </div>
            ) : (
              <span className="text-zinc-600">Set pricing in Step 2</span>
            )}
            {endpoints.length > 0 && (
              <span className="text-zinc-500">
                {endpoints.length} endpoint{endpoints.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
