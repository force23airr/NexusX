// ═══════════════════════════════════════════════════════════════
// NexusX — CDP Server Wallet Service (v2)
// apps/mcp-server/src/services/cdp-wallet.ts
//
// Manages a Coinbase Developer Platform (CDP) Server Wallet on Base
// using the v2 SDK (@coinbase/cdp-sdk).
//
// Two supported modes:
//
//   A) Local EOA mode (CDP_WALLET_PRIVATE_KEY set):
//      Uses a locally-stored hex private key for fast, gas-free
//      EIP-3009 signing via viem. Simpler and immediately usable.
//
//   B) CDP Platform mode (CDP_API_KEY_NAME + CDP_WALLET_SECRET):
//      Uses @coinbase/cdp-sdk v2 CdpClient to create/load an
//      EVM account. Signing goes through the CDP Wallets API.
//      Best for production.
//
// Both modes produce the same X-Payment header for x402.
// ═══════════════════════════════════════════════════════════════

import { createWalletClient, http, createPublicClient } from "viem";
import { base, baseSepolia } from "viem/chains";
import type { Chain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createPrivateKey } from "crypto";
import type { X402PaymentRequirements } from "../types";

// ─────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────

export interface CdpConfig {
  networkId?: string;      // "base-mainnet" | "base-sepolia" (default: base-mainnet)
  walletDataFile?: string; // defaults to ".cdp-wallet.json" — stores CDP account address for reuse

  // ─── Mode A: Local EOA (simplest path) ───
  walletPrivateKey?: string;

  // ─── Mode B: CDP Platform v2 (production) ───
  apiKeyName?: string;
  apiKeyPrivateKey?: string;
  walletSecret?: string;
}

// Base Mainnet USDC contract address
const USDC_BASE_MAINNET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
// Base Sepolia USDC contract address
const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

// ─────────────────────────────────────────────────────────────
// SERVICE
// ─────────────────────────────────────────────────────────────

export class CdpWalletService {
  private address: string | null = null;
  private mode: "local" | "cdp" | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private cdpAccount: any = null; // CDP v2 account object (has signTypedData)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private localWalletClient: any = null; // viem WalletClient for local mode
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

  async initialize(): Promise<void> {
    if (this.config.walletPrivateKey) {
      await this.initLocalMode(this.config.walletPrivateKey);
    } else if (this.config.apiKeyName && this.config.apiKeyPrivateKey) {
      await this.initCdpMode();
    } else {
      throw new Error(
        "[CDP] Cannot initialize wallet: set CDP_WALLET_PRIVATE_KEY (local mode) " +
        "or CDP_API_KEY_NAME + CDP_API_KEY_PRIVATE_KEY + CDP_WALLET_SECRET (CDP platform mode).",
      );
    }
  }

  async getAddress(): Promise<string> {
    if (!this.address) throw new Error("[CDP] Wallet not initialized");
    return this.address;
  }

  async getUsdcBalance(): Promise<number> {
    if (!this.address) return 0;
    try {
      const publicClient = createPublicClient({
        chain: this.chain,
        transport: http(),
      });
      const raw = await publicClient.readContract({
        address: this.usdcAddress,
        abi: ERC20_BALANCE_OF_ABI,
        functionName: "balanceOf",
        args: [this.address as `0x${string}`],
      }) as bigint;
      return Number(raw) / 1_000_000;
    } catch (err) {
      console.error("[CDP] USDC balance check failed:", err);
      return 0;
    }
  }

