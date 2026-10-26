#!/usr/bin/env bash
# GCE VM startup script for Monolith Docs.
# This runs automatically when the VM starts (via metadata startup-script).
# It installs Docker, pulls the repo, and starts services.

set -euo pipefail

LOG="/var/log/monolith-docs-startup.log"
exec > >(tee -a "${LOG}") 2>&1
echo "=== Monolith Docs startup $(date) ==="

APP_DIR="/opt/monolith-docs"
DEPLOY_STATE_DIR="${APP_DIR}/.deploy-state"
REPO_URL="https://github.com/monolith-cx/monolith-docs-editor.git"

apt_install() {
  apt-get update -y
  apt-get install -y "$@"
}

get_instance_attribute() {
  local key="$1"

  if command -v curl &>/dev/null; then
    curl -fsS --max-time 2 -H "Metadata-Flavor: Google" \
      "http://metadata.google.internal/computeMetadata/v1/instance/attributes/${key}" 2>/dev/null || true
    return
  fi

  if command -v wget &>/dev/null; then
    wget -qO- --header="Metadata-Flavor: Google" \
      "http://metadata.google.internal/computeMetadata/v1/instance/attributes/${key}" 2>/dev/null || true
    return
  fi

  echo "Installing curl for metadata lookup..."
  apt_install ca-certificates curl
  curl -fsS --max-time 2 -H "Metadata-Flavor: Google" \
    "http://metadata.google.internal/computeMetadata/v1/instance/attributes/${key}" 2>/dev/null || true
}

DEPLOY_REF="${DEPLOY_REF:-$(get_instance_attribute deploy-ref)}"
DEPLOY_REF="${DEPLOY_REF:-main}"
DEPLOY_ENV="${DEPLOY_ENV:-$(get_instance_attribute deploy-env)}"
DEPLOY_ENV="${DEPLOY_ENV:-dev}"

case "${DEPLOY_ENV}" in
  dev|prod)
    ;;
  *)
    echo "Unknown DEPLOY_ENV '${DEPLOY_ENV}'. Expected 'dev' or 'prod'."
    exit 1
    ;;
esac

resolve_target_ref() {
  local ref="$1"

  if git show-ref --verify --quiet "refs/remotes/origin/${ref}"; then
    printf 'origin/%s' "${ref}"
    return
  fi

  printf '%s' "${ref}"
}

# Install Docker if not present
if ! command -v docker &>/dev/null; then
  echo "Installing Docker..."
  apt_install apt-transport-https ca-certificates curl git gnupg lsb-release
  curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
  echo "deb [arch=amd64 signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/debian $(lsb_release -cs) stable" > /etc/apt/sources.list.d/docker.list
  apt_install docker-ce docker-ce-cli containerd.io docker-compose-plugin
  systemctl enable docker
  systemctl start docker
fi

if ! command -v git &>/dev/null; then
  echo "Installing git..."
  apt_install git
fi

# Install NGINX if not present
if ! command -v nginx &>/dev/null; then
  echo "Installing NGINX..."
  apt-get install -y nginx
  systemctl enable nginx
fi

# Install cloudflared if not present
if ! command -v cloudflared &>/dev/null; then
  echo "Installing cloudflared..."
  CLOUDFARED_DEB_URL="${CLOUDFLARED_DEB_URL:-https://pkg.cloudflare.com/cloudflared-stable-linux-amd64.deb}"

  if curl -fL "${CLOUDFARED_DEB_URL}" -o /tmp/cloudflared.deb && dpkg -i /tmp/cloudflared.deb; then
    echo "cloudflared installed."
  else
    echo "WARNING: cloudflared installation failed; continuing without it."
    echo "Configure cloudflared manually if tunnel-based routing is required on this VM."
  fi

  rm -f /tmp/cloudflared.deb
fi

# Create directory for Cloudflare origin certificates
mkdir -p /etc/ssl/cloudflare

# Clone or update repo
if [[ -d "${APP_DIR}/.git" ]]; then
  echo "Updating repo..."
  cd "${APP_DIR}"
else
  echo "Cloning repo..."
  git clone "${REPO_URL}" "${APP_DIR}"
  cd "${APP_DIR}"
fi

PREVIOUS_SHA="$(git rev-parse HEAD 2>/dev/null || true)"
git fetch --tags --prune origin
TARGET_REF="$(resolve_target_ref "${DEPLOY_REF}")"
git checkout --detach "${TARGET_REF}"
CURRENT_SHA="$(git rev-parse HEAD)"

mkdir -p "${DEPLOY_STATE_DIR}"
printf '%s\n' "${DEPLOY_REF}" > "${DEPLOY_STATE_DIR}/current-ref"
printf '%s\n' "${CURRENT_SHA}" > "${DEPLOY_STATE_DIR}/current-sha"
if [[ -n "${PREVIOUS_SHA}" ]]; then
  printf '%s\n' "${PREVIOUS_SHA}" > "${DEPLOY_STATE_DIR}/previous-sha"
fi

# Load environment config
ENV_FILE="${APP_DIR}/.env"
ENV_TEMPLATE="${APP_DIR}/infrastructure/environments/${DEPLOY_ENV}/env.example"
if [[ ! -f "${ENV_FILE}" ]]; then
  echo "ERROR: No .env file found at ${ENV_FILE}"
  if [[ -f "${ENV_TEMPLATE}" ]]; then
    echo "Create ${ENV_FILE} from ${ENV_TEMPLATE} and replace any generated placeholders before deploying."
  else
    echo "Create ${ENV_FILE} with the required hosted environment values before deploying."
  fi
  exit 1
fi

if grep -Eq '^[[:space:]]*[^#].*<generate:' "${ENV_FILE}"; then
  echo "ERROR: ${ENV_FILE} still contains unreplaced <generate: ...> placeholders."
  echo "Replace generated placeholders before running docker compose."
  exit 1
fi

# Start services
echo "Starting services..."
cd "${APP_DIR}"
docker compose pull onlyoffice
docker compose up -d --build --remove-orphans

for attempt in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3020/health >/dev/null && curl -fsS http://127.0.0.1:3020/api/status >/dev/null; then
    break
  fi

  if [[ "${attempt}" -eq 30 ]]; then
    echo "API health verification failed after deploy."
    docker compose ps
    docker compose logs api --tail 100
    exit 1
  fi

  sleep 5
done

echo "=== Startup complete $(date) ==="
echo "OnlyOffice: http://127.0.0.1:8080 (localhost only)"
echo "API:        http://127.0.0.1:3020 (localhost only)"
echo "Deploy ref: ${DEPLOY_REF}"
echo "Deploy env: ${DEPLOY_ENV}"
echo "Current SHA: ${CURRENT_SHA}"
if [[ -n "${PREVIOUS_SHA}" ]]; then
  echo "Previous SHA: ${PREVIOUS_SHA}"
fi
echo ""
echo "=== Manual steps required ==="
echo "1. Place Cloudflare origin cert at /etc/ssl/cloudflare/origin.pem"
echo "2. Place Cloudflare origin key at /etc/ssl/cloudflare/origin.key"
echo "3. Run infrastructure/cloudflare/setup-tunnel.sh to configure the tunnel"
echo "4. Copy infrastructure/nginx/monolith-docs.conf to /etc/nginx/sites-available/"
echo "5. ln -s /etc/nginx/sites-available/monolith-docs.conf /etc/nginx/sites-enabled/"
echo "6. nginx -t && systemctl reload nginx"
