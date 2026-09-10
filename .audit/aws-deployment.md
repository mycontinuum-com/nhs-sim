# Approved AWS deployment

User approved the documented single-host London deployment and automatic main deployments on 10 September 2026.

## Work sequence

1. Ground the current simulator ownership, CI, AWS DNS and credentials.
2. Use the approved architecture. Alternative exploration is complete in the approval plan.
3. Implement the runtime, declarative stack and CI workflow.
4. Validate templates and scripts, then create the stack through AWS CLI.
5. Deploy a verified commit through GitHub Actions and prove public workflows.

## Throughput checkpoint

- Credentials, destination repository and existing-stack lookup precede writes.
- Runtime script owner edits deploy/{compose.yaml,Caddyfile,deploy.sh,backup.sh}. Root owns stack, workflow and provisioning.
- IAM, DNS, stack updates and git changes have one owner. No parallel conflicting cloud writes.
- Existing unrelated working-tree changes belong to another ongoing task. Deployment commits include only deployment-owned files; CI deploys committed main.

## Approval and limits

Budget approximately $90–120/month at light usage. Budget and health notification email requested asynchronously. No production EHR permissions. PostgreSQL and TLS data retained. One simulator process; app replacement entails a brief interruption.

## Deployment evidence

CloudFormation stack nhs-sim reached UPDATE_COMPLETE in eu-west-2. GitHub Actions run 34480205969 deployed commit 8fa5086 and passed public doctor, journey and smoke checks. CloudWatch receives instance memory and data disk metrics. Public browser verification confirms the map and team onboarding. Notification email remains pending.
