#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# NexusX — Local Development Setup
# infrastructure/scripts/dev-setup.sh
#
# One-command local bootstrap:
#   1. Check prerequisites (node, docker, foundry)
#   2. Install dependencies
#   3. Start Postgres + Redis via Docker
#   4. Generate Prisma client
#   5. Run migrations
#   6. Seed database
#   7. Print next steps
#
# Usage: bash infrastructure/scripts/dev-setup.sh
# ═══════════════════════════════════════════════════════════════

set -euo pipefail

BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}══════════════════════════════════════════════${NC}"
echo -e "${BLUE}  NexusX — Local Development Setup${NC}"
echo -e "${BLUE}══════════════════════════════════════════════${NC}"
echo ""

# ─── Prerequisites ───
echo -e "${YELLOW}▸ Checking prerequisites...${NC}"

check_cmd() {
  if ! command -v "$1" &> /dev/null; then
    echo -e "  ${RED}✗ $1 not found. $2${NC}"
    return 1
  else
    local ver
    ver=$($3 2>/dev/null || echo "unknown")
    echo -e "  ${GREEN}✓${NC} $1 ($ver)"
    return 0
  fi
}

MISSING=0
check_cmd "node"   "Install: https://nodejs.org"             "node --version"   || MISSING=$((MISSING+1))
check_cmd "npm"    "Comes with Node.js"                       "npm --version"    || MISSING=$((MISSING+1))
check_cmd "docker" "Install: https://docs.docker.com/install" "docker --version" || MISSING=$((MISSING+1))

# Optional.
check_cmd "forge"  "(Optional) Install: https://getfoundry.sh" "forge --version" || true

if [ "$MISSING" -gt 0 ]; then
  echo ""
  echo -e "${RED}Missing $MISSING required tool(s). Install them and re-run.${NC}"
  exit 1
fi
echo ""

# ─── Environment File ───
echo -e "${YELLOW}▸ Setting up environment...${NC}"
if [ ! -f .env ]; then
  cat > .env << 'ENVFILE'
# NexusX Local Development Environment
NODE_ENV=development

# Database
DATABASE_URL=postgresql://nexusx:nexusx_local@localhost:5432/nexusx_dev

# Redis
REDIS_URL=redis://localhost:6379

# Services
GATEWAY_PORT=3100
AUCTION_PORT=3200
ROUTER_PORT=3300
WEB_PORT=3000

# Platform
PLATFORM_FEE_RATE=0.12
SANDBOX_ENABLED=true

# AI Router (optional — omit for rule-based mode)
# ANTHROPIC_API_KEY=sk-ant-...
CLASSIFIER_MODE=rule_based

# Settlement (optional — for contract deployment)
# BASE_RPC_URL=https://sepolia.base.org
# DEPLOYER_PRIVATE_KEY=0x...
ENVFILE
  echo -e "  ${GREEN}✓${NC} Created .env file"
else
  echo -e "  ${GREEN}✓${NC} .env already exists"
fi
echo ""

# ─── Install Dependencies ───
echo -e "${YELLOW}▸ Installing dependencies...${NC}"
npm install
echo -e "  ${GREEN}✓${NC} Dependencies installed"
echo ""

# ─── Start Infrastructure ───
echo -e "${YELLOW}▸ Starting Postgres + Redis...${NC}"
docker compose -f infrastructure/docker/docker-compose.yml up -d postgres redis
echo -e "  ${GREEN}✓${NC} Postgres running on :5432"
echo -e "  ${GREEN}✓${NC} Redis running on :6379"

# Wait for Postgres to be ready.
echo -n "  Waiting for Postgres..."
for i in $(seq 1 30); do
  if docker exec nexusx-postgres pg_isready -U nexusx &>/dev/null; then
    echo -e " ${GREEN}ready${NC}"
    break
  fi
  echo -n "."
  sleep 1
  if [ "$i" -eq 30 ]; then
    echo -e " ${RED}timeout${NC}"
    exit 1
  fi
done
echo ""

# ─── Database Setup ───
echo -e "${YELLOW}▸ Setting up database...${NC}"

echo "  Generating Prisma client..."
npm run generate --workspace=@nexusx/database

echo "  Running migrations..."
npx prisma migrate deploy --schema=packages/database/prisma/schema.prisma

echo "  Seeding database..."
npm run seed --workspace=@nexusx/database

echo -e "  ${GREEN}✓${NC} Database ready (11 users, 7 listings, 10 categories)"
echo ""

# ─── Summary ───
echo -e "${BLUE}══════════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✅ NexusX local environment is ready!${NC}"
echo -e "${BLUE}══════════════════════════════════════════════${NC}"
echo ""
echo "  Next steps:"
echo ""
echo "  Start all services (Docker):"
echo "    docker compose -f infrastructure/docker/docker-compose.yml up"
echo ""
echo "  Or start individually:"
echo "    npm run dev --workspace=@nexusx/gateway       # :3100"
echo "    npm run dev --workspace=@nexusx/auction-engine # :3200"
echo "    npm run dev --workspace=@nexusx/ai-router      # :3300"
echo "    npm run dev --workspace=@nexusx/web            # :3000"
echo ""
echo "  Prisma Studio (DB browser):"
echo "    npm run studio --workspace=@nexusx/database    # :5555"
echo ""
echo "  Run tests:"
echo "    npm test --workspaces"
echo ""
