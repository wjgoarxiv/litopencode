# Terraform — `terraform-ls`

- **Server command:** `terraform-ls serve`
- **Extensions:** `.tf` `.tfvars`
- **Requires:** the Terraform CLI

## Install

- macOS: `brew install hashicorp/tap/terraform-ls`
- Otherwise: download the release and put the binary on `PATH`.

```bash
command -v terraform-ls
```

## Troubleshooting

- **Providers and modules unresolved:** run `terraform init` in the directory. The server reads the
  `.terraform/` metadata that `init` produces; before that it cannot know any provider's schema.
- **Multi-root repositories** need the specific module directory opened, not the repository root.

## Honest fallback while unserved

`terraform validate` and `terraform fmt -check`. Neither reaches provider-side semantics — a plan
does, but a plan touches real credentials and should not be run for verification without approval.

