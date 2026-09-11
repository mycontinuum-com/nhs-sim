# Per-team NHS-SIM instances: one small VM each, fully isolated from the root
# simulator at sim.animahacks.com. This configuration only READS the root
# CloudFormation stack's network (VPC/subnet) and ECR repository; it never
# modifies them. Applying, changing or destroying this configuration cannot
# affect the root host.

terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
  }
}

provider "aws" {
  region = var.region
  default_tags {
    tags = { Project = "nhs-sim-instances" }
  }
}

# ---- Read-only lookups of what already exists -------------------------------

data "aws_vpc" "root" {
  filter {
    name   = "tag:Project"
    values = ["nhs-sim"]
  }
}

data "aws_subnets" "root" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.root.id]
  }
}

data "aws_ecr_repository" "sim" {
  name = var.ecr_repository_name
}

data "aws_route53_zone" "zone" {
  name = var.dns_zone
}

data "aws_ssm_parameter" "al2023" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}

# ---- Shared, net-new resources (one of each for all instances) --------------

resource "aws_security_group" "instances" {
  name        = "nhs-sim-instances"
  description = "NHS-SIM per-team instances: public HTTP/HTTPS only"
  vpc_id      = data.aws_vpc.root.id

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "instance" {
  name               = "nhs-sim-instance"
  assume_role_policy = data.aws_iam_policy_document.assume.json
}

# Session Manager / Run Command access (no SSH port, no key pair).
resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.instance.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

data "aws_iam_policy_document" "pull" {
  statement {
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }
  statement {
    actions = [
      "ecr:BatchGetImage",
      "ecr:GetDownloadUrlForLayer",
      "ecr:BatchCheckLayerAvailability",
      "ecr:DescribeImages",
    ]
    resources = [data.aws_ecr_repository.sim.arn]
  }
}

resource "aws_iam_role_policy" "pull" {
  name   = "pull-simulator-image"
  role   = aws_iam_role.instance.id
  policy = data.aws_iam_policy_document.pull.json
}

resource "aws_iam_instance_profile" "instance" {
  name = "nhs-sim-instance"
  role = aws_iam_role.instance.name
}

# ---- One VM + IP + DNS record per instance id --------------------------------

resource "aws_instance" "sim" {
  for_each = toset(var.instances)

  ami                    = data.aws_ssm_parameter.al2023.value
  instance_type          = var.instance_type
  subnet_id              = data.aws_subnets.root.ids[0]
  vpc_security_group_ids = [aws_security_group.instances.id]
  iam_instance_profile   = aws_iam_instance_profile.instance.name

  metadata_options {
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  root_block_device {
    volume_size = var.root_volume_gb
    volume_type = "gp3"
    encrypted   = true
  }

  user_data = templatefile("${path.module}/cloud-init.sh", {
    host           = "${each.key}.${var.dns_subdomain}"
    region         = var.region
    repository     = data.aws_ecr_repository.sim.repository_url
    image          = var.image
    operator_token = var.operator_token
  })

  tags = {
    Name     = "nhs-sim-${each.key}"
    Instance = each.key
  }

  lifecycle {
    # Bootstrap runs once. Later changes to the image or AMI must not silently
    # stop/replace a live team instance; use `terraform apply -replace` instead.
    ignore_changes = [ami, user_data]
  }
}

resource "aws_eip" "sim" {
  for_each = toset(var.instances)
  domain   = "vpc"
  instance = aws_instance.sim[each.key].id
  tags     = { Name = "nhs-sim-${each.key}" }
}

resource "aws_route53_record" "sim" {
  for_each = toset(var.instances)
  zone_id  = data.aws_route53_zone.zone.zone_id
  name     = "${each.key}.${var.dns_subdomain}"
  type     = "A"
  ttl      = 60
  records  = [aws_eip.sim[each.key].public_ip]
}

# ---- Outputs -----------------------------------------------------------------

output "instance_urls" {
  description = "Public origin for each instance"
  value       = { for id in var.instances : id => "https://${id}.${var.dns_subdomain}" }
}

output "instance_ids" {
  description = "EC2 instance ids, for Session Manager or Run Command"
  value       = { for id, host in aws_instance.sim : id => host.id }
}

output "operator_token_commands" {
  description = "Run one of these to read an instance's operator token (when no shared operator_token was given)"
  value = {
    for id, host in aws_instance.sim : id =>
    "aws ssm send-command --region ${var.region} --instance-ids ${host.id} --document-name AWS-RunShellScript --parameters 'commands=[\"grep OPERATOR_TOKEN /opt/nhs-sim/.env\"]' --query Command.CommandId --output text | xargs -I{} sh -c 'sleep 5; aws ssm get-command-invocation --region ${var.region} --command-id {} --instance-id ${host.id} --query StandardOutputContent --output text'"
  }
}
