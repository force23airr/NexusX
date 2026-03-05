// ═══════════════════════════════════════════════════════════════
// NexusX — Viem Wallet Signer
// packages/sdk/src/agent/signer.ts
//
// Factory that creates a WalletSigner using viem for EIP-3009
// signing. viem is an optional peer dependency — this file is
// the only place it's imported. If you don't use x402 payments,
// viem is not needed.
// ═══════════════════════════════════════════════════════════════

import type { WalletSigner, X402PaymentRequirements } from "./types";

// ─────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────

const USDC_ADDRESSES: Record<string, string> = {
  "base-mainnet": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "base-sepolia": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
};

const USDC_DOMAIN_NAMES: Record<string, string> = {
  "base-mainnet": "USD Coin",
  "base-sepolia": "USDC",
};

const CHAIN_IDS: Record<string, number> = {
  "base-mainnet": 8453,
  "base-sepolia": 84532,
};

// ─────────────────────────────────────────────────────────────
// FACTORY
// ─────────────────────────────────────────────────────────────

/**
 * Create a WalletSigner from a private key using viem.
 * Requires `viem` to be installed as a peer dependency.
 *
 * @param privateKey  Hex-encoded private key (must start with 0x).
 * @param network     "base-mainnet" or "base-sepolia". Default: "base-mainnet".
 */
export async function createViemSigner(
  privateKey: `0x${string}`,
  network: "base-mainnet" | "base-sepolia" = "base-mainnet",
): Promise<WalletSigner> {
  // Dynamic import — keeps viem optional at the package level
  let viem: typeof import("viem");
  let viemAccounts: typeof import("viem/accounts");
  let viemChains: typeof import("viem/chains");
  try {
    viem = await import("viem");
    viemAccounts = await import("viem/accounts");
    viemChains = await import("viem/chains");
  } catch {
    throw new Error(
      "createViemSigner requires 'viem' as a peer dependency. Install it: npm install viem",
    );
  }

  const chain = network === "base-mainnet" ? viemChains.base : viemChains.baseSepolia;
  const account = viemAccounts.privateKeyToAccount(privateKey);
  const walletClient = viem.createWalletClient({
    account,
    chain,
    transport: viem.http(),
  });

  const usdcAddr = USDC_ADDRESSES[network] as `0x${string}`;
  const domainName = USDC_DOMAIN_NAMES[network];
  const chainId = CHAIN_IDS[network];

  return {
    getAddress() {
      return account.address;
    },

    async buildPaymentHeader(req: X402PaymentRequirements): Promise<string> {
      const value = BigInt(req.maxAmountRequired);
      const validBefore = BigInt(Math.floor(Date.now() / 1000) + (req.maxTimeoutSeconds ?? 300));
      const nonceBytes = new Uint8Array(32);
      crypto.getRandomValues(nonceBytes);
      const nonceHex = `0x${Buffer.from(nonceBytes).toString("hex")}` as `0x${string}`;

      const signature = await walletClient.signTypedData({
        domain: {
          name: req.extra?.name ?? domainName,
          version: req.extra?.version ?? "2",
          chainId,
          verifyingContract: usdcAddr,
        },
        types: {
          TransferWithAuthorization: [
            { name: "from", type: "address" },
            { name: "to", type: "address" },
            { name: "value", type: "uint256" },
            { name: "validAfter", type: "uint256" },
            { name: "validBefore", type: "uint256" },
            { name: "nonce", type: "bytes32" },
          ],
        },
        primaryType: "TransferWithAuthorization",
        message: {
          from: account.address,
          to: req.payTo as `0x${string}`,
          value,
          validAfter: BigInt(0),
          validBefore,
          nonce: nonceHex,
        },
      });

      const payment = {
        x402Version: 1,
        scheme: "exact",
        network,
        payload: {
          signature,
          authorization: {
            from: account.address,
            to: req.payTo,
            value: req.maxAmountRequired,
            validAfter: "0",
            validBefore: String(validBefore),
            nonce: nonceHex,
          },
        },
      };

      return Buffer.from(JSON.stringify(payment)).toString("base64");
    },
  };
}
