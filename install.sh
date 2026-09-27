#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
#  LibrePay Node — universal installer
#  Self-hosted, non-custodial Bitcoin payment gateway. AGPL-3.0.
#
#  Detects your server type, installs everything, builds, starts a service,
#  then hands you a one-time setup code — the rest happens in the browser.
#
#  usage:
#    curl -fsSL https://raw.githubusercontent.com/radhwendalyhamdouni/librepay-node/main/install.sh | bash
#    bash install.sh [--docker] [--port N] [--domain X] [--dir P] [--update] [--yes]
#
#  what it does NOT do: touch your keys. The wizard asks for a watch-only
#  zpub / BIP47 payment code — the node can see payments, never spend them.
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail

# ── appearance ──────────────────────────────────────────────────────────────
BOLD=$'\033[1m'; DIM=$'\033[2m'; ORANGE=$'\033[38;5;208m'; GREEN=$'\033[38;5;114m'
RED=$'\033[38;5;203m'; RESET=$'\033[0m'
say()  { printf '%s\n' "${ORANGE}▸${RESET} $*"; }
ok()   { printf '%s\n' "${GREEN}✓${RESET} $*"; }
warn() { printf '%s\n' "${RED}!${RESET} $*"; }
die()  { warn "$*"; exit 1; }

# ── flags ───────────────────────────────────────────────────────────────────
MODE="service"      # service | docker
PORT="3000"
DOMAIN=""
DIR=""
UPDATE="no"
ASSUME_YES="no"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --docker) MODE="docker"; shift ;;
    --port) PORT="$2"; shift 2 ;;
    --domain) DOMAIN="$2"; shift 2 ;;
    --dir) DIR="$2"; shift 2 ;;
    --update) UPDATE="yes"; shift ;;
    --yes|-y) ASSUME_YES="yes"; shift ;;
    *) warn "unknown flag: $1"; shift ;;
  esac
done

# ── 1. server type detection ────────────────────────────────────────────────
ARCH="$(uname -m)"
[[ "$ARCH" =~ ^(x86_64|aarch64|arm64)$ ]] || die "unsupported architecture: $ARCH"
KERNEL="$(uname -s)"
[[ "$KERNEL" == "Linux" ]] || die "this installer targets Linux servers (macOS: run manually, see docs/SELF-HOSTING.md)"

OS_ID="unknown"; OS_VER=""
if [[ -r /etc/os-release ]]; then
  OS_ID="$(. /etc/os-release && echo "${ID:-unknown}")"
  OS_VER="$(. /etc/os-release && echo "${VERSION_ID:-}")"
fi

PKG="unknown"
command -v apt-get >/dev/null 2>&1 && PKG="apt"
command -v dnf     >/dev/null 2>&1 && PKG="dnf"
command -v yum     >/dev/null 2>&1 && [[ "$PKG" == "unknown" ]] && PKG="yum"
command -v pacman  >/dev/null 2>&1 && [[ "$PKG" == "unknown" ]] && PKG="pacman"
command -v zypper  >/dev/null 2>&1 && [[ "$PKG" == "unknown" ]] && PKG="zypper"
command -v apk     >/dev/null 2>&1 && [[ "$PKG" == "unknown" ]] && PKG="apk"

SUDO="sudo"
if [[ "$(id -u)" == "0" ]]; then SUDO=""; fi
if ! command -v "$SUDO" >/dev/null 2>&1 && [[ -n "$SUDO" ]]; then SUDO=""; fi

HAS_SYSTEMD="no"; [[ -d /run/systemd/system ]] && HAS_SYSTEMD="yes"
HAS_DOCKER="no";  command -v docker >/dev/null 2>&1 && HAS_DOCKER="yes"

echo
echo "${BOLD}${ORANGE}  ⚡ LibrePay Node installer${RESET}"
echo "  ${DIM}Your payments. Your server. Your keys.${RESET}"
echo
say "server: ${OS_ID} ${OS_VER} (${ARCH}) · pkg: ${PKG} · systemd: ${HAS_SYSTEMD} · docker: ${HAS_DOCKER}"

