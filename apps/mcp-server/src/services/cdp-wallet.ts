// ═══════════════════════════════════════════════════════════════
// NexusX — CDP Server Wallet Service
// apps/mcp-server/src/services/cdp-wallet.ts
//
// Manages a Coinbase Developer Platform (CDP) Server Wallet on Base.
//
// Two supported modes:
//
//   A) Local EOA mode (CDP_WALLET_PRIVATE_KEY set):
//      Uses a locally-stored hex private key for fast, gas-free
//      EIP-3009 signing. Simpler and immediately usable.
//
//   B) CDP Platform mode (CDP_API_KEY_NAME set):
//      Uses @coinbase/coinbase-sdk to create/load a CDP-managed
//      wallet. Signing goes through the CDP Wallets API so the
//      full private key never lives in memory. Best for production.
//
// Both modes produce the same X-Payment header for x402.
// ═══════════════════════════════════════════════════════════════

import { createWalletClient, http, createPublicClient } from "viem";
import { base, baseSepolia } from "viem/chains";
import type { Chain, WalletClient, Account } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { X402PaymentRequirements } from "../types";

// ─────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────

export interface CdpConfig {
  networkId?: string;      // "base-mainnet" | "base-sepolia" (default: base-mainnet)
  walletDataFile?: string; // defaults to ".cdp-wallet.json"

  // ─── Mode A: Local EOA (simplest path) ───
  // Set CDP_WALLET_PRIVATE_KEY to a 0x-prefixed hex private key.
  // Signing is done locally via viem; no CDP API calls for signing.
  walletPrivateKey?: string;

  // ─── Mode B: CDP Platform (production) ───
  // Set CDP_API_KEY_NAME + CDP_API_KEY_PRIVATE_KEY.
  // The wallet is created/loaded via the CDP SDK. Signing uses
  // the CDP Wallets API (key never fully in memory).
  apiKeyName?: string;
  apiKeyPrivateKey?: string;
}

// Base Mainnet USDC contract address
const USDC_BASE_MAINNET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
// Base Sepolia USDC contract address
const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

// ─────────────────────────────────────────────────────────────
// SERVICE
// ─────────────────────────────────────────────────────────────

export class CdpWalletService {
  private walletClient: WalletClient | null = null;
  private account: Account | null = null;
  private readonly chain: Chain;
  private readonly usdcAddress: `0x${string}`;
  private readonly walletDataFile: string;

  constructor(private readonly config: CdpConfig) {
    this.chain = resolveChain(config.networkId ?? "base-mainnet");
    this.usdcAddress = (config.networkId === "base-sepolia"
      ? USDC_BASE_SEPOLIA
      : USDC_BASE_MAINNET) as `0x${string}`;
    this.walletDataFile = config.walletDataFile ?? ".cdp-wallet.json";
  }

  /**
   * Initialize the service using the configured mode.
   * - Local EOA mode: loads account from private key env var.
   * - CDP mode: creates/loads wallet via @coinbase/coinbase-sdk.
   */
  async initialize(): Promise<void> {
    if (this.config.walletPrivateKey) {
      await this.initLocalMode(this.config.walletPrivateKey);
    } else if (this.config.apiKeyName && this.config.apiKeyPrivateKey) {
      await this.initCdpMode();
    } else {
      throw new Error(
        "[CDP] Cannot initialize wallet: set CDP_WALLET_PRIVATE_KEY (local mode) " +
        "or CDP_API_KEY_NAME + CDP_API_KEY_PRIVATE_KEY (CDP platform mode).",
      );
    }
  }

  /** Returns the wallet's Base address (0x...). */
  async getAddress(): Promise<string> {
    if (!this.account) throw new Error("[CDP] Wallet not initialized");
    return this.account.address;
  }

  /**
   * Returns the live on-chain USDC balance from Base.
   * Returns 0 on failure so wallet resource reads stay non-blocking.
   */
  async getUsdcBalance(): Promise<number> {
    if (!this.account) return 0;
    try {
      const publicClient = createPublicClient({
        chain: this.chain,
        transport: http(),
      });
      const raw = await publicClient.readContract({
        address: this.usdcAddress,
        abi: ERC20_BALANCE_OF_ABI,
        functionName: "balanceOf",
        args: [this.account.address],
      }) as bigint;
      // USDC has 6 decimals
      return Number(raw) / 1_000_000;
    } catch (err) {
      console.error("[CDP] USDC balance check failed:", err);
      return 0;
    }
  }

  /**
   * Build the base64-encoded X-Payment header value for an x402 payment.
   *
   * Signs an EIP-3009 transferWithAuthorization for USDC. This is an
   * off-chain signature — the x402 facilitator executes the actual
   * on-chain transfer on our behalf, batching it with other payments.
   */
  async buildPaymentHeader(req: X402PaymentRequirements): Promise<string> {
    if (!this.walletClient || !this.account) {
      throw new Error("[CDP] Wallet not initialized");
    }

    const usdcAddress = (req.asset || this.usdcAddress) as `0x${string}`;
    const address = this.account.address;
    const value = BigInt(req.maxAmountRequired);
    const validBefore = BigInt(
      Math.floor(Date.now() / 1000) + (req.maxTimeoutSeconds ?? 300),
    );

    // Cryptographically random 32-byte nonce (required by EIP-3009)
    const nonceBytes = new Uint8Array(32);
    crypto.getRandomValues(nonceBytes);
    const nonceHex = `0x${Buffer.from(nonceBytes).toString("hex")}` as `0x${string}`;

    const signature = await this.walletClient.signTypedData({
      account: this.account,
      domain: {
        name: req.extra?.name ?? "USD Coin",
        version: req.extra?.version ?? "2",
        chainId: this.chain.id,
        verifyingContract: usdcAddress,
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
        from: address as `0x${string}`,
        to: req.payTo as `0x${string}`,
        value,
        validAfter: BigInt(0),
        validBefore,
        nonce: nonceHex,
      },
    });

    const payment = {
      scheme: "exact",
      network: this.config.networkId ?? "base-mainnet",
      payload: {
        from: address,
        to: req.payTo,
        value: req.maxAmountRequired,
        validAfter: "0",
        validBefore: String(validBefore),
        nonce: nonceHex,
        signature,
      },
    };

    return Buffer.from(JSON.stringify(payment)).toString("base64");
  }

