import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";


export async function GET() {
  const categories = await prisma.category.findMany({
    where: { isActive: true },
    orderBy: [{ depth: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      slug: true,
      name: true,
      depth: true,
    },
  });

  return NextResponse.json(categories);
}