# ── 2. node.js ≥ 20 ─────────────────────────────────────────────────────────
node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  local major; major="$(node -v | sed 's/^v//' | cut -d. -f1)"
  [[ "$major" =~ ^[0-9]+$ && "$major" -ge 20 ]]
}

install_node() {
  say "installing Node.js 20…"
  case "$PKG" in
    apt)
      $SUDO apt-get update -y
      $SUDO apt-get install -y curl ca-certificates gnupg
      curl -fsSL "https://deb.nodesource.com/setup_20.x" | $SUDO -E bash -
      $SUDO apt-get install -y nodejs
      ;;
    dnf|yum)
      curl -fsSL "https://rpm.nodesource.com/setup_20.x" | $SUDO bash -
      $SUDO "${PKG}" install -y nodejs
      ;;
    pacman)   $SUDO pacman -Sy --noconfirm nodejs npm ;;
    zypper)   $SUDO zypper --non-interactive install nodejs20 npm20 || $SUDO zypper --non-interactive install nodejs npm ;;
    apk)      $SUDO apk add --no-cache nodejs npm ;;
    *)
      # universal binary fallback — works everywhere, no package manager
      say "falling back to official Node.js binary tarball…"
      local ver="v20.18.1" triple
      case "$ARCH" in x86_64) triple="x64" ;; aarch64|arm64) triple="arm64" ;; esac
      curl -fsSL "https://nodejs.org/dist/${ver}/node-${ver}-linux-${triple}.tar.xz" -o /tmp/node.tar.xz
      $SUDO mkdir -p /usr/local/lib/nodejs
      $SUDO tar -xJf /tmp/node.tar.xz -C /usr/local/lib/nodejs
      $SUDO ln -sf "/usr/local/lib/nodejs/node-${ver}-linux-${triple}/bin/node" /usr/local/bin/node
      $SUDO ln -sf "/usr/local/lib/nodejs/node-${ver}-linux-${triple}/bin/npm"  /usr/local/bin/npm
      $SUDO ln -sf "/usr/local/lib/nodejs/node-${ver}-linux-${triple}/bin/npx"  /usr/local/bin/npx
      rm -f /tmp/node.tar.xz
      ;;
  esac
}

if node_ok; then ok "Node.js $(node -v) already present"; else install_node; node_ok || die "Node.js 20 installation failed"; ok "Node.js $(node -v) installed"; fi

# ── 3. repository location ──────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd)"
if [[ -f "$SCRIPT_DIR/package.json" && -d "$SCRIPT_DIR/src" ]]; then
  DIR="${DIR:-$SCRIPT_DIR}"
  ok "running inside the repository: $DIR"
else
  DIR="${DIR:-/opt/librepay-node}"
  [[ "$(id -u)" != "0" && "$DIR" == "/opt/librepay-node" ]] && DIR="$HOME/librepay-node"
fi

if [[ "$UPDATE" == "yes" ]]; then
  say "updating existing installation at $DIR…"
  git -C "$DIR" pull --ff-only || warn "git pull failed — using local source"
else
  if [[ ! -f "$DIR/package.json" ]]; then
    say "fetching LibrePay Node into $DIR…"
    $SUDO mkdir -p "$(dirname "$DIR")" 2>/dev/null || true
    if git clone --depth 1 https://github.com/radhwendalyhamdouni/librepay-node.git "$DIR" 2>/dev/null; then
      ok "cloned"
    else
      $SUDO mkdir -p "$DIR" && $SUDO chown "$(id -u):$(id -g)" "$DIR"
      git clone --depth 1 https://github.com/radhwendalyhamdouni/librepay-node.git "$DIR" || die "git clone failed — is git installed? (apt install git)"
      ok "cloned (after chown)"
    fi
  fi
