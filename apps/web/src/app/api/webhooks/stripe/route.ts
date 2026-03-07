import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "Stripe webhooks are not configured in this deployment." },
    { status: 501 },
  );
}
