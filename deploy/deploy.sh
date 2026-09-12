#!/usr/bin/env bash
set -euo pipefail
umask 077
[[ "$EUID" -eq 0 ]] || { echo 'Run deployment as root.' >&2; exit 1; }
[[ $# -eq 1 && "$1" =~ ^sha256:[a-f0-9]{64}$ ]] || { echo 'Expected one sha256 image digest.' >&2; exit 2; }
mountpoint -q /srv/nhs-sim || { echo 'Persistent data volume is not mounted.' >&2; exit 1; }
cd /opt/nhs-sim
exec 9>/var/lock/nhs-sim-deploy.lock
flock -w 1800 9
source ./host.env
export AWS_REGION AWS_DEFAULT_REGION="$AWS_REGION"
: "${ECR_REPOSITORY:?}" "${BACKUP_BUCKET:?}" "${DB_SECRET_ARN:?}" "${OPERATOR_SECRET_ARN:?}" "${LOG_GROUP:?}"
[[ "$ECR_REPOSITORY" =~ ^[0-9]{12}\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com/[a-z0-9._/-]+$ ]] || { echo 'Invalid ECR repository.' >&2; exit 2; }
new_image="${ECR_REPOSITORY}@$1"
previous_image=''
if [[ -f current-image ]]; then
  previous_image="$(cat current-image)"
  previous_digest="${previous_image#"${ECR_REPOSITORY}@"}"
  [[ "$previous_image" == "${ECR_REPOSITORY}@${previous_digest}" && "$previous_digest" =~ ^sha256:[a-f0-9]{64}$ ]] || { echo 'Invalid recorded image.' >&2; exit 2; }
fi
compose=(docker compose --env-file .env -f compose.yaml)
if [[ -f .env ]]; then
  if [[ -n "$("${compose[@]}" ps -q postgres)" ]]; then
    ./backup.sh --deployment-locked
  elif [[ -f current-image ]]; then
    echo 'Existing database is stopped; restore it before deploying.' >&2
    exit 1
  fi
fi
postgres_password="$(aws secretsmanager get-secret-value --secret-id "$DB_SECRET_ARN" --query SecretString --output text)"
operator_token="$(aws secretsmanager get-secret-value --secret-id "$OPERATOR_SECRET_ARN" --query SecretString --output text)"
[[ "$postgres_password" =~ ^[a-zA-Z0-9]{24,128}$ && "$operator_token" =~ ^[a-zA-Z0-9]{24,128}$ ]] || { echo 'Secrets must contain 24–128 alphanumeric characters.' >&2; exit 2; }
write_env() {
  local image="$1"
  printf 'AWS_REGION=%s\nLOG_GROUP=%s\nAPP_IMAGE=%s\nPOSTGRES_PASSWORD=%s\nOPERATOR_TOKEN=%s\n' \
    "$AWS_REGION" "$LOG_GROUP" "$image" "$postgres_password" "$operator_token" > .env.next
  chmod 600 .env.next
  mv .env.next .env
}
aws ecr get-login-password --region "$AWS_REGION" |
  docker login --username AWS --password-stdin "${ECR_REPOSITORY%%/*}"
docker pull "$new_image"
write_env "$new_image"
mkdir -p /srv/nhs-sim/postgres /srv/nhs-sim/caddy/data /srv/nhs-sim/caddy/config
"${compose[@]}" up -d --wait --wait-timeout 180 postgres
if "${compose[@]}" up -d --no-deps --wait --wait-timeout 240 app &&
   curl --fail --silent --show-error --max-time 15 http://127.0.0.1:8080/healthz >/dev/null &&
   "${compose[@]}" up -d --no-deps --force-recreate --wait --wait-timeout 60 caddy; then
  if [[ -n "$previous_image" && "$previous_image" != "$new_image" ]]; then
    printf '%s\n' "$previous_image" > previous-image
  fi
  printf '%s\n' "$new_image" > current-image.next
  mv current-image.next current-image
  if [[ -n "$previous_image" ]]; then
    printf 'Previous image digest: %s\n' "${previous_image##*@}"
  fi
  echo 'Deployment is healthy.'
else
  echo 'Deployment failed health checks.' >&2
  if [[ -n "$previous_image" ]]; then
    write_env "$previous_image"
    "${compose[@]}" up -d --no-deps --wait --wait-timeout 240 app
    "${compose[@]}" up -d --no-deps --wait --wait-timeout 60 caddy
    echo 'Previous application image restored.' >&2
  fi
  exit 1
fi
