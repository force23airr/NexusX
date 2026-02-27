import { NextRequest, NextResponse } from "next/server";
import { Webhook } from "svix";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;

  if (!WEBHOOK_SECRET) {
    console.error("[Clerk Webhook] CLERK_WEBHOOK_SECRET is not set");
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  // Verify the webhook signature
  const svixId = req.headers.get("svix-id");
  const svixTimestamp = req.headers.get("svix-timestamp");
  const svixSignature = req.headers.get("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json({ error: "Missing svix headers" }, { status: 400 });
  }

  const body = await req.text();

  const wh = new Webhook(WEBHOOK_SECRET);
  let event: { type: string; data: Record<string, unknown> };

  try {
    event = wh.verify(body, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as { type: string; data: Record<string, unknown> };
  } catch (err) {
    console.error("[Clerk Webhook] Verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const { type, data } = event;

  if (type === "user.created" || type === "user.updated") {
    const clerkId = data.id as string;
    const emailAddresses = data.email_addresses as Array<{
      email_address: string;
    }>;
    const email = emailAddresses?.[0]?.email_address ?? `${clerkId}@nexusx.dev`;
    const firstName = (data.first_name as string) || "";
    const lastName = (data.last_name as string) || "";
    const displayName =
      [firstName, lastName].filter(Boolean).join(" ") || email.split("@")[0];
    const avatarUrl = (data.image_url as string) || null;

    await prisma.user.upsert({
      where: { externalId: clerkId },
      update: {
        email,
        displayName,
        avatarUrl,
      },
      create: {
        externalId: clerkId,
        email,
        displayName,
        avatarUrl,
        roles: ["BUYER"],
        wallet: {
          create: {
            address: `pending_${clerkId}`,
            balanceUsdc: 0,
            chainId: 8453,
          },
        },
      },
    });
  }

  if (type === "user.deleted") {
    const clerkId = data.id as string;
    if (clerkId) {
      await prisma.user.updateMany({
        where: { externalId: clerkId },
        data: { isActive: false },
      });
    }
  }

  return NextResponse.json({ received: true });
}
