/**
 * NexusX API client — thin wrapper over the NexusX REST API.
 * Used by the CLI to create listings, query status, etc.
 */

export interface DeployOptions {
  name: string;
  description: string;
  baseUrl: string;
  listingType: string;
  authType: string;
  floorPriceUsdc: number;
  ceilingPriceUsdc?: number;
  categorySlug?: string;
  docsUrl?: string;
  healthCheckUrl?: string;
  sampleRequest?: unknown;
  sampleResponse?: unknown;
  payoutAddress: string;
}

export interface DeployResult {
  id: string;
  slug: string;
  name: string;
  listingUrl: string;
  mcpToolName: string;
  floorPriceUsdc: number;
  ceilingPriceUsdc?: number;
}

export interface DetectResult {
  detected: boolean;
  name?: string;
  description?: string;
  baseUrl?: string;
  listingType?: string;
  authType?: string;
  docsUrl?: string;
  healthCheckUrl?: string;
  suggestedCategorySlug?: string;
  endpoints: Array<{ method: string; path: string; summary?: string }>;
  sampleRequest?: unknown;
  sampleResponse?: unknown;
  warnings: string[];
}

export interface Listing {
  id: string;
  slug: string;
  name: string;
  floorPriceUsdc: number;
  status: string;
  totalCalls: number;
  totalRevenueUsdc: number;
}

function getConfig() {
  const token = process.env.NEXUSX_API_TOKEN;
  const baseUrl = process.env.NEXUSX_API_URL ?? "https://nexusx.dev";
  return { token, baseUrl };
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const { token, baseUrl } = getConfig();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`NexusX API error ${res.status}: ${text}`);
  }

  return res.json() as Promise<T>;
}

/** POST /api/provider/detect — auto-detect fields from a spec URL */
export async function detectSpec(url: string): Promise<DetectResult> {
  return request<DetectResult>("/api/provider/detect", {
    method: "POST",
    body: JSON.stringify({ url }),
  });
}

/** POST /api/provider/listings — create a new listing */
export async function createListing(opts: DeployOptions): Promise<DeployResult> {
  return request<DeployResult>("/api/provider/listings", {
    method: "POST",
    body: JSON.stringify({
      name: opts.name,
      description: opts.description,
      baseUrl: opts.baseUrl,
      listingType: opts.listingType,
      authType: opts.authType,
      floorPriceUsdc: opts.floorPriceUsdc,
      ceilingPriceUsdc: opts.ceilingPriceUsdc,
      categorySlug: opts.categorySlug,
      docsUrl: opts.docsUrl,
      healthCheckUrl: opts.healthCheckUrl,
      sampleRequest: opts.sampleRequest,
      sampleResponse: opts.sampleResponse,
    }),
  });
}

/** PATCH /api/provider/profile — set payout address */
export async function updatePayoutAddress(address: string): Promise<void> {
  await request("/api/provider/profile", {
    method: "PATCH",
    body: JSON.stringify({ payoutAddress: address }),
  });
}

/** GET /api/provider/listings — list provider's listings */
export async function getListings(): Promise<Listing[]> {
  return request<Listing[]>("/api/provider/listings");
}
