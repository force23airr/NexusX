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
