import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { randomBytes, createHash } from "crypto";


export async function GET() {
  // Demo: fetch first buyer user
  const buyer = await prisma.user.findFirst({
    where: { roles: { has: "BUYER" } },
  });
  if (!buyer) {
    return NextResponse.json({ error: "No buyer found" }, { status: 404 });
  }

  const keys = await prisma.apiKey.findMany({
    where: { userId: buyer.id },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(
    keys.map((k) => ({
      id: k.id,
      name: k.name,
      keyPrefix: k.keyPrefix,
      status: k.status,
      rateLimitRpm: k.rateLimitRpm,
      lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
      expiresAt: k.expiresAt?.toISOString() ?? null,
      createdAt: k.createdAt.toISOString(),
      revokedAt: k.revokedAt?.toISOString() ?? null,
    }))
  );
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, rateLimitRpm } = body;

  if (!name || typeof name !== "string") {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const buyer = await prisma.user.findFirst({
    where: { roles: { has: "BUYER" } },
  });
  if (!buyer) {
    return NextResponse.json({ error: "No buyer found" }, { status: 404 });
  }

  // Generate a random API key
  const rawKey = `nxs_${randomBytes(32).toString("hex")}`;
  const keyHash = createHash("sha256").update(rawKey).digest("hex");
  const keyPrefix = rawKey.slice(0, 8);

  const apiKey = await prisma.apiKey.create({
    data: {
      userId: buyer.id,
      name,
      keyHash,
      keyPrefix,
      rateLimitRpm: rateLimitRpm ?? 60,
    },
  });

  return NextResponse.json({ id: apiKey.id, rawKey }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const keyId = searchParams.get("id");

  if (!keyId) {
    return NextResponse.json({ error: "Key ID is required" }, { status: 400 });
  }

  await prisma.apiKey.update({
    where: { id: keyId },
    data: { status: "REVOKED", revokedAt: new Date() },
  });

  return NextResponse.json({ success: true });
}
