# JetBrains Mono: bundled font source

- Face: JetBrains Mono, Regular 400 and Bold 700, used by the computational-brutalism tonality for Latin text only.
- Release: v2.304 (official release archive, files shipped unmodified).
- Repository: https://github.com/JetBrains/JetBrainsMono
- Release asset: https://github.com/JetBrains/JetBrainsMono/releases/download/v2.304/JetBrainsMono-2.304.zip
- Archive sha256: `6f6376c6ed2960ea8a963cd7387ec9d76e3f629125bc33d1fdcd7eb7012f7bbf`
- License: SIL Open Font License 1.1, no Reserved Font Name (`OFL.txt` is the upstream file).

| File | bytes | sha256 |
|---|---|---|
| `JetBrainsMono-Regular.ttf` | 273900 | `a0bf60ef0f83c5ed4d7a75d45838548b1f6873372dfac88f71804491898d138f` |
| `JetBrainsMono-Bold.ttf` | 277828 | `5590990c82e097397517f275f430af4546e1c45cff408bde4255dad142479dcb` |
| `OFL.txt` | 4399 | `30f0c136e3c88e422d0791acd97238870f9054a9729bc34cf2ff0d4ed8cac4ad` |

The face carries no Hangul. Every mono run is written with `<a:ea typeface="Pretendard">`, so Hangul inside a mono run is set in the
bundled Pretendard (never subset), and a pack whose `faces.body` is mono is refused by the pack loader.
