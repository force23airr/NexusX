import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { getPlatformObservabilitySnapshot } from "@nexusx/database";

function parseWindowHours(value: string | null): number {
  const parsed = Number.parseInt(value || "24", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 24;
  return Math.min(parsed, 24 * 30);
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  if (!user.roles.includes("ADMIN")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const windowHours = parseWindowHours(searchParams.get("windowHours"));
  const snapshot = await getPlatformObservabilitySnapshot(prisma, { windowHours });

  return NextResponse.json(snapshot);
}
