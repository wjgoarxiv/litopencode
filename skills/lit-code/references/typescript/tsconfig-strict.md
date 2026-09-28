# TypeScript — configuration that changes what compiles

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext"
  }
}
```

## What each one is actually for

- **`strict`** is the umbrella: `strictNullChecks` alone eliminates the largest single class of
  run-time error in this language.
- **`noUncheckedIndexedAccess`** makes `arr[i]` return `T | undefined`. It is the most annoying
  setting here and the one that finds the most real bugs — array and record access is where
  `undefined` enters unnoticed.
- **`exactOptionalPropertyTypes`** distinguishes "absent" from "present and `undefined`". These
  differ for `in` checks, spreads, and `JSON.stringify`.
- **`verbatimModuleSyntax`** forces `import type` to be explicit, so type-only imports cannot survive
  into emitted code and cause a run-time resolution failure.
- **`skipLibCheck`** is a pragmatic exception: it skips checking `.d.ts` files, whose errors are
  usually a dependency's problem and not actionable.

## Adopting on an existing codebase

Enable one setting at a time and fix the fallout in its own change. Turning on four at once produces
a diff nobody can review, which ends with the settings being reverted rather than the code being
fixed.

