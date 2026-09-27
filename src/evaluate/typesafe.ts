import { z } from "zod";
import { EvaluatorError } from "../errors.js";
import type { Evaluator, EvaluationResult } from "./types.js";

/**
 * Default evaluator: a minimal HTTP adapter for the TypeSafe System One API
 * (POST /v1/systemone). Hand-rolled — no SDK dependency — so `gram-render`
 * ships with zod as its only runtime dependency. A custom evaluator (Vercel
 * AI Gateway, Cloudflare Workers AI, or a test mock) can be injected instead
 * via the `evaluate` option.
 */

export interface EvaluatorOptions {
  /**
   * Jev provider: `"typesafe"` (default) or `"openjev"` (a free community
   * gateway to the same Jev model). When omitted, the `JEV_PROVIDER` env var
   * is consulted; otherwise the provider is inferred from which key is set
   * (TypeSafe if `apiKey` / `GRAM_RENDER_API_KEY` / `TYPESAFE_API_KEY` is
   * set; OpenJEV if only `OPENJEV_API_KEY` is set).
   */
  provider?: "typesafe" | "openjev";
  /**
   * API key. For TypeSafe this is the `apikey_…` key (defaults to
   * GRAM_RENDER_API_KEY or TYPESAFE_API_KEY). For OpenJEV this is the
   * OpenJEV key (defaults to OPENJEV_API_KEY).
   */
  apiKey?: string;
  /**
   * Base URL. Defaults to https://api.typesafe.ai (or TYPESAFE_BASE_URL) for
   * TypeSafe, https://api.openjev.sh (or OPENJEV_BASE_URL) for OpenJEV.
   */
  baseURL?: string;
  /**
   * Model id or alias. Defaults to `jev-latest` (or TYPESAFE_DEFAULT_MODEL)
   * for TypeSafe, `openjev` for OpenJEV.
   */
  model?: string;
  /** Per-call timeout in ms. Default 10 000. */
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}

const responseSchema = z.object({
  model: z.string().optional(),
  answers: z.record(
    z.string(),
    z.object({
      type: z.string(),
      choice: z.string().optional(),
      probabilities: z.record(z.string(), z.number()).optional(),
      confidence: z.number().min(0).max(1).optional(),
    }),
  ),
  usage: z
    .object({ input_tokens: z.number().optional(), output_tokens: z.number().optional() })
    .optional(),
});

export function createEvaluator(options: EvaluatorOptions = {}): Evaluator {
  // --- Provider selection (TypeSafe stays default) -----------------------------
  // 1. Explicit choice wins: options.provider or JEV_PROVIDER env var.
  // 2. Otherwise, if a TypeSafe key is available → TypeSafe (unchanged default).
  // 3. Otherwise, if only OPENJEV_API_KEY is set → OpenJEV.
  const typesafeKey = options.apiKey ?? process.env["GRAM_RENDER_API_KEY"] ?? process.env["TYPESAFE_API_KEY"];
  const openjevKey = options.apiKey ?? process.env["OPENJEV_API_KEY"];
  const provider =
    options.provider ??
    (process.env["JEV_PROVIDER"] as "typesafe" | "openjev" | undefined) ??
    (typesafeKey ? "typesafe" : openjevKey ? "openjev" : "typesafe");

  let apiKey: string;
  let baseURL: string;
  let model: string;
  if (provider === "openjev") {
    apiKey = options.apiKey ?? process.env["OPENJEV_API_KEY"] ?? "";
    if (!apiKey) {
      throw new Error(
        "No OpenJEV API key. Pass `apiKey` to createEvaluator, or set the OPENJEV_API_KEY environment variable. Keys: https://openjev.sh/dashboard",
      );
    }
    baseURL = (options.baseURL ?? process.env["OPENJEV_BASE_URL"] ?? "https://api.openjev.sh").replace(/\/+$/, "");
    model = options.model ?? process.env["OPENJEV_MODEL"] ?? "openjev";
  } else {
    apiKey = typesafeKey ?? "";
    if (!apiKey) {
      throw new Error(
        "No TypeSafe API key. Pass `apiKey` to createEvaluator, or set the GRAM_RENDER_API_KEY (or TYPESAFE_API_KEY) environment variable. Keys: https://console.typesafe.ai/settings/keys",
      );
    }
    baseURL = (options.baseURL ?? process.env["TYPESAFE_BASE_URL"] ?? "https://api.typesafe.ai").replace(/\/+$/, "");
    model = options.model ?? process.env["TYPESAFE_DEFAULT_MODEL"] ?? "jev-latest";
  }
  const timeoutMs = options.timeoutMs ?? 10_000;
  const doFetch = options.fetch ?? globalThis.fetch;

  return async ({ state, questions, signal }) => {
    const signals: AbortSignal[] = signal ? [signal, AbortSignal.timeout(timeoutMs)] : [AbortSignal.timeout(timeoutMs)];
    const timeoutSignal = signals.length === 1 ? signals[0]! : AbortSignal.any(signals);

    let response: Response;
    try {
      response = await doFetch(`${baseURL}/v1/systemone`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model, state, questions }),
        signal: timeoutSignal,
      });
    } catch (cause) {
      if (signal?.aborted) throw signal.reason;
      throw new EvaluatorError("Evaluation request failed before a response arrived (timeout or connection error).", { cause });
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const hint =
        response.status === 401
          ? provider === "openjev"
            ? " Check your OpenJEV API key."
            : " Check your TypeSafe API key."
          : response.status === 429
            ? " Rate limited — retry later."
            : response.status === 503
              ? " Service unavailable — retry later."
              : "";
      throw new EvaluatorError(`Evaluation request failed (HTTP ${response.status}).${hint}`, { status: response.status, cause: body });
    }

    let parsed: z.infer<typeof responseSchema>;
    try {
      parsed = responseSchema.parse(await response.json());
    } catch (cause) {
      throw new EvaluatorError("Evaluator returned a malformed response.", { cause });
    }

    const answers: EvaluationResult["answers"] = {};
    for (const [name, answer] of Object.entries(parsed.answers)) {
      if (answer.type !== "choice" || answer.choice === undefined) {
        throw new EvaluatorError(`Evaluator returned a non-choice answer for question "${name}".`, { cause: answer });
      }
      answers[name] = {
        choice: answer.choice,
        confidence: answer.confidence,
        probabilities: answer.probabilities,
      };
    }

    return {
      answers,
      usage: parsed.usage?.input_tokens !== undefined ? { inputTokens: parsed.usage.input_tokens } : undefined,
      model: parsed.model,
    };
  };
}
