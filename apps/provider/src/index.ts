// ═══════════════════════════════════════════════════════════════
// NexusX — Provider Service Entry Point
// apps/provider/src/index.ts
// ═══════════════════════════════════════════════════════════════

import { createProviderApp } from "./server";

const PORT = parseInt(process.env.PROVIDER_PORT || "3500", 10);

const app = createProviderApp();

app.listen(PORT, () => {
  console.log(`[Provider] NexusX Provider Service listening on port ${PORT}`);
  console.log(`[Provider] Endpoints:`);
  console.log(`  POST /v3/embed          — Text embeddings (512-dim)`);
  console.log(`  POST /v1/sentiment      — Sentiment analysis`);
  console.log(`  POST /v2/translate      — Translation`);
  console.log(`  POST /v1/chat/completions — LLM chat`);
  console.log(`  POST /v1/detect         — Object detection`);
  console.log(`  GET  /v1/download/reviews — Restaurant reviews dataset`);
  console.log(`  GET  /health            — Health check`);
  if (process.env.PROVIDER_API_KEY) {
    console.log(`[Provider] Auth enabled (PROVIDER_API_KEY set)`);
  } else {
    console.log(`[Provider] Auth disabled (no PROVIDER_API_KEY)`);
  }
});
