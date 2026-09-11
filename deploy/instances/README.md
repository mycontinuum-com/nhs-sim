# Per-team simulator instances

One isolated simulator per team, each on its own small VM, published at
`https://<id>.sim.animahacks.com`. The root simulator at `https://sim.animahacks.com`
is untouched: this Terraform only *reads* the root stack's VPC, subnet and ECR
repository and creates net-new resources next to them. Applying or destroying it
cannot restart, reconfigure or redeploy the root host.

Each instance runs the same three containers as the root host (PostgreSQL, app,
Caddy) with its own random database password, its own TLS certificate and, by
default, its own operator token. Nothing is shared between instances, so a
team's load or clock speed cannot affect another team.

## Why a subdomain rather than `/instance/<id>`

The application hard-codes root-absolute paths (`/api/...`, `/control/`, `/cis2/`,
cookies, mock OIDC URLs) throughout the server and every frontend. Serving it under a
path prefix would need a base-path refactor across all apps. A subdomain gives the
same isolation with zero application changes. If a `/instance/<id>` URL is still
wanted, add a one-line redirect to the root `deploy/Caddyfile` later, e.g.
`redir /instance/abc123* https://abc123.sim.animahacks.com{uri}`. That is the only
change that would ever touch the root deployment, and it is optional.

## Prerequisites

- Terraform 1.6+ and AWS credentials for account `797629229500` with permission to
  create EC2, IAM, and Route 53 records (the same access used to create the root stack).
- The root stack deployed at least once, so the ECR repository `nhs-sim` contains an image.

## Create instances

```bash
cd deploy/instances
cp terraform.tfvars.example terraform.tfvars   # edit the instance ids
terraform init
terraform plan                                  # expect: only nhs-sim-instances resources
terraform apply
terraform output instance_urls
```

Each VM bootstraps itself on first boot (about 3–5 minutes): installs Docker,
pulls the most recently pushed image from ECR (what `main` last deployed), waits for
its DNS record, starts the stack and obtains a certificate. Progress is in
`/var/log/nhs-sim-bootstrap.log` on the instance.

State is local (`terraform.tfstate`, git-ignored). Keep the directory, or move the
state to an S3 backend if more than one person will operate instances.

## Add or remove instances

Edit `instances` in `terraform.tfvars` and run `terraform apply`. Removing an id
destroys that VM and its data; other instances are not touched.

## Operator token

Pass `operator_token` in `terraform.tfvars` to use one token everywhere. Otherwise each
instance generates its own; `terraform output operator_token_commands` prints a
Systems Manager command per instance that echoes it. Never paste tokens into the repo.

## Update an instance to a newer image

Instances do not auto-update. To move one to the current `main` release:

```bash
terraform apply -replace='aws_instance.sim["abc123"]'
```

This recreates that VM only (its simulation data is lost, which is fine for a
hackathon instance). Pin a release for all new instances with `image = "sha256:..."`.

## Administer or debug

No SSH. Use Session Manager:

```bash
aws ssm start-session --region eu-west-2 --target "$(terraform output -raw instance_ids | jq -r '.abc123')"
sudo tail -f /var/log/nhs-sim-bootstrap.log
sudo docker compose -f /opt/nhs-sim/compose.yaml --env-file /opt/nhs-sim/.env logs -f app
```

## Tear down

```bash
terraform destroy
```

Removes every instance, its Elastic IP and DNS record, plus the shared security group
and IAM role. The root simulator, its data volume, backups and DNS record remain.

## Cost

Roughly the same per instance as the root host: about $70/month for a `t3.large`
in London, plus a public IPv4 address. Set `instance_type = "t3.medium"` to halve it
if a single team's load turns out to be light. Destroy instances once the event ends.