fi
cd "$DIR"

# ── 4. dependencies + build (docker mode skips to compose) ─────────────────
if [[ "$MODE" == "docker" ]]; then
  [[ "$HAS_DOCKER" == "yes" ]] || die "docker not found — install docker first (https://docs.docker.com/engine/install/)"
  [[ -f .env ]] || { cp .env.example .env; say "created .env from template — edit it or finish setup in the browser"; }
  say "building and starting containers (app + phoenixd + tor)…"
  $SUDO docker compose -f docker/compose.yml up -d --build
  ok "containers up"
  cat <<EOF

${BOLD}  next step${RESET}
    open the node in your browser and complete the wizard:
      ${GREEN}http://localhost:3000/setup${RESET}   (or your server's address)
    setup code:
      ${GREEN}docker compose -f docker/compose.yml exec app cat data/SETUP_TOKEN${RESET}
EOF
  exit 0
fi

say "installing dependencies (this can take a minute)…"
if command -v bun >/dev/null 2>&1; then
  bun install
else
  npm install --no-audit --no-fund
fi

if [[ ! -f .env ]]; then
  say "generating .env with fresh secrets…"
  local_tmp="$(mktemp)"
  if node_ok; then
    node -e '
      const c = require("crypto");
      const h = n => c.randomBytes(n).toString("hex");
      const out = [
        "LP_STORE_NAME=LibrePay Store",
        "LP_BRAND_COLOR=#f7931a",
        `LP_API_KEY=lp_live_${h(24)}`,
        `LP_APP_SECRET=${h(32)}`,
        "LP_WEBHOOK_URLS=",
        `LP_WEBHOOK_SECRETS=${h(32)}`,
        "LP_LIGHTNING_URL=",
        "LP_SIMULATE=",
        "LP_BASE_URL=",
        `DATABASE_URL=file:${process.cwd()}/data/node.db`,
        "LP_CRON_INTERVAL_MS=15000",
      ].join("\n");
      require("fs").writeFileSync(process.argv[1], out + "\n", { mode: 0o600 });
    ' "$local_tmp"
  else
    die "node unavailable for secret generation"
  fi
  # prompt for store name unless non-interactive
  if [[ "$ASSUME_YES" != "yes" ]]; then
    printf '%s' "${DIM}store name [LibrePay Store]: ${RESET}"; read -r STORE_NAME || true
    [[ -n "${STORE_NAME:-}" ]] && sed -i.bak "s|^LP_STORE_NAME=.*|LP_STORE_NAME=${STORE_NAME}|" "$local_tmp" && rm -f "$local_tmp.bak"
  fi
  mv "$local_tmp" .env && chmod 600 .env
  ok ".env created (secrets are server-local; the wizard will issue your API key)"
fi

say "creating the database schema…"
if command -v bun >/dev/null 2>&1; then bun run db:push; else npx prisma db push; fi

say "building production bundle…"
if command -v bun >/dev/null 2>&1; then bun run build; else npm run build; fi
ok "build complete"

# ── 5. service ──────────────────────────────────────────────────────────────
if [[ "$HAS_SYSTEMD" == "yes" ]]; then
  say "installing systemd service…"
  NODE_BIN="$(command -v node)"
  SERVICE=/etc/systemd/system/librepay-node.service
  $SUDO tee "$SERVICE" >/dev/null <<EOF
[Unit]
Description=LibrePay Node — self-hosted Bitcoin payment gateway
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$(id -u)
WorkingDirectory=$DIR
Environment=NODE_ENV=production
Environment=PORT=$PORT
Environment=LP_DATA_DIR=$DIR/data
EnvironmentFile=$DIR/.env
ExecStart=$NODE_BIN $DIR/.next/standalone/server.js
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=$DIR/data

