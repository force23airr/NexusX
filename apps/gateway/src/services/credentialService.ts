// ═══════════════════════════════════════════════════════════════
// NexusX — Credential Service
// apps/gateway/src/services/credentialService.ts
//
// Loads per-listing upstream provider credentials from env vars.
// Convention: PROVIDER_CRED_<SLUG_UPPER>=<headerName>:<headerValue>
//
// Example:
//   PROVIDER_CRED_TEXT_EMBEDDINGS_V3=Authorization:Bearer embed-key
//   PROVIDER_CRED_OPENAI_GPT4_TURBO=Authorization:Bearer oai-key
// ═══════════════════════════════════════════════════════════════

export interface UpstreamCredential {
  headerName: string;
  headerValue: string;
}

export class CredentialService {
  private cache = new Map<string, UpstreamCredential | null>();

  /**
   * Look up upstream credentials for a listing slug.
   * Returns null if no credential env var is set for this slug.
   */
  getCredential(slug: string): UpstreamCredential | null {
    if (this.cache.has(slug)) {
      return this.cache.get(slug)!;
    }

    const envKey = `PROVIDER_CRED_${slug.toUpperCase().replace(/-/g, "_")}`;
    const envValue = process.env[envKey];

    if (!envValue) {
      this.cache.set(slug, null);
      return null;
    }

    // Format: headerName:headerValue (split on first colon only)
    const colonIdx = envValue.indexOf(":");
    if (colonIdx === -1) {
      console.warn(`[CredentialService] Invalid format for ${envKey} — expected "headerName:headerValue"`);
      this.cache.set(slug, null);
      return null;
    }

    const credential: UpstreamCredential = {
      headerName: envValue.slice(0, colonIdx).trim(),
      headerValue: envValue.slice(colonIdx + 1).trim(),
    };

    this.cache.set(slug, credential);
    return credential;
  }
}
