# YAML — `yaml-language-server`

- **Server command:** `yaml-language-server --stdio`
- **Extensions:** `.yaml` `.yml`
- **Requires:** Node and npm

## Install

```bash
npm install -g yaml-language-server
command -v yaml-language-server
```

## Troubleshooting

- **Only syntax errors appear.** That is correct default behavior: without a schema the server can
  check that the document parses and nothing more. Real validation needs a schema association —
  either an inline `# yaml-language-server: $schema=<url>` comment at the top of the file, or a
  schema map in the project's own configuration.
- **Report the distinction.** "Parses" and "is a valid Kubernetes manifest" are different claims, and
  a schema-less clean result only supports the first.

## Honest fallback while unserved

`yq . file.yaml` or `python -c "import yaml,sys;yaml.safe_load(open(sys.argv[1]))"` for parse checks;
the target tool's own validator (`kubectl --dry-run`, `helm lint`) for semantics.

