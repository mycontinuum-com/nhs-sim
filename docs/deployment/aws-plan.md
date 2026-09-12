# Deployment approval plan

Status: approved by the user on 10 September 2026. Provisioned and live at https://sim.animahacks.com. Public workflow verification passed in GitHub Actions run 34480205969. See runbook.md for operations.

## Verified starting point

- Repository: private `mycontinuum-com/nhs-sim`, main pushed at `90a02fa`.
- AWS account: `797629229500`, default CLI profile, London `eu-west-2`.
- Route 53 zone: `Z07920263LAS94GJL0A7K`, `animahacks.com`. Public delegation matches this zone. No `sim.animahacks.com` record exists.
- The account already has the GitHub Actions OIDC provider.
- The application requires one active simulator process. PostgreSQL's advisory lock rejects a second server against the same database.

## Proposed resources

Create a dedicated CloudFormation stack using AWS CLI, tagged `Project=nhs-sim`. Its resources are separate from production application networks and databases.

- One dedicated VPC and public subnet, internet gateway and route table. No NAT gateway.
- One on-demand x86 Amazon Linux 2023 instance selected through the `InstanceType` parameter. The initial `t3.large` had 2 vCPU and 8 GiB memory; the running host was resized to `m7i.xlarge`, 4 vCPU and 16 GiB, on 12 September 2026. Require IMDSv2. No SSH port or SSH key; administer through Systems Manager.
- One Elastic IP. Allow public TCP 80/443 only. Caddy handles HTTPS and forwards to the app over the private Docker network. PostgreSQL has no published port.
- Encrypted root EBS volume and separate retained 80 GiB gp3 data volume. PostgreSQL and TLS state survive application image replacement.
- ECR repository with immutable commit tags and image retention rules.
- Namespaced Secrets Manager secrets for random database password and operator token. Runtime receives no production EHR bucket permissions and no OpenAI API key unless requested separately.
- Private encrypted S3 bucket for daily PostgreSQL dumps, with 14-day retention. Take a dump before deployments. CloudWatch logs with 14-day retention, host/disk health alarms, and a billing-budget alert. Agree notification recipient during setup if none is configured.
- Route 53 A record `sim.animahacks.com` pointing to the Elastic IP. Caddy obtains and renews its certificate. Set `PUBLIC_ORIGIN=https://sim.animahacks.com` for correct redirects and CIS2 callbacks.

The application and PostgreSQL stay in their current separate containers. Caddy is the TLS entry point. This remains a single-host deployment, with a brief interruption when the app container is replaced. It is not highly available.

## GitHub Actions deployment

Keep pull-request verification. After approval, add a deployment workflow triggered by successful main verification or manual dispatch, with deployment concurrency limited to one run.

1. Run skill validation, typecheck, tests, build and Compose integration checks.
2. Obtain short-lived AWS credentials using GitHub OIDC. Trust only this repository's main-branch workflow. Grant ECR push and a dedicated SSM deployment document for this tagged instance. The routine deployment role cannot create infrastructure or access production resources.
3. Build once in GitHub Actions and push the commit-tagged image to ECR. Record the digest.
4. Invoke the dedicated SSM deployment document. Back up PostgreSQL, pull the exact digest and replace the app container. Keep PostgreSQL running and retain the previous digest.
5. Verify HTTPS, health, assets, CIS2 discovery and a disposable team journey against the public origin. Confirm persistence across app restart. Revert to the prior image on failure. Database restoration is a separate deliberate operation if future migrations make rollback incompatible.

AWS documents GitHub OIDC at https://aws.amazon.com/blogs/security/use-iam-roles-to-connect-github-actions-to-actions-in-aws/ and SSM Run Command at https://docs.aws.amazon.com/systems-manager/latest/userguide/run-command-setting-up.html.

## Cost and event readiness

AWS Pricing API on 12 September 2026 returned $0.2331/hour for Linux `m7i.xlarge` in London, about $170.16 for 730 hours of compute. The original `t3.large` base rate was $0.0944/hour, excluding surplus CPU credits. EBS, public IPv4, backups, registry, logs, transfer and taxes add to compute charges. Budget alerts should reflect the selected capacity and are not spending caps.

Before the event, measure concurrent participant/API workloads and check memory, event-loop latency and database persistence time. Current functional tests are not evidence of 100-team capacity. Increase the single host only if measurements justify it. Do not add app replicas without redesigning simulator ownership.

Stopping the host after the event stops instance compute charges; retained volumes, IP and backups still cost money. Keep data by default. Infrastructure deletion and data deletion remain separate actions.

## Approval requested

Approve the dedicated single-host London deployment, approximately $90–120/month at light usage, public HTTPS at sim.animahacks.com, and automatic main deployments after verification. On approval, implement the stack, workflow and production Compose configuration, provision through AWS CLI, deploy, and prove the public participant journey.
