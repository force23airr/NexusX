import type {
  HealthMetricReport,
  NodeMeteringMiddlewareOptions,
  UsageMeteredEvent,
  UsageMeterOptions,
  UsageMeterSnapshot,
} from "./types";

type HeaderReader = {
  getHeader?: (name: string) => number | string | string[] | undefined;
  headers?: Record<string, string | string[] | undefined>;
};

type FinishEmitter = {
  on?: (event: "finish", listener: () => void) => unknown;
  once?: (event: "finish", listener: () => void) => unknown;
  statusCode?: number;
};

export class UsageMeter {
  private readonly listingIdOrSlug: string;
  private readonly successStatusMax: number;
  private readonly now: () => Date;
  private readonly events: UsageMeteredEvent[] = [];
  private periodStart: Date;

  constructor(options: UsageMeterOptions) {
    if (!options.listingIdOrSlug.trim()) {
      throw new Error("UsageMeter requires listingIdOrSlug.");
    }

    this.listingIdOrSlug = options.listingIdOrSlug;
    this.successStatusMax = options.successStatusMax ?? 499;
    this.now = options.now ?? (() => new Date());
    this.periodStart = this.now();
  }

  record(event: Omit<UsageMeteredEvent, "listingIdOrSlug" | "timestamp"> & {
    timestamp?: string;
    listingIdOrSlug?: string;
  }): void {
    this.events.push({
      listingIdOrSlug: event.listingIdOrSlug ?? this.listingIdOrSlug,
      operationId: event.operationId ?? null,
      statusCode: event.statusCode,
      latencyMs: Math.max(0, Math.round(event.latencyMs)),
      requestBytes: Math.max(0, Math.round(event.requestBytes)),
      responseBytes: Math.max(0, Math.round(event.responseBytes)),
      timestamp: event.timestamp ?? this.now().toISOString(),
    });
  }

  snapshot(reset = false): UsageMeterSnapshot {
    const periodEnd = this.now();
    const latencies = this.events
      .map((event) => event.latencyMs)
      .sort((a, b) => a - b);
    const successCount = this.events.filter(
      (event) => event.statusCode <= this.successStatusMax,
    ).length;
    const failureCount = this.events.length - successCount;
    const requestBytes = this.events.reduce((sum, event) => sum + event.requestBytes, 0);
    const responseBytes = this.events.reduce((sum, event) => sum + event.responseBytes, 0);

    const snapshot: UsageMeterSnapshot = {
      listingIdOrSlug: this.listingIdOrSlug,
      successCount,
      failureCount,
      medianLatencyMs: percentile(latencies, 0.5),
      p99LatencyMs: percentile(latencies, 0.99),
      requestBytes,
      responseBytes,
      totalBytes: requestBytes + responseBytes,
      periodStart: this.periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
    };

    if (reset) {
      this.events.length = 0;
      this.periodStart = periodEnd;
    }

    return snapshot;
  }

  toHealthMetricReport(reset = false): HealthMetricReport {
    const snapshot = this.snapshot(reset);
    const periodMs =
      new Date(snapshot.periodEnd).getTime() - new Date(snapshot.periodStart).getTime();
    const totalMinutes = Math.max(1, Math.ceil(periodMs / 60_000));

    return {
      listingIdOrSlug: snapshot.listingIdOrSlug,
      successCount: snapshot.successCount,
      failureCount: snapshot.failureCount,
      medianLatencyMs: snapshot.medianLatencyMs,
      p99LatencyMs: snapshot.p99LatencyMs,
      uptimeMinutes: snapshot.successCount > 0 ? totalMinutes : 0,
      totalMinutes,
      periodStart: snapshot.periodStart,
      periodEnd: snapshot.periodEnd,
    };
  }
}

export function createNodeMeteringMiddleware(
  meter: UsageMeter,
  options: NodeMeteringMiddlewareOptions,
): (req: unknown, res: unknown, next: () => void) => void {
  return (req: unknown, res: unknown, next: () => void): void => {
    const startedAt = Date.now();
    const response = res as FinishEmitter;
    const onFinish = () => {
      meter.record({
        operationId: resolveOperationId(req, options),
        statusCode: typeof response.statusCode === "number" ? response.statusCode : 200,
        latencyMs: Date.now() - startedAt,
        requestBytes: options.requestBytes?.(req) ?? readContentLength(req),
        responseBytes: options.responseBytes?.(res) ?? readContentLength(res),
      });
    };

    if (typeof response.once === "function") {
      response.once("finish", onFinish);
    } else if (typeof response.on === "function") {
      response.on("finish", onFinish);
    }

    next();
  };
}

function resolveOperationId(
  req: unknown,
  options: NodeMeteringMiddlewareOptions,
): string | undefined {
  if (typeof options.operationId === "function") {
    return options.operationId(req);
  }
  return options.operationId;
}

function readContentLength(value: unknown): number {
  const source = value as HeaderReader;
  const raw =
    source.getHeader?.("content-length") ??
    source.headers?.["content-length"] ??
    source.headers?.["Content-Length"];
  const header = Array.isArray(raw) ? raw[0] : raw;
  const parsed = typeof header === "number" ? header : Number.parseInt(header ?? "0", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function percentile(sortedValues: number[], pct: number): number {
  if (sortedValues.length === 0) {
    return 0;
  }
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil(sortedValues.length * pct) - 1),
  );
  return sortedValues[index];
}