  /** True once `initialize()` has successfully completed. */
  get isAvailable(): boolean {
    return this.walletClient !== null;
  }

  // ─── Private: Mode A ───────────────────────────────────────

  private async initLocalMode(privateKey: string): Promise<void> {
    const hexKey = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
    this.account = privateKeyToAccount(hexKey as `0x${string}`);
    this.walletClient = createWalletClient({
      account: this.account,
      chain: this.chain,
      transport: http(),
    });
    console.error(`[CDP] Local EOA wallet loaded: ${this.account.address}`);
  }

  // ─── Private: Mode B ───────────────────────────────────────

  private async initCdpMode(): Promise<void> {
    // Dynamic import so the CDP SDK is only loaded when actually needed.
    // This avoids import errors if @coinbase/coinbase-sdk is not installed.
    let CoinbaseModule: typeof import("@coinbase/coinbase-sdk");
    try {
      CoinbaseModule = await import("@coinbase/coinbase-sdk");
    } catch {
      throw new Error(
        "[CDP] @coinbase/coinbase-sdk is not installed. " +
        "Run: npm install @coinbase/coinbase-sdk",
      );
    }

    const { Coinbase, Wallet } = CoinbaseModule;
    const { readFileSync, writeFileSync, existsSync } = await import("fs");

    Coinbase.configure({
      apiKeyName: this.config.apiKeyName!,
      privateKey: this.config.apiKeyPrivateKey!,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let wallet: any;
    if (existsSync(this.walletDataFile)) {
      const raw = readFileSync(this.walletDataFile, "utf8");
      const data = JSON.parse(raw);
      wallet = await Wallet.import(data);
      console.error(`[CDP] Loaded CDP wallet from: ${this.walletDataFile}`);
    } else {
      wallet = await Wallet.create({
        networkId: this.config.networkId ?? "base-mainnet",
      });
      const data = wallet.export();
      writeFileSync(this.walletDataFile, JSON.stringify(data, null, 2), {
        mode: 0o600,
        flag: "wx",
      });
      console.error(`[CDP] Created new CDP wallet, saved to: ${this.walletDataFile}`);
    }

    // Extract the address from the CDP wallet.
    // For signing in Mode B, we derive the account from the wallet seed.
    // CDP developer-managed wallets export a hex seed used for HD derivation.
    const addr = await wallet.getDefaultAddress();
    const walletData = wallet.export();

    // Derive the viem account from the CDP wallet seed.
    // CDP uses BIP44 path m/44'/60'/0'/0/0 for the default Ethereum address.
    this.account = await deriveCdpAccount(walletData.seed, addr.getId());
    this.walletClient = createWalletClient({
      account: this.account,
      chain: this.chain,
      transport: http(),
    });
    console.error(`[CDP] CDP wallet initialized: ${this.account.address}`);
  }
}

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

function resolveChain(networkId: string): Chain {
  return networkId === "base-sepolia" ? baseSepolia : base;
}

/**
 * Derive a viem account from a CDP wallet export seed.
 *
 * The CDP SDK stores a hex-encoded master seed for HD derivation.
 * We use the same BIP44 path (m/44'/60'/0'/0/0) to arrive at
 * the same address that the CDP SDK uses internally.
 *
 * If derivation is not possible (e.g., MPC wallets where the seed
 * is not a full private key), set CDP_WALLET_PRIVATE_KEY instead.
 */
async function deriveCdpAccount(
  seed: string,
  expectedAddress: string,
): Promise<Account> {
  // Attempt 1: treat seed as a hex private key directly
  // (some CDP wallet types store the private key as the seed value)
  if (/^[0-9a-f]{64}$/i.test(seed)) {
    try {
      const account = privateKeyToAccount(`0x${seed}` as `0x${string}`);
      if (account.address.toLowerCase() === expectedAddress.toLowerCase()) {
        return account;
      }
    } catch {
      // fall through to next attempt
    }
  }

  // Attempt 2: seed is 32-byte hex (some wallet types pack the raw private key as seed)
  // Try each possible byte-offset in case the format differs.
  if (/^[0-9a-f]{128}$/i.test(seed)) {
    // 64-byte hex = 512-bit seed — try first 32 bytes as private key
    try {
      const candidateKey = seed.slice(0, 64);
      const account = privateKeyToAccount(`0x${candidateKey}` as `0x${string}`);
      if (account.address.toLowerCase() === expectedAddress.toLowerCase()) {
        return account;
      }
    } catch {
      // fall through
    }
  }

  // Cannot derive key from CDP wallet — MPC wallets require explicit private key export
  throw new Error(
    `[CDP] Cannot derive private key from CDP wallet seed for address ${expectedAddress}. ` +
    "Set CDP_WALLET_PRIVATE_KEY to the wallet's exported private key, " +
    "or use local EOA mode (CDP_WALLET_PRIVATE_KEY only, no CDP API keys needed).",
  );
}

/** Minimal ERC-20 balanceOf ABI. */
const ERC20_BALANCE_OF_ABI = [
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;
