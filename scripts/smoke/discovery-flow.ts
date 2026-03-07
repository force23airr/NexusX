import { NexusXAgent, NexusXProvider } from "../../packages/sdk/src/index";

const REQUIRED_ENV = [
  "NEXUSX_PROVIDER_API_URL",
  "NEXUSX_PROVIDER_API_KEY",
  "NEXUSX_WEB_URL",
  "NEXUSX_GATEWAY_URL",
] as const;

for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

const provider = new NexusXProvider({
  baseUrl: process.env.NEXUSX_PROVIDER_API_URL!,
  apiKey: process.env.NEXUSX_PROVIDER_API_KEY!,
  timeoutMs: 15_000,
});

const agent = new NexusXAgent({
  webUrl: process.env.NEXUSX_WEB_URL!,
  gatewayUrl: process.env.NEXUSX_GATEWAY_URL!,
  apiKey: process.env.NEXUSX_AGENT_API_KEY || "smoke-search-only",
  timeoutMs: 15_000,
});

const region = (process.env.NEXUSX_SMOKE_REGION || "US").toUpperCase();
const categorySlug = process.env.NEXUSX_SMOKE_CATEGORY || "language-models";
const targetBaseUrl = process.env.NEXUSX_SMOKE_TARGET_BASE_URL || "https://httpbin.org";
const docsUrl = process.env.NEXUSX_SMOKE_DOCS_URL || "https://httpbin.org";
const query = process.env.NEXUSX_SMOKE_QUERY || "summarize text for an agent";
const keepListing = process.env.NEXUSX_SMOKE_KEEP_LISTING === "1";
const suffix = Date.now().toString(36);
const slug = `smoke-discovery-${suffix}`;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function poll<T>(
  label: string,
  fn: () => Promise<T | null>,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const intervalMs = options.intervalMs ?? 5_000;
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const result = await fn();
    if (result !== null) {
      return result;
    }
    await sleep(intervalMs);
  }

  throw new Error(`Timed out waiting for ${label}`);
}

async function main() {
  let listingId: string | null = null;

  try {
    console.log(`[Smoke] Creating listing ${slug}`);
    const created = await provider.createListing({
      slug,
      name: `Smoke Discovery ${suffix}`,
      description: "Smoke-test listing used to verify provider activation, indexing, and structured agent discovery end-to-end.",
      categorySlug,
      listingType: "REST_API",
      baseUrl: targetBaseUrl,
      docsUrl,
      authType: "none",
      floorPriceUsdc: 0.001,
      capacityPerMinute: 30,
      tags: ["smoke-test", "agent-discovery", "summarize"],
      intents: ["summarize-text"],
      capabilityTags: ["summarize", "smoke-probe"],
      inputModalities: ["text"],
      outputModalities: ["text"],
      availabilityRegions: [region],
      complianceTags: ["soc2"],
      domainMetadata: {
        smoke: true,
        source: "scripts/smoke/discovery-flow.ts",
      },
    });
    listingId = created.id;
    console.log(`[Smoke] Created ${created.id} (${created.status})`);

    console.log("[Smoke] Updating listing metadata before activation");
    await provider.updateListing(created.id, {
      capabilityTags: ["summarize", "smoke-probe", "agent-routing"],
      complianceTags: ["soc2", "gdpr"],
      domainMetadata: {
        smoke: true,
        updated: true,
        source: "scripts/smoke/discovery-flow.ts",
      },
    });

    console.log("[Smoke] Activating listing");
    await provider.publishListing(created.id);

    await poll(
      "listing activation",
      async () => {
        const listing = await provider.getListing(created.id);
        return listing.status === "ACTIVE" ? listing : null;
      },
      { timeoutMs: 30_000, intervalMs: 2_000 },
    );
    console.log("[Smoke] Listing is ACTIVE");

    const searchResult = await poll(
      "structured agent discovery",
      async () => {
        const result = await agent.search(query, {
          limit: 5,
          priorityMode: "balanced",
          metadataFilters: {
            availabilityRegion: region,
            capabilityRequired: ["summarize", "agent-routing"],
            outputModality: ["text"],
            complianceRequired: ["soc2"],
            maxPriceUsdc: 0.01,
          },
        });

        return result.matches.some((match) => match.slug === slug) ? result : null;
      },
      { timeoutMs: 180_000, intervalMs: 5_000 },
    );

    const matched = searchResult.matches.find((match) => match.slug === slug);
    console.log("[Smoke] Discovery succeeded");
    console.log(JSON.stringify({
      slug,
      query,
      region,
      queryId: searchResult.queryId,
      routeTimeMs: searchResult.routeTimeMs,
      matched,
    }, null, 2));
  } finally {
    if (listingId && !keepListing) {
      try {
        console.log(`[Smoke] Deprecating ${listingId}`);
        await provider.deprecateListing(listingId);
      } catch (error) {
        console.error("[Smoke] Cleanup failed:", error);
      }
    }
  }
}

main().catch((error) => {
  console.error("[Smoke] Failed:", error);
  process.exit(1);
});
