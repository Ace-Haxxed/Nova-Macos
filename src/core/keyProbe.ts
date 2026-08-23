/**
 * Key validation for the shells that have no Rust behind them.
 *
 * On the desktop this work happens in `commands/keys.rs`, which owns the
 * canonical endpoint list. Android and iOS have no Tauri process, so the same
 * checks are made here with `fetch` — LLM APIs send permissive CORS headers,
 * which is why the streaming path already falls back to a direct fetch on
 * mobile.
 *
 * These endpoints must stay in step with `probe()` in `commands/keys.rs`.
 * Each is the cheapest request that actually distinguishes a good key from a
 * bad one, which is not the same as the cheapest request: NVIDIA's model
 * listing answers 200 to `nvapi-bogus`, so validating against it would accept
 * anything the user typed.
 */
import type { Provider } from '@/store/keys';

export interface KeyProbeResult {
  ok: boolean;
  message: string;
  latencyMs: number;
}

/** How long a provider gets to answer before we call it unreachable. */
const TIMEOUT_MS = 8_000;

const LABEL: Record<Provider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Gemini',
  groq: 'Groq',
  openrouter: 'OpenRouter',
  nvidia: 'NVIDIA',
  bytez: 'Bytez',
  cloudflare: 'Cloudflare AI',
};

/**
 * OpenRouter's free catalogue, fetched directly.
 *
 * Mirrors `parse_free_models` in `commands/keys.rs`: `:free`, at least 32K of
 * context, and tool support — which is not optional, because the agent loop
 * cannot run without it. Sorted by context descending, ties broken on id, so
 * the first entry is what a fresh install would pick.
 *
 * Returns an empty list on any failure. A dropdown that cannot load is not a
 * reason to fail opening settings.
 */
export async function fetchFreeModels(
  key: string,
): Promise<Array<{ id: string; name: string; context: number; vision: boolean }>> {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers: key ? { Authorization: `Bearer ${key}` } : {},
    });
    if (!response.ok) return [];

    const body = (await response.json()) as {
      data?: Array<Record<string, unknown>>;
    };
    const items = Array.isArray(body.data) ? body.data : [];

    return items
      .filter((m) => {
        const id = typeof m.id === 'string' ? m.id : '';
        if (!id.endsWith(':free')) return false;
        if (typeof m.context_length !== 'number' || m.context_length < 32_000) return false;
        const params = m.supported_parameters;
        return Array.isArray(params) && params.includes('tools');
      })
      .map((m) => {
        const id = m.id as string;
        const architecture = m.architecture as { input_modalities?: unknown } | undefined;
        const modalities = architecture?.input_modalities;
        return {
          id,
          name: typeof m.name === 'string' ? m.name : id,
          context: m.context_length as number,
          vision: Array.isArray(modalities) && modalities.includes('image'),
        };
      })
      .sort((a, b) => b.context - a.context || a.id.localeCompare(b.id));
  } catch {
    return [];
  }
}

/**
 * One row of Cloudflare's model catalogue, shaped for the dropdown.
 */
export interface CloudflareModel {
  id: string;
  name: string;
  /** True when Cloudflare charges no neurons for this model. */
  free: boolean;
}

/**
 * List the text-generation models Cloudflare offers on the free tier.
 *
 * Filtering on `task=text-generation` and a zero `per_unit_input_price`
 * keeps the dropdown to models that work without a paid plan. Returns an
 * empty list on any failure — a dropdown that cannot load is not a reason
 * to fail opening settings, and the provider already has a static default
 * model that will work.
 */
