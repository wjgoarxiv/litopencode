# C# — `csharp-ls`

- **Server command:** `csharp-ls`
- **Extensions:** `.cs`
- **Requires:** the .NET SDK

## Install

```bash
dotnet tool install --global csharp-ls
command -v csharp-ls
```

`~/.dotnet/tools` must be on `PATH`.

## Alternatives

- OmniSharp (`omnisharp`) — older and heavier, but handles some project layouts `csharp-ls` does not.
- The Roslyn-based server shipped with the official editor extension is not separately distributed.

## Troubleshooting

- **No diagnostics:** the root needs a `.sln` or `.csproj`. `csharp-ls` resolves through MSBuild.
- **Restore first:** run `dotnet restore`; unresolved packages surface as missing types.

## Honest fallback while unserved

`dotnet build`.