[Install]
WantedBy=multi-user.target
EOF
  $SUDO systemctl daemon-reload
  $SUDO systemctl enable --now librepay-node
  sleep 2
  $SUDO systemctl is-active --quiet librepay-node && ok "service running" || warn "service not active yet — check: journalctl -u librepay-node -n 20"
  RESTART_CMD="sudo systemctl restart librepay-node"
else
  say "no systemd — starting in the background with nohup…"
  nohup env NODE_ENV=production PORT="$PORT" LP_DATA_DIR="$DIR/data" node "$DIR/.next/standalone/server.js" > "$DIR/node.log" 2>&1 &
  sleep 2
  RESTART_CMD="cd $DIR && (kill \$(cat data/node.pid) 2>/dev/null; nohup env NODE_ENV=production PORT=$PORT node .next/standalone/server.js > node.log 2>&1 & echo \$! > data/node.pid)"
fi

# wait for health
for i in $(seq 1 20); do
  curl -sf "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1 && break
  sleep 1
done
curl -sf "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1 && ok "node is healthy on :$PORT" || warn "health check failed — check logs"

# ── 6. optional TLS via Caddy ───────────────────────────────────────────────
if [[ -n "$DOMAIN" ]]; then
  say "configuring Caddy automatic HTTPS for $DOMAIN…"
  case "$PKG" in
    apt)
      $SUDO apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
      curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | $SUDO gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg 2>/dev/null || true
      curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | $SUDO tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
      $SUDO apt-get update -y && $SUDO apt-get install -y caddy
      ;;
    dnf|yum) $SUDO "${PKG}" install -y caddy || true ;;
    *) warn "install caddy manually for your distro, then point it at :$PORT" ;;
  esac
  if command -v caddy >/dev/null 2>&1; then
    printf '%s\n%s\n' "$DOMAIN" "{ reverse_proxy 127.0.0.1:${PORT} }" | $SUDO tee /etc/caddy/Caddyfile >/dev/null
    $SUDO systemctl restart caddy 2>/dev/null || $SUDO caddy start 2>/dev/null || true
    ok "https://$DOMAIN is live (automatic certificate)"
  fi
else
  say "${DIM}tip: re-run with --domain your.host to get automatic HTTPS${RESET}"
fi

# ── 7. summary + one-time setup code ────────────────────────────────────────
# touching the status endpoint materializes data/SETUP_TOKEN
curl -sf "http://127.0.0.1:${PORT}/api/setup/status" >/dev/null 2>&1 || true
TOKEN="$(cat "$DIR/data/SETUP_TOKEN" 2>/dev/null || echo "(open the wizard once, then: cat data/SETUP_TOKEN)")"
SCHEME="http"; [[ -n "$DOMAIN" ]] && SCHEME="https"
BASE="${SCHEME}://$( [[ -n "$DOMAIN" ]] && echo "$DOMAIN" || echo "$(hostname -I 2>/dev/null | awk '{print $1}'):${PORT}" )"

echo
echo "${BOLD}  ═══════════════════════════════════════════════════${RESET}"
echo "${BOLD}   ⚡ LibrePay Node is installed${RESET}"
echo "${BOLD}  ═══════════════════════════════════════════════════${RESET}"
echo
echo "   node:        ${GREEN}${BASE}${RESET}"
echo "   setup:       ${GREEN}${BASE}/setup${RESET}"
echo "   setup code:  ${GREEN}${TOKEN}${RESET}   ${DIM}(= cat ${DIR}/data/SETUP_TOKEN)${RESET}"
echo
echo "   ${BOLD}next:${RESET} open ${GREEN}${BASE}/setup${RESET} in your browser, paste the"
echo "   setup code, answer ${BOLD}5 questions${RESET} — the node goes live"
echo "   and starts receiving Bitcoin immediately."
echo
echo "   ${DIM}restart later: ${RESTART_CMD}${RESET}"
echo "   ${DIM}backups run automatically (data/backups/) — configure an${RESET}"
echo "   ${DIM}off-server SSH copy in the operator console (/setup).${RESET}"
echo
