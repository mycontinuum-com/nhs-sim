#!/usr/bin/env bash
set -euo pipefail
umask 077
mountpoint -q /srv/nhs-sim || { echo 'Persistent data volume is not mounted.' >&2; exit 1; }
cd /opt/nhs-sim
source ./host.env
export AWS_REGION AWS_DEFAULT_REGION="$AWS_REGION"
if [[ "${1:-}" != "--deployment-locked" ]]; then
  exec 9>/var/lock/nhs-sim-deploy.lock
  flock -w 1800 9
fi
[[ -f .env ]] || { echo 'No deployed database to back up.'; exit 0; }
compose=(docker compose --env-file .env -f compose.yaml)
container_id="$("${compose[@]}" ps -q postgres)"
[[ -n "$container_id" ]] || { echo 'Database is not running; backup failed.' >&2; exit 1; }
object="backups/$(date -u +%Y/%m/%d)/nhs-sim-$(date -u +%Y%m%dT%H%M%SZ)-${RANDOM}.sql.gz"
"${compose[@]}" exec -T postgres pg_dump --username=nhssim --dbname=nhssim --no-owner --no-acl |
  gzip -c |
  aws s3 cp - "s3://${BACKUP_BUCKET}/${object}" --only-show-errors --sse AES256
printf 'Database backup saved: %s\n' "$object"
