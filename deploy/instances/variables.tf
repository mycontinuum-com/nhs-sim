variable "region" {
  type    = string
  default = "eu-west-2"
}

variable "instances" {
  description = "Instance ids to run, one VM each. Lower-case letters, digits and hyphens; becomes <id>.<dns_subdomain>."
  type        = list(string)
  default     = []

  validation {
    condition     = alltrue([for id in var.instances : can(regex("^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$", id))])
    error_message = "Instance ids must be 2-32 lower-case letters, digits or hyphens, with no leading/trailing hyphen."
  }
}

variable "dns_zone" {
  description = "Existing Route 53 public hosted zone name."
  type        = string
  default     = "animahacks.com"
}

variable "dns_subdomain" {
  description = "Instances are published at https://<id>.<dns_subdomain>."
  type        = string
  default     = "sim.animahacks.com"
}

variable "ecr_repository_name" {
  description = "Existing ECR repository the root deployment publishes to."
  type        = string
  default     = "nhs-sim"
}

variable "image" {
  description = "Image to run: a commit tag or a sha256:... digest from the ECR repository. Empty = the most recently pushed image (i.e. what main last deployed)."
  type        = string
  default     = ""
}

variable "operator_token" {
  description = "Optional shared operator token for every instance. Empty = each instance generates its own; read it with the operator_token_commands output."
  type        = string
  default     = ""
  sensitive   = true
}

variable "instance_type" {
  type    = string
  default = "t3.large"
}

variable "root_volume_gb" {
  type    = number
  default = 30
}
