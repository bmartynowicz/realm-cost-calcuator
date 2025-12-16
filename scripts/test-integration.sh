#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="backend/services/docker-compose.test.yml"
POSTGRES_URL="postgres://latitude:latitude@127.0.0.1:5433/latitude_integration"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required to run integration tests." >&2
  exit 1
fi

cleanup() {
  docker compose -f "$COMPOSE_FILE" down -v --remove-orphans >/dev/null 2>&1 || true
}

trap cleanup EXIT

docker compose -f "$COMPOSE_FILE" up -d --wait

# Wait for Postgres explicitly to make sure connections succeed.
for _ in {1..20}; do
  if docker compose -f "$COMPOSE_FILE" exec -T postgres pg_isready -U latitude -d latitude_integration >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

export AUTH_DATABASE_URL="$POSTGRES_URL"
export POSTGRES_URL="$POSTGRES_URL"

pnpm --filter @latitude/content-service test:integration
pnpm --filter @latitude/analytics-service test:integration
pnpm --filter @latitude/designer-service test:integration
pnpm --filter @latitude/linkedin-service test:integration
pnpm --filter @latitude/dev-agent-service test:integration
pnpm --filter @latitude/auth-service test:integration
