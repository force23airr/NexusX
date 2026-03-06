import { lookup } from "dns/promises";
import { BlockList, isIP } from "net";

const blockList = new BlockList();

blockList.addSubnet("0.0.0.0", 8, "ipv4");
blockList.addSubnet("10.0.0.0", 8, "ipv4");
blockList.addSubnet("100.64.0.0", 10, "ipv4");
blockList.addSubnet("127.0.0.0", 8, "ipv4");
blockList.addSubnet("169.254.0.0", 16, "ipv4");
blockList.addSubnet("172.16.0.0", 12, "ipv4");
blockList.addSubnet("192.0.0.0", 24, "ipv4");
blockList.addSubnet("192.0.2.0", 24, "ipv4");
blockList.addSubnet("192.168.0.0", 16, "ipv4");
blockList.addSubnet("198.18.0.0", 15, "ipv4");
blockList.addSubnet("198.51.100.0", 24, "ipv4");
blockList.addSubnet("203.0.113.0", 24, "ipv4");
blockList.addSubnet("224.0.0.0", 4, "ipv4");

blockList.addSubnet("::", 128, "ipv6");
blockList.addSubnet("::1", 128, "ipv6");
blockList.addSubnet("fc00::", 7, "ipv6");
blockList.addSubnet("fe80::", 10, "ipv6");
blockList.addSubnet("ff00::", 8, "ipv6");
blockList.addSubnet("2001:db8::", 32, "ipv6");

const HOSTNAME_BLOCKLIST = [
  /^localhost$/i,
  /\.localhost$/i,
  /\.local$/i,
  /^metadata\.google\.internal$/i,
  /^metadata$/i,
];

function isBlockedIp(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    return blockList.check(address, "ipv4");
  }
  if (family === 6) {
    return blockList.check(address, "ipv6");
  }
  return false;
}

export function isPrivateHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  if (!normalized) return true;
  if (HOSTNAME_BLOCKLIST.some((pattern) => pattern.test(normalized))) {
    return true;
  }
  return isBlockedIp(normalized);
}

async function resolvePublicAddresses(hostname: string): Promise<void> {
  const records = await lookup(hostname, { all: true, verbatim: true });
  if (records.length === 0) {
    throw new Error("Host did not resolve to a public address");
  }

  for (const record of records) {
    if (isBlockedIp(record.address)) {
      throw new Error(`Host resolves to a private or reserved address (${record.address})`);
    }
  }
}

export async function assertSafeHttpUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Invalid URL");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only HTTP and HTTPS URLs are allowed");
  }

  if (parsed.username || parsed.password) {
    throw new Error("Embedded URL credentials are not allowed");
  }

  if (isPrivateHost(parsed.hostname)) {
    throw new Error("URL cannot point to private or reserved hosts");
  }

  await resolvePublicAddresses(parsed.hostname);
  return parsed;
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function normalizeRedirectInit(init: RequestInit, status: number): RequestInit {
  const method = (init.method ?? "GET").toUpperCase();
  if (status === 303 || ((status === 301 || status === 302) && method !== "GET" && method !== "HEAD")) {
    return {
      ...init,
      method: "GET",
      body: undefined,
    };
  }
  return init;
}

export async function safeFetch(
  rawUrl: string,
  init: RequestInit = {},
  options: { maxRedirects?: number } = {},
): Promise<Response> {
  let currentUrl = (await assertSafeHttpUrl(rawUrl)).toString();
  let currentInit = { ...init };
  let redirectsRemaining = options.maxRedirects ?? 3;

  while (true) {
    const response = await fetch(currentUrl, {
      ...currentInit,
      redirect: "manual",
    });

    if (!isRedirect(response.status)) {
      return response;
    }

    if (redirectsRemaining <= 0) {
      throw new Error("Too many redirects");
    }

    const location = response.headers.get("location");
    if (!location) {
      throw new Error("Redirect response missing location header");
    }

    currentUrl = (await assertSafeHttpUrl(new URL(location, currentUrl).toString())).toString();
    currentInit = normalizeRedirectInit(currentInit, response.status);
    redirectsRemaining -= 1;
  }
}
