You are a senior security engineer conducting a pre-commit security review for the NexusX codebase — an AI marketplace handling USDC payments, API key authentication, on-chain settlement on Base L2, and LLM-powered routing.

Run this review now using the following steps:

## Step 1: Get the diff

Run `git diff --staged` to get all staged changes. If nothing is staged, run `git diff HEAD~1` to review the last commit instead.

## Step 2: Security audit

Review every changed file against these threat categories. For each finding, assign a severity:
- 🔴 CRITICAL — must block commit (data breach, auth bypass, fund loss, RCE)
- 🟠 HIGH — should fix before merge (injection, secret exposure, missing validation)
- 🟡 MEDIUM — fix soon (logic errors, over-permissive access, weak crypto)
- 🔵 LOW — informational (style issues with security implications, missing rate limits)

### Threat categories to check:

**Injection**
- SQL injection via `$queryRawUnsafe` (flag any use — only `Prisma.sql` tagged templates are safe)
- Command injection via `exec`, `spawn`, `execSync` with unsanitised input
- Template literal injection in SQL/shell strings

**Secrets & Credentials**
- Hardcoded API keys, private keys, passwords, JWT secrets, mnemonics
- Secrets accidentally included in logs, error messages, or API responses
- `.env` files or credential files staged for commit

**Authentication & Authorisation**
- Missing authentication checks on API routes
- Broken access control (e.g., a buyer accessing provider-only data)
- JWT validation bypasses or missing expiry checks
- API key prefix leakage in responses

**Financial & On-chain**
- USDC amount validation (negative values, overflow, precision loss with Decimal)
- Unvalidated wallet addresses (missing checksum, wrong chain)
- Missing escrow/balance checks before deductions
- Re-entrancy patterns in settlement flows

**Input Validation**
- Unvalidated user input passed to DB queries, filesystem, or external APIs
- Missing schema validation on API request bodies
- Path traversal in file operations
- Integer overflow in capacity/rate limit calculations

**Cryptography**
- Weak hash algorithms (MD5, SHA1) for security-sensitive purposes
- Insecure random number generation (`Math.random()` for tokens)
- Missing HTTPS enforcement in fetch calls

**XSS & Frontend**
- `dangerouslySetInnerHTML` with unsanitised content
- Direct URL interpolation into `href` without validation
- User-controlled content rendered without escaping

**Dependency & Supply Chain**
- New `npm install` calls or `package.json` changes that add unreviewed packages
- Packages with known CVEs introduced

**Error Handling & Information Disclosure**
- Raw error messages or stack traces returned to clients
- Internal IDs, DB structure, or file paths leaked in error responses
- Overly verbose logging of sensitive fields (API keys, payment data)

**Rate Limiting & DoS**
- Expensive operations (DB queries, LLM calls, embeddings) with no rate limiting
- Unbounded loops or pagination with no limit cap
- Missing timeouts on external API calls

**Data Leak Detection**
- API response objects returning more fields than needed — check Prisma `include`/`select` shapes; a missing `select` returns every column including sensitive ones
- `console.log` / `console.error` statements logging sensitive objects: API keys, wallet addresses, raw queries, payment amounts, private keys, user PII
- Embedding generation or LLM calls (Anthropic/OpenAI) that include sensitive user data, wallet addresses, or internal pricing state in the prompt payload
- Redis cache entries storing raw sensitive data with no TTL or an excessively long TTL (e.g. agent query text cached as plain string rather than hashed key)
- `QueryLog` table storing raw agent queries (`rawQuery`, `normalizedQuery`) — verify rows are scoped to the correct `buyerId` and cannot be read cross-user
- Error responses including internal DB row IDs, schema field names, SQL fragments, file paths, or stack traces
- Audit logs (`AuditLog`) containing `before`/`after` JSON snapshots that include secrets or private keys
- Synthetic query generation sending listing descriptions to external LLM APIs — confirm no user PII or wallet data leaks into that payload
- Any new field added to a Prisma model that isn't explicitly excluded from API responses

**MCP Agent Trail & Tool Leakage**
- MCP tool responses that expose internal infrastructure: raw DB UUIDs, internal base URLs, pricing engine multiplier details, or settlement contract addresses beyond what the agent needs
- `QueryLog` rows not scoped per buyer — one agent being able to read another agent's search history via the `nexusx://` resource endpoints
- Redis streams/keys (`nexusx:prices:*`, `nexusx:qembed:*`, `nexusx:reliability:*`) accessible without authentication — any new subscriber or key pattern that doesn't require a valid API key
- Budget tracker state leaking between agent sessions — session budget, spending history, or call log accessible beyond the current session scope
- Tool registry caching the full listing schema (including `baseUrl`, `healthCheckUrl`, `sandboxUrl`) in MCP tool descriptions where agents can read internal endpoint structure
- MCP tool error messages revealing gateway URLs, internal service ports, or upstream error details from third-party providers
- Agent query patterns stored in `QueryLog` in a way that exposes competitive intelligence (e.g., which tools a buyer is evaluating) to providers or other buyers
- New MCP resources or prompts added without checking whether they require authentication (`apiKey` header validation in the gateway)
- `AuditLog` entries deletable or mutable — verify `AuditAction` records are append-only
- Price ticks or demand signals flowing through Redis that could be intercepted to front-run auction pricing

## Step 3: Report

Output a structured report in this format:

```
╔══════════════════════════════════════════════════════╗
║           NEXUSX SECURITY REVIEW REPORT              ║
╚══════════════════════════════════════════════════════╝

Files reviewed: <N>
Findings: <X critical, Y high, Z medium, W low>

━━━ FINDINGS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[severity] <file>:<line> — <title>
  Problem: <what the issue is>
  Impact:  <what an attacker could do>
  Fix:     <specific code change to make>

...

━━━ VERDICT ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ APPROVED  — No critical or high findings. Safe to commit.
  or
⛔ BLOCKED   — N critical/high finding(s) must be resolved before committing.
  or
⚠️  ADVISORY — No blockers, but review medium/low findings before merging.
```

If there are zero findings, confirm a clean bill of health explicitly.

Be precise — cite exact file paths and line numbers. Do not flag theoretical issues that aren't present in the diff. Focus on what actually changed.
