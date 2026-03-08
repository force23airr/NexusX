import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdminUser } from "@/lib/auth";
import { getServerRedis } from "@/lib/serverRedis";
import {
  ABUSE_BLOCK_STATE_HASH_KEY,
  getAbuseBlockRedisKey,
  getAbuseCounterRedisKey,
  getAbuseHashField,
  parseAbuseBlockState,
} from "@nexusx/database";

type AbuseScope = "auth" | "payment";

function parseScope(value: unknown): AbuseScope | null {
  return value === "auth" || value === "payment" ? value : null;
}

function extractIpAddress(req: NextRequest): string | null {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || null;
  }

  return req.headers.get("x-real-ip");
}

export async function POST(req: NextRequest) {
  const admin = await requireAdminUser().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Authentication required";
    return NextResponse.json(
      { error: message },
      { status: message === "Authentication required" ? 401 : 403 },
    );
  });

  if (admin instanceof NextResponse) {
    return admin;
  }

  const body = await req.json().catch(() => ({}));
  const parsedBody =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const scope = parseScope(parsedBody.scope);
  const rawSubjectKey = parsedBody.subjectKey;
  const subjectKey = typeof rawSubjectKey === "string" ? rawSubjectKey.trim() : "";

  if (!scope || !subjectKey) {
    return NextResponse.json(
      { error: "scope and subjectKey are required." },
      { status: 400 },
    );
  }

  const redis = await getServerRedis();
  if (!redis) {
    return NextResponse.json(
      { error: "Redis is required for abuse control." },
      { status: 503 },
    );
  }

  const rawReason = parsedBody.reason;
  const reason = typeof rawReason === "string" ? rawReason.trim().slice(0, 200) : null;

  const field = getAbuseHashField(scope, subjectKey);
  const blockKey = getAbuseBlockRedisKey(scope, subjectKey);
  const counterKey = getAbuseCounterRedisKey(scope, subjectKey);
  const previousState = await redis.hget(ABUSE_BLOCK_STATE_HASH_KEY, field);
  const parsedPreviousState = parseAbuseBlockState(previousState);

  await Promise.all([
    redis.hdel(ABUSE_BLOCK_STATE_HASH_KEY, field),
    redis.del(blockKey, counterKey),
  ]);

  await prisma.auditLog.create({
    data: {
      actorId: admin.id,
      action: "UPDATE",
      entityType: "abuse_block",
      entityId: field,
      before: parsedPreviousState
        ? ({ ...parsedPreviousState } as unknown as Prisma.InputJsonValue)
        : Prisma.JsonNull,
      after: ({
        action: "unblock",
        scope,
        subjectKey,
        reason,
      } as unknown as Prisma.InputJsonValue),
      ipAddress: extractIpAddress(req),
      userAgent: req.headers.get("user-agent"),
    },
  });

  return NextResponse.json({
    ok: true,
    scope,
    subjectKey,
    cleared: true,
  });
}
