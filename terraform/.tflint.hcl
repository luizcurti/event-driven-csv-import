config {
  format = "compact"
}

plugin "terraform" {
  enabled = true
  preset  = "recommended"
}

# These two rules want every module to redeclare its own `terraform {
# required_version, required_providers }` block. That matters for modules
# published or reused outside their own repo; the 10 modules under
# terraform/modules here are internal, tightly coupled to this root module,
# and only ever invoked via relative `./modules/...` paths from
# terraform/main.tf. The version constraint is already declared once, in
# terraform/versions.tf, and applies to every child module in the same
# configuration — repeating it in each submodule would be pure boilerplate,
# not a real safeguard.
rule "terraform_required_version" {
  enabled = false
}

rule "terraform_required_providers" {
  enabled = false
}
