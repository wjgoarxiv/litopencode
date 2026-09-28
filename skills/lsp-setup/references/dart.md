# Dart / Flutter — `dart language-server`

- **Server command:** `dart language-server --lsp`
- **Extensions:** `.dart`
- **Requires:** the Dart or Flutter SDK

## Install

Nothing separate — the server ships inside the SDK:

```bash
dart --version
```

Flutter projects should use the Dart bundled with Flutter so the SDK versions match.

## Troubleshooting

- **Packages unresolved:** run `dart pub get` (or `flutter pub get`).
- **Analysis rules** live in `analysis_options.yaml`, which is project configuration.

## Honest fallback while unserved

`dart analyze` gives the same diagnostics as a batch command.

