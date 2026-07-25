#!/usr/bin/env bash
# City Ink agent — setup.
# Run:  bash setup.sh
set -euo pipefail

BOLD=$'\033[1m'; DIM=$'\033[2m'; AMBER=$'\033[33m'; RED=$'\033[31m'; OFF=$'\033[0m'

say()  { printf "%s\n" "$1"; }
step() { printf "\n%s%s%s\n" "$BOLD" "$1" "$OFF"; }
warn() { printf "%s%s%s\n" "$RED" "$1" "$OFF"; }

printf "\n%sCity Ink — Front of House setup%s\n" "$AMBER" "$OFF"

# ---------------------------------------------------------------- node check
step "Checking Node"
if ! command -v node >/dev/null 2>&1; then
  warn "Node isn't installed. Get the LTS build from https://nodejs.org and run this again."
  exit 1
fi
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 18 ]; then
  warn "Node $NODE_MAJOR is too old. You need 18 or newer."
  exit 1
fi
say "Node $(node -v) — fine."

# ---------------------------------------------------------------- install
step "Installing packages"
say "${DIM}A couple of minutes the first time.${OFF}"
npm install --no-fund --no-audit

# ---------------------------------------------------------------- env
step "Environment"
if [ -f .env ]; then
  say ".env already exists — leaving it alone."
else
  cp .env.example .env
  say "Created .env from the template."
fi

set_var() {
  local key="$1" value="$2"
  if grep -q "^${key}=" .env; then
    # portable in-place edit (works on macOS and Linux)
    sed "s|^${key}=.*|${key}=${value}|" .env > .env.tmp && mv .env.tmp .env
  else
    printf "%s=%s\n" "$key" "$value" >> .env
  fi
}

current() { grep "^$1=" .env 2>/dev/null | cut -d= -f2- || true; }

if [ -z "$(current DATABASE_URL)" ] || [ "$(current DATABASE_URL)" = "mysql://user:password@host:3306/cityink" ]; then
  say ""
  say "Paste your MySQL connection string."
  say "${DIM}Railway: open the MySQL service, Variables tab, copy MYSQL_URL.${OFF}"
  printf "DATABASE_URL: "
  read -r DB_URL
  [ -n "$DB_URL" ] && set_var DATABASE_URL "$DB_URL"
fi

if [ -z "$(current LLM_API_KEY)" ]; then
  say ""
  say "Paste your Anthropic API key."
  say "${DIM}console.anthropic.com → API keys. Starts with sk-ant-.${OFF}"
  printf "LLM_API_KEY: "
  read -r API_KEY
  [ -n "$API_KEY" ] && set_var LLM_API_KEY "$API_KEY"
fi

# ---------------------------------------------------------------- schema
step "Creating database tables"
if npm run db:push; then
  say "Tables are in."
else
  warn "Couldn't reach the database. Check DATABASE_URL in .env, then run: npm run db:push"
  exit 1
fi

# ---------------------------------------------------------------- done
step "Done"
cat <<'NEXT'

Start it with:

    npm run dev

Then open http://localhost:5173 and go to Settings.

Three things to paste in there, and only you can get them:

  1. Facebook Page credentials
     developers.facebook.com → your app → Settings → Basic (App ID, App Secret)
     → Messenger → Settings → Access Tokens (Page access token)

  2. Your Timely booking URL

  3. Studio facts — hours, deposit policy, minimum age.
     The agent answers from these and won't invent anything else.

NEXT
