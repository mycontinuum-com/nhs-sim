#!/usr/bin/env bash
set -euo pipefail
[[ "$1" =~ ^sha256:[a-f0-9]{64}$ ]]
[[ "$REVISION" =~ ^[a-f0-9]{40}$ ]]
params=$(jq -n --arg revision "$REVISION" --arg digest "$1" '{Revision:[$revision],ImageDigest:[$digest]}')
command_id=$(aws ssm send-command --instance-ids "$INSTANCE_ID" --document-name "$DEPLOY_DOCUMENT" --parameters "$params" --timeout-seconds 900 --query Command.CommandId --output text)
for attempt in $(seq 1 150); do
  result=$(aws ssm get-command-invocation --command-id "$command_id" --instance-id "$INSTANCE_ID" --output json 2>/dev/null || echo '{"Status":"Pending"}')
  status=$(jq -r .Status <<< "$result")
  case "$status" in
    Success)
      jq -r .StandardOutputContent <<< "$result"
      previous=$(jq -r .StandardOutputContent <<< "$result" | sed -n 's/^Previous image digest: \(sha256:[a-f0-9]\{64\}\)$/\1/p' | tail -1)
      if [[ -n "${GITHUB_OUTPUT:-}" ]]; then echo "previous_digest=$previous" >> "$GITHUB_OUTPUT"; fi
      exit 0;;
    Failed|Cancelled|TimedOut|Cancelling)
      jq '{Status,StandardOutputContent,StandardErrorContent}' <<< "$result"
      exit 1;;
  esac
  sleep 10
done
echo "Deployment command $command_id did not finish within 25 minutes." >&2
exit 1
