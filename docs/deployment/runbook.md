# Operating the simulator

The deployment stack is `nhs-sim` in AWS account `797629229500`, region `eu-west-2`. It serves https://sim.animahacks.com and https://sim.animahealth.com from the same application and database. The latter provides an event address on an established domain.

Both names point directly to Elastic IP `51.24.181.153`. The `sim.animahealth.com` A record has TTL 60 in Route 53 zone `Z06200331BS535CH7W4US` and is managed separately from the CloudFormation stack. Caddy manages certificates for both names. `PUBLIC_ORIGINS` lists both permitted origins, while `PUBLIC_ORIGIN` supplies the default for requests without a recognized public host. Browser requests and identity endpoints use the selected origin.

## Deploy

Push to main. `Verify ecosystem` runs first; a successful push verification triggers `Deploy simulator`. A manual run of `Deploy simulator` also runs integration checks before publishing. Superseded revisions are rejected. Each successful release records an immutable ECR digest.

The GitHub role uses OIDC and has permission only to publish the simulator image/runtime artifact and invoke its deployment document. It cannot provision infrastructure or read runtime secrets.

Deployment validates the candidate Caddy configuration before replacing the app. Once the app is healthy, it reloads the running proxy without recreating its container. A failed app rollout leaves the proxy's active configuration unchanged; a failed proxy reload retains its previous active configuration while the app rolls back. Initial installation starts Caddy after the app is healthy. Changes to the Caddy image, ports or mounts require a separate container replacement.

## Operator access

The simulator operator token is in Secrets Manager at `/nhs-sim/operator-token`. Retrieve it using your existing AWS access when needed; do not save it in the repo or GitHub variables. Use it in the simulator's operator controls. Team keys cannot change global CIS2 settings.

## Data and recovery

PostgreSQL, Caddy certificate data and configuration are stored on the separate encrypted EBS data volume. Application deployment keeps PostgreSQL running and backs it up before replacement. The daily systemd timer `nhs-sim-backup.timer` runs at 03:00 UTC. Backups are compressed PostgreSQL dumps under the stack storage bucket's `backups/` prefix and expire after 14 days.

An unhealthy app deployment restores the prior application image. Public workflow verification can also request that rollback. Restore a database only as a separate deliberate operation after taking another backup; restoring an older database discards subsequent team actions. Database secret rotation requires a coordinated PostgreSQL password change.

Use Systems Manager Session Manager or Run Command for host administration. The host has no SSH key or inbound SSH port. Deployment files are at `/opt/nhs-sim`; the data mount is `/srv/nhs-sim`. Avoid displaying `.env` or secret values in command logs.

Deployment installs `/etc/systemd/system/docker.service.d/nhs-sim-data.conf` with `RequiresMountsFor=/srv/nhs-sim`. Docker therefore waits for the persistent volume before starting containers after a reboot. Deployment refreshes systemd only when this dependency changes and does not restart Docker.

## Monitoring and cost

Runtime logs are in CloudWatch `/nhs-sim/runtime`, retained for 14 days. Alarms cover host status, data-disk use and memory. The `nhs-sim-monthly` budget tracks `Project=nhs-sim` costs and alerts at 80% of $120. Cost allocation updates can take time to appear. A budget alert does not stop spending.

The `nhs-sim-alerts` SNS topic needs a confirmed email subscription for notifications to reach a person. Email confirmation must be completed by the recipient.

Stopping the EC2 host stops its compute charges, but storage, backups and the public IP continue to incur charges. Preserve the data volume and backups unless their deletion is separately requested.

## Release limits

One application process owns the simulation. Scaling to multiple replicas requires redesigning state ownership. The database advisory lock prevents warming a second application against the same database. Requests can fail while the replacement app loads its state; preserving Caddy avoids an additional proxy interruption but does not remove the app's startup outage. CIS2 sessions and settings reset with the application process. Functional verification is not a claim of 100-team event capacity.

The CloudFormation `InstanceType` parameter defaults to `t3.large` and requires an x86_64-compatible instance. Review a change set before resizing; changing the instance type interrupts the entire host, including its proxy. The image also sets a 4096 MiB Node heap limit, so adding host RAM alone does not raise that limit. Choose host and heap sizes from measured startup and steady-state memory, leaving room for PostgreSQL and the operating system.
