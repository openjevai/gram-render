# OpenJEV Support

This fork adds optional [OpenJEV](https://openjev.sh) support alongside the
default [TypeSafe](https://typesafe.ai) Jev integration. TypeSafe remains the
default — anyone with a TypeSafe key sees zero behaviour change.

## What was added

- **`src/evaluate/typesafe.ts`** — `EvaluatorOptions` gains a `provider` field
  (`"typesafe"` | `"openjev"`). When OpenJEV is selected, the endpoint is
  `https://api.openjev.sh/v1/systemone`, the model id is `openjev`, and the key
  is read from `OPENJEV_API_KEY`. HTTP 503 is now handled alongside 429 in the
  error hints.
- **`README.md`** — OpenJEV note after the intro, plus updated evaluator docs.
- **`examples/comparison/README.md`** — OpenJEV env vars documented in the env table.
- **`examples/comparison/run.ts`** — JEV model/base URL now respects `JEV_PROVIDER`.
- **`examples/demo-bot/main.ts`** — checks `OPENJEV_API_KEY` alongside TypeSafe keys.
- **`examples/demo-bot/env.ts`** — `OPENJEV_API_KEY` documented in the env header.
- **`test/integration/jev.test.ts`** — integration tests now run with `OPENJEV_API_KEY` too.
- **`test/integration/comparison-live.test.ts`** — same; trace metadata respects `JEV_PROVIDER`.
- **`src/compose/options.ts`** — doc comment updated to mention OpenJEV.

## Provider selection rule

1. Explicit choice wins: `options.provider` or the `JEV_PROVIDER` env var
   (`"typesafe"` or `"openjev"`).
2. Otherwise, if a TypeSafe key is available (`apiKey` option,
   `GRAM_RENDER_API_KEY`, or `TYPESAFE_API_KEY`) → TypeSafe (unchanged default).
3. Otherwise, if only `OPENJEV_API_KEY` is set → OpenJEV.

## Configuration

| Variable | Purpose |
|---|---|
| `OPENJEV_API_KEY` | OpenJEV API key (get one at https://openjev.sh/dashboard) |
| `JEV_PROVIDER` | `"openjev"` to force OpenJEV; `"typesafe"` (or unset) for TypeSafe |
| `OPENJEV_BASE_URL` | Override the OpenJEV endpoint (default `https://api.openjev.sh`) |
| `OPENJEV_MODEL` | Override the model id (default `openjev`) |

Or programmatically:

```ts
const evaluate = createEvaluator({ provider: "openjev", apiKey: "your-openjev-key" });
```

## Verification

A live `POST https://api.openjev.sh/v1/systemone` request was made with the
`openjev` model, state `ping`, and one noul question. It returned HTTP 200 with
a valid `answers` object.

## Upstream

Original project: https://github.com/wei-b0/gram-render by @wei-b0.