  async buildPaymentHeader(req: X402PaymentRequirements): Promise<string> {
    if (!this.address) throw new Error("[CDP] Wallet not initialized");

    const usdcAddr = (req.asset || this.usdcAddress) as `0x${string}`;
    const value = BigInt(req.maxAmountRequired);
    const validBefore = BigInt(
      Math.floor(Date.now() / 1000) + (req.maxTimeoutSeconds ?? 300),
    );

    const nonceBytes = new Uint8Array(32);
    crypto.getRandomValues(nonceBytes);
    const nonceHex = `0x${Buffer.from(nonceBytes).toString("hex")}` as `0x${string}`;

    const typedData = {
      domain: {
        name: req.extra?.name ?? "USD Coin",
        version: req.extra?.version ?? "2",
        chainId: this.chain.id,
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
      primaryType: "TransferWithAuthorization" as const,
      message: {
        from: this.address as `0x${string}`,
        to: req.payTo as `0x${string}`,
        value,
        validAfter: BigInt(0),
        validBefore,
        nonce: nonceHex,
      },
    };

    let signature: string;
    if (this.mode === "local") {
      signature = await this.localWalletClient.signTypedData(typedData);
    } else {
      signature = await this.cdpAccount.signTypedData(typedData);
    }

    const payment = {
      scheme: "exact",
      network: this.config.networkId ?? "base-mainnet",
      payload: {
        from: this.address,
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

  get isAvailable(): boolean {
    return this.address !== null;
  }

  // ─── Private: Mode A (Local EOA) ─────────────────────────

  private async initLocalMode(privateKey: string): Promise<void> {
    const hexKey = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
    const account = privateKeyToAccount(hexKey as `0x${string}`);
    this.address = account.address;
    this.localWalletClient = createWalletClient({
      account,
      chain: this.chain,
      transport: http(),
    });
    this.mode = "local";
    console.error(`[CDP] Local EOA wallet loaded: ${this.address}`);
  }

  // ─── Private: Mode B (CDP Platform v2) ───────────────────

  private async initCdpMode(): Promise<void> {
    const { readFileSync, writeFileSync, existsSync } = await import("fs");

    // Dynamic import — only loaded when CDP mode is used
    let CdpClientClass: typeof import("@coinbase/cdp-sdk").CdpClient;
    try {
      const mod = await import("@coinbase/cdp-sdk");
      CdpClientClass = mod.CdpClient;
    } catch {
      throw new Error(
        "[CDP] @coinbase/cdp-sdk is not installed. Run: npm install @coinbase/cdp-sdk",
      );
    }

    // Convert SEC1 PEM to PKCS#8 (the v2 SDK requires PKCS#8)
    const rawPem = this.config.apiKeyPrivateKey!.replace(/\\n/g, "\n");
    const ecKey = createPrivateKey(rawPem);
    const pkcs8Pem = ecKey.export({ type: "pkcs8", format: "pem" }) as string;

    const cdp = new CdpClientClass({
      apiKeyId: this.config.apiKeyName!,
      apiKeySecret: pkcs8Pem,
      walletSecret: this.config.walletSecret,
    });

    // Try to reuse an existing account from the wallet data file
    if (existsSync(this.walletDataFile)) {
      const raw = readFileSync(this.walletDataFile, "utf8");
      const data = JSON.parse(raw);
      if (data.address) {
        this.address = data.address;
        // Retrieve the existing account from CDP
        this.cdpAccount = await cdp.evm.getOrCreateAccount({ name: data.name });
        this.mode = "cdp";
        console.error(`[CDP] Loaded existing CDP account: ${this.address}`);
        return;
      }
    }

    // Create a new EVM account
    const accountName = `nexusx-agent-${Date.now()}`;
    this.cdpAccount = await cdp.evm.createAccount({ name: accountName });
    this.address = this.cdpAccount.address;
    this.mode = "cdp";

    // Persist account info for reuse across restarts
    writeFileSync(
      this.walletDataFile,
      JSON.stringify({ address: this.address, name: accountName }, null, 2),
      { mode: 0o600, flag: "w" },
    );

    console.error(`[CDP] Created new CDP account: ${this.address}`);
    console.error(`[CDP] Fund with USDC on Base Sepolia to enable payments.`);
  }
}

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

function resolveChain(networkId: string): Chain {
  return networkId === "base-sepolia" ? baseSepolia : base;
}

const ERC20_BALANCE_OF_ABI = [
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;
