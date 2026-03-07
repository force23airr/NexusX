import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    { error: "Authentication endpoint is not configured in this deployment." },
    { status: 501 },
  );
}