export async function fetchCloudflareModels(
  accountId: string,
  token: string,
): Promise<CloudflareModel[]> {
  const trimmedId = accountId.trim();
  const trimmedToken = token.replace(/\s+/g, '');
  if (!trimmedId || !trimmedToken) return [];
  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(trimmedId)}/ai/models/search?task=text-generation`,
      { headers: { Authorization: `Bearer ${trimmedToken}` } },
    );
    if (!response.ok) return [];
    const body = (await response.json()) as { result?: Array<Record<string, unknown>> };
    const items = Array.isArray(body.result) ? body.result : [];
    const free = items
      .filter((m) => {
        const id = typeof m.id === 'string' ? m.id : '';
        const name = typeof m.name === 'string' ? m.name : id;
        const price = m.pricing as { per_unit_input_price?: unknown } | undefined;
        // "0" and missing both mean free. Anything else is paid.
        const free = price == null || price.per_unit_input_price === 0;
        return Boolean(id) && free && name.toLowerCase().includes('instruct');
      })
      .map((m) => {
        const id = m.id as string;
        const name = typeof m.name === 'string' ? m.name : id;
        return { id, name, free: true };
      })
      .sort((a, b) => a.id.localeCompare(b.id));
    return free;
  } catch {
    return [];
  }
}

/** Build the request that checks a key, mirroring the Rust probe table. */
function request(provider: Provider, key: string): { url: string; init: RequestInit } {
  switch (provider) {
    case 'openai':
      return {
        url: 'https://api.openai.com/v1/models',
        init: { headers: { Authorization: `Bearer ${key}` } },
      };
    case 'anthropic':
      return {
        url: 'https://api.anthropic.com/v1/models',
        init: {
          headers: {
            'x-api-key': key,
            'anthropic-version': '2023-06-01',
            // Required only here: this request really does come from a WebView.
            'anthropic-dangerous-direct-browser-access': 'true',
          },
        },
      };
    case 'gemini':
      return {
        url: 'https://generativelanguage.googleapis.com/v1beta/models',
        init: { headers: { 'x-goog-api-key': key } },
      };
    case 'groq':
      return {
        url: 'https://api.groq.com/openai/v1/models',
        init: { headers: { Authorization: `Bearer ${key}` } },
      };
    case 'openrouter':
      return {
        url: 'https://openrouter.ai/api/v1/key',
        init: { headers: { Authorization: `Bearer ${key}` } },
      };
    case 'nvidia':
      // A one-token completion, because NVIDIA's `/v1/models` is public and
      // returns 200 for any key at all — including none.
      return {
        url: 'https://integrate.api.nvidia.com/v1/chat/completions',
        init: {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'meta/llama-3.1-8b-instruct',
            messages: [{ role: 'user', content: 'hi' }],
            max_tokens: 1,
          }),
        },
      };
    case 'bytez':
      // Bytez wants the bare key, and `list/models` answers 500 even for a
      // good one — `list/tasks` is the endpoint that discriminates.
      return {
        url: 'https://api.bytez.com/models/v2/list/tasks',
        init: { headers: { Authorization: key } },
      };
    case 'cloudflare':
      // Cloudflare's account id + token pair is checked as a unit: a valid
      // token bound to a missing account, or a valid account with no Workers
      // AI permission, both fail the same way. The cheapest authenticating
      // call is a one-token chat completion against the default model.
      throw new Error('cloudflare requires an account id — use probeCloudflare');
  }
}

/**
 * Probe Cloudflare with both the account id and the API token.
 *
 * The single-key probe table above carries one credential, but Cloudflare's
 * endpoint is keyed on the account id (which lives in the URL) and authorised
 * by the token (which lives in the header). Without a way to send both, the
 * generic `probeKey` cannot check it — so this is the dedicated path.
 */
export async function probeCloudflare(
  accountId: string,
  token: string,
): Promise<KeyProbeResult> {
  const trimmedId = accountId.trim();
  const trimmedToken = token.replace(/\s+/g, '');
  if (!trimmedId) return { ok: false, message: 'Account ID is required.', latencyMs: 0 };
  if (!trimmedToken) return { ok: false, message: 'API token is required.', latencyMs: 0 };

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(trimmedId)}/ai/run/@cf/meta/llama-3.1-8b-instruct`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${trimmedToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 1,
        }),
        signal: controller.signal,
      },
    );
    const latencyMs = Date.now() - started;

    if (response.ok) {
      return { ok: true, message: `Connected in ${latencyMs} ms.`, latencyMs };
    }
    // Cloudflare's status codes line up with the failure they actually mean:
    // 401 is a bad token, 403 is a wrong or disabled account id (or the
    // token does not carry Workers AI permission). Reading them off the
    // status line lets the user fix the right field.
    const detail =
      response.status === 401
        ? 'API token was refused. Check you copied the whole thing.'
        : response.status === 403
          ? 'Account ID was rejected, or the token lacks Workers AI permission.'
          : response.status === 429
            ? 'Rate limited — credentials look valid. Try again shortly.'
            : `Cloudflare answered ${response.status}.`;
    return { ok: false, latencyMs, message: detail };
  } catch (e) {
    const latencyMs = Date.now() - started;
    const aborted = e instanceof DOMException && e.name === 'AbortError';
    return {
      ok: false,
      latencyMs,
      message: aborted
        ? 'Cloudflare did not answer in time.'
        : 'Could not reach Cloudflare. Check your internet connection.',
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Check a key against the live provider API.
 *
 * Never throws: a failure to reach the provider is reported as a failed check
 * with an explanation, because the caller is a text field and the user needs
 * to know whether the key was refused or the network was.
 */
export async function probeKey(provider: Provider, key: string): Promise<KeyProbeResult> {
  const trimmed = key.replace(/\s+/g, '');
  if (!trimmed) return { ok: false, message: 'No key entered.', latencyMs: 0 };

  // Cloudflare is the one provider that needs a second credential (account
  // id) the generic probe does not have. The caller knows to use
  // `probeCloudflare` instead; this branch is unreachable in practice but
  // guards against a stray invocation.
  if (provider === 'cloudflare') {
    return {
      ok: false,
      message: 'Cloudflare also needs an Account ID — use Test Connection in Settings.',
      latencyMs: 0,
    };
  }

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const { url, init } = request(provider, trimmed);
    const response = await fetch(url, { ...init, signal: controller.signal });
    const latencyMs = Date.now() - started;

    if (response.ok) {
      return { ok: true, message: `Connected in ${latencyMs} ms.`, latencyMs };
    }
    return {
      ok: false,
      latencyMs,
      message:
        response.status === 401 || response.status === 403
          ? 'That key was refused. Check you copied all of it.'
          : response.status === 429
            ? 'Rate limited — the key looks valid. Try again shortly.'
            : `${LABEL[provider]} answered ${response.status}.`,
    };
  } catch (e) {
    const latencyMs = Date.now() - started;
    const aborted = e instanceof DOMException && e.name === 'AbortError';
    return {
      ok: false,
      latencyMs,
      message: aborted
        ? `${LABEL[provider]} did not answer in time.`
        : `Could not reach ${LABEL[provider]}. Check your internet connection.`,
    };
  } finally {
    clearTimeout(timer);
  }
}
