import type { Request } from "express";
import { inferRegionBucket } from "@nexusx/database";

const COUNTRY_HEADER_CANDIDATES = [
  "cf-ipcountry",
  "x-vercel-ip-country",
  "x-geo-country",
  "fly-client-country",
  "x-country-code",
  "x-nexusx-country",
] as const;

const ISO_COUNTRY = /^[A-Z]{2}$/;
const INVALID_COUNTRY_CODES = new Set(["XX", "T1", "A1", "A2"]);

function normalizeHeaderValue(value: string | string[] | undefined): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim().toUpperCase();
    if (!ISO_COUNTRY.test(trimmed) || INVALID_COUNTRY_CODES.has(trimmed)) {
      return null;
    }
    return trimmed;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const normalized = normalizeHeaderValue(entry);
      if (normalized) return normalized;
    }
  }

  return null;
}

export function extractClientRegion(req: Request): {
  callerCountry: string | null;
  callerRegionBucket: string | null;
} {
  for (const header of COUNTRY_HEADER_CANDIDATES) {
    const callerCountry = normalizeHeaderValue(req.headers[header]);
    if (callerCountry) {
      return {
        callerCountry,
        callerRegionBucket: inferRegionBucket(callerCountry),
      };
    }
  }

  return {
    callerCountry: null,
    callerRegionBucket: null,
  };
}
