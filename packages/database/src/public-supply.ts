import type {
  ListingSupplyTier,
  ListingVerificationState,
} from "@prisma/client";
import { Prisma } from "@prisma/client";

const HIDDEN_SUPPLY_TIERS: ListingSupplyTier[] = [
  "PUBLIC_UNVERIFIED",
  "PUBLIC_QUARANTINED",
];

const HIDDEN_VERIFICATION_STATES: ListingVerificationState[] = [
  "QUARANTINED",
  "RETIRED",
];

function sourceVisibilityWhere(mode: "discovery" | "execution"): Prisma.ListingWhereInput {
  const sourceControlledWhere: Prisma.ListingWhereInput = {
    OR: [
      { sourceControlled: false },
      {
        AND: [
          { sourceControlled: true },
          {
            provenance: {
              is: {
                publicSource: {
                  is: {
                    status: "ACTIVE",
                    ...(mode === "discovery"
                      ? { allowDiscovery: true }
                      : { allowExecution: true }),
                  },
                },
              },
            },
          },
        ],
      },
    ],
  };

  return sourceControlledWhere;
}

export function combineListingWhere(
  ...conditions: Array<Prisma.ListingWhereInput | undefined>
): Prisma.ListingWhereInput {
  const filtered = conditions.filter(
    (condition): condition is Prisma.ListingWhereInput =>
      condition !== undefined && Object.keys(condition).length > 0,
  );

  if (filtered.length === 0) {
    return {};
  }

  if (filtered.length === 1) {
    return filtered[0];
  }

  return { AND: filtered };
}

export function buildDiscoverableListingWhere(
  extra?: Prisma.ListingWhereInput,
): Prisma.ListingWhereInput {
  return combineListingWhere(
    { status: "ACTIVE" },
    { NOT: [{ supplyTier: { in: HIDDEN_SUPPLY_TIERS } }] },
    { NOT: [{ verificationState: { in: HIDDEN_VERIFICATION_STATES } }] },
    sourceVisibilityWhere("discovery"),
    extra,
  );
}

export function buildExecutableListingWhere(
  extra?: Prisma.ListingWhereInput,
): Prisma.ListingWhereInput {
  return combineListingWhere(
    { status: "ACTIVE" },
    { NOT: [{ supplyTier: { in: HIDDEN_SUPPLY_TIERS } }] },
    { NOT: [{ verificationState: { in: HIDDEN_VERIFICATION_STATES } }] },
    sourceVisibilityWhere("execution"),
    extra,
  );
}
