#!/bin/bash
# Rendered by Terraform (templatefile). Bash "$${...}" is escaped for Terraform.
set -euo pipefail
exec > >(tee -a /var/log/nhs-sim-bootstrap.log) 2>&1

host='${host}'
region='${region}'
repository='${repository}'
image='${image}'
operator_token='${operator_token}'

dnf install -y docker
systemctl enable --now docker
mkdir -p /usr/local/lib/docker/cli-plugins /opt/nhs-sim /srv/nhs-sim/postgres /srv/nhs-sim/caddy/data /srv/nhs-sim/caddy/config
curl -fsSL https://github.com/docker/compose/releases/download/v5.5.1/docker-compose-linux-x86_64 -o /usr/local/lib/docker/cli-plugins/docker-compose
curl -fsSL https://github.com/docker/compose/releases/download/v5.5.1/checksums.txt -o /tmp/compose-checksums
(cd /usr/local/lib/docker/cli-plugins; grep ' \*docker-compose-linux-x86_64$' /tmp/compose-checksums | sed 's/docker-compose-linux-x86_64$/docker-compose/' | sha256sum -c -)
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
chmod 700 /opt/nhs-sim
cd /opt/nhs-sim

# Resolve the image: explicit digest, explicit tag, or the most recently pushed image.
repository_name="$${repository##*/}"
registry="$${repository%%/*}"
if [ -z "$image" ]; then
  image=$(aws ecr describe-images --region "$region" --repository-name "$repository_name" \
    --query 'sort_by(imageDetails,&imagePushedAt)[-1].imageDigest' --output text)
fi
case "$image" in
  sha256:*) app_image="$repository@$image" ;;
  *)        app_image="$repository:$image" ;;
esac

postgres_password=$(openssl rand -hex 24)
[ -n "$operator_token" ] || operator_token=$(openssl rand -hex 24)
umask 077
cat > .env <<ENV
APP_IMAGE=$app_image
PUBLIC_ORIGIN=https://$host
POSTGRES_PASSWORD=$postgres_password
OPERATOR_TOKEN=$operator_token
ENV

cat > Caddyfile <<CADDY
$host {
	encode zstd gzip
	reverse_proxy app:8080
}
CADDY

cat > compose.yaml <<'COMPOSE'
name: nhs-sim
services:
  postgres:
    image: postgres:17-bookworm
    environment:
      POSTGRES_USER: nhssim
      POSTGRES_DB: nhssim
      POSTGRES_PASSWORD: $${POSTGRES_PASSWORD:?}
    volumes:
      - /srv/nhs-sim/postgres:/var/lib/postgresql/data
    healthcheck:
      test: [CMD-SHELL, pg_isready -U nhssim -d nhssim]
      interval: 5s
      timeout: 3s
      retries: 30
    restart: unless-stopped
  app:
    image: $${APP_IMAGE:?}
    init: true
    ports:
      - "127.0.0.1:8080:8080"
    environment:
      NODE_ENV: production
      PORT: 8080
      PUBLIC_ORIGIN: $${PUBLIC_ORIGIN:?}
      DATABASE_URL: postgres://nhssim:$${POSTGRES_PASSWORD:?}@postgres:5432/nhssim
      OPERATOR_TOKEN: $${OPERATOR_TOKEN:?}
    depends_on:
      postgres:
        condition: service_healthy
    healthcheck:
      test: [CMD, node, -e, "fetch('http://127.0.0.1:8080/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
      interval: 10s
      timeout: 5s
      start_period: 120s
      retries: 12
    restart: unless-stopped
  caddy:
    image: caddy:2-alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /opt/nhs-sim/Caddyfile:/etc/caddy/Caddyfile:ro
      - /srv/nhs-sim/caddy/data:/data
      - /srv/nhs-sim/caddy/config:/config
    depends_on:
      app:
        condition: service_healthy
    restart: unless-stopped
COMPOSE

aws ecr get-login-password --region "$region" | docker login --username AWS --password-stdin "$registry"
docker pull "$app_image"

# Wait (up to 10 minutes) for the DNS record to point at this host's Elastic IP so
# Caddy's first certificate request succeeds. Caddy retries anyway if this times out.
token=$(curl -fsS -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 600')
for attempt in $(seq 1 120); do
  public_ip=$(curl -fsS -H "X-aws-ec2-metadata-token: $token" http://169.254.169.254/latest/meta-data/public-ipv4 || true)
  resolved=$(getent hosts "$host" | awk '{print $1}' | head -1 || true)
  if [ -n "$public_ip" ] && [ "$resolved" = "$public_ip" ]; then break; fi
  sleep 5
done

docker compose --env-file .env up -d --wait --wait-timeout 300
touch /opt/nhs-sim/bootstrap-complete
echo "NHS-SIM instance ready at https://$host"
