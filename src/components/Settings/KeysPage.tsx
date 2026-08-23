/**
 * Every credential NOVA holds, on one page.
 *
 * Provider tabs down the side, one field for the selected provider. Pasting a
 * key validates it and saves it in the same gesture — there is no separate
 * "save" step to forget, and a key that fails is never stored, so a green dot
 * always means the key worked against the live API.
 */
import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Trash2, X } from 'lucide-react';
import {
  PROVIDERS,
  PROVIDER_CONSOLE,
  PROVIDER_LABEL,
  maskKey,
  useKeys,
  type Provider,
} from '@/store/keys';
import { cn } from '@/lib/utils';
import type { CloudflareModel } from '@/core/keyProbe';

export function KeysPage() {
  const {
    activeProvider,
    model,
    keys,
    status,
    messages,
    saveKey,
    removeKey,
    setActive,
    setModel,
    freeModels,
    freeModelsState,
    loadFreeModels,
  } = useKeys();

  const [tab, setTab] = useState<Provider>(activeProvider);
  const [draft, setDraft] = useState('');
  const [modelDraft, setModelDraft] = useState(model);
  const inputRef = useRef<HTMLInputElement>(null);

  // Switching tabs abandons whatever was half-typed for the previous provider;
  // carrying it across would risk saving a key under the wrong service.
  useEffect(() => {
    setDraft('');
  }, [tab]);

  useEffect(() => {
    setModelDraft(model);
  }, [model]);

  // Fetch the catalogue when the OpenRouter tab is opened rather than on
  // mount: most visits to this page are about a different provider, and the
  // request is wasted for all of them.
  useEffect(() => {
    if (tab === 'openrouter') void loadFreeModels();
  }, [tab, loadFreeModels]);

  const saved = keys[tab] ?? '';
  const state = status[tab] ?? 'unset';

  const submit = async () => {
    if (!draft.trim()) return;
    const ok = await saveKey(tab, draft);
    if (ok) {
      setDraft('');
      // A key that works is almost always the one you want to use.
      if (activeProvider !== tab) void setActive(tab);
    } else {
      inputRef.current?.select();
    }
  };

  return (
    <div className="flex h-full gap-5">
      {/* Provider list. The active one carries a dot so the answer to "which
          brain am I talking to" is visible without opening anything. */}
      <nav className="flex w-40 shrink-0 flex-col gap-0.5">
        {PROVIDERS.map((p) => (
          <button
            key={p}
            onClick={() => setTab(p)}
            className={cn(
              'group flex items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors duration-150',
              tab === p
                ? 'bg-accent/12 text-accent'
                : 'text-muted-foreground hover:bg-white/5 hover:text-foreground',
            )}
          >
            <span className="flex items-center gap-2">
              {PROVIDER_LABEL[p]}
              {activeProvider === p && (
                <span className="text-[9px] uppercase tracking-wider text-accent/70">active</span>
              )}
              {p === 'cloudflare' && (
                <span className="text-[9px] uppercase tracking-wider text-accent/60">Free</span>
              )}
            </span>
            <StatusDot state={status[p] ?? 'unset'} />
          </button>
        ))}
      </nav>

      <div className="min-w-0 flex-1 space-y-5">
        {tab === 'cloudflare' ? (
          <CloudflareTab
            state={state}
            onActive={() => void setActive('cloudflare')}
            activeProvider={activeProvider}
          />
        ) : (
          <>
            <div>
              <h3 className="text-sm font-medium text-foreground">{PROVIDER_LABEL[tab]}</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Key from{' '}
                <span className="font-mono text-accent/80">{PROVIDER_CONSOLE[tab]}</span>
              </p>
            </div>

            {saved && !draft ? (
              <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
                <StatusDot state={state} />
                <code className="flex-1 font-mono text-xs text-foreground/90">{maskKey(saved)}</code>
                <button
                  onClick={() => {
                    setDraft(' ');
                    setTimeout(() => {
                      setDraft('');
                      inputRef.current?.focus();
                    }, 0);
                  }}
                  className="text-xs text-muted-foreground transition-colors duration-150 hover:text-accent"
                >
                  Replace
                </button>
                <button
                  onClick={() => void removeKey(tab)}
                  aria-label={`Remove ${PROVIDER_LABEL[tab]} key`}
                  className="text-muted-foreground transition-colors duration-150 hover:text-danger"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <input
                  ref={inputRef}
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={`Paste your ${PROVIDER_LABEL[tab]} key`}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void submit();
                    if (e.key === 'Escape') setDraft('');
                  }}
                  className="h-10 flex-1 rounded-xl border border-white/10 bg-white/[0.03] px-4 font-mono
                    text-xs text-foreground outline-none transition-colors duration-150
                    placeholder:text-muted-foreground/60 focus:border-accent/50"
                />
                <button
                  onClick={() => void submit()}
                  disabled={!draft.trim() || state === 'checking'}
                  className="h-10 rounded-xl bg-accent/15 px-4 text-xs font-medium text-accent
                    transition-colors duration-150 hover:bg-accent/25 disabled:opacity-40"
                >
                  {state === 'checking' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    'Save'
                  )}
                </button>
              </div>
            )}

            {messages[tab] && (
              <p
                className={cn(
                  'text-xs',
                  state === 'failed' ? 'text-danger' : 'text-muted-foreground',
                )}
              >
                {messages[tab]}
              </p>
            )}

            {/* The model travels with the provider, so it belongs on this page
                rather than in a separate section the user has to go and find. */}
            <div className="space-y-2 border-t border-white/[0.06] pt-5">
              <label className="text-xs text-muted-foreground">Model</label>

              {/* OpenRouter publishes a live catalogue, so the model is chosen from
                  what is actually being served rather than typed from memory — a
                  withdrawn id is the difference between working and a 404. Every
                  other provider keeps the free-text field. */}
              {tab === 'openrouter' && freeModelsState !== 'failed' ? (
                <>
                  <select
                    value={model}
                    onChange={(e) => void setModel(e.target.value)}
                    disabled={freeModelsState === 'loading'}
                    className="h-10 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3
                      font-mono text-xs text-foreground outline-none transition-colors duration-150
                      focus:border-accent/50 disabled:opacity-50"
                  >
                    {freeModelsState === 'loading' && <option>Loading free models…</option>}

                    {/* No model resolved yet — the catalogue has not answered, or
                        it answered and nothing qualified. Better an empty slot
                        than an id we made up. */}
                    {freeModelsState === 'ready' && !model && (
                      <option value="">Pick a model</option>
                    )}

                    {/* The model in use may be paid, or may have left the free
                        list; it still has to appear or the select would silently
                        show something else as selected. */}
                    {freeModelsState === 'ready' &&
                      Boolean(model) &&
                      !freeModels.some((m) => m.id === model) && (
                        <option value={model}>{model} — no longer listed</option>
                      )}

                    {/* Id, not display name: the id is what goes over the wire and
                        what an error message will quote back. Already sorted
                        largest context first by Rust. */}
                    {freeModels.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.tier ? `[${m.tier}] ` : ''}
                        {m.id} — {formatContext(m.context)} ctx
                        {m.vision ? ' · vision' : ''}
                      </option>
                    ))}
                  </select>

                  <p className="text-[11px] text-muted-foreground">
                    Free tool-capable models, read from OpenRouter just now, largest context
                    first.{' '}
                    <span className="text-foreground/70">Smart</span> is 70B+ parameters,{' '}
                    <span className="text-foreground/70">Balanced</span> 3–70B,{' '}
                    <span className="text-foreground/70">Fast</span> under 3B.
                  </p>
                </>
              ) : (
                <input
                  value={modelDraft}
                  onChange={(e) => setModelDraft(e.target.value)}
                  onBlur={() => modelDraft !== model && void setModel(modelDraft)}
                  onKeyDown={(e) => e.key === 'Enter' && void setModel(modelDraft)}
                  spellCheck={false}
                  className="h-10 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 font-mono
                    text-xs text-foreground outline-none transition-colors duration-150
                    focus:border-accent/50"
                />
              )}

              {tab === 'openrouter' && freeModelsState === 'failed' && (
                <p className="text-[11px] text-risk-medium">
                  Could not reach OpenRouter to list its free models. Reopen this page to try
                  again, or type an id from openrouter.ai/models — NOVA does not suggest one,
                  because the free catalogue rotates and any id named here would go stale.
                </p>
              )}

              {tab === 'bytez' && (
                <p className="text-[11px] text-muted-foreground">
                  Bytez model ids look like{' '}
                  <span className="font-mono">google/gemma-2-9b-it</span>. An id they do not host
                  is refused with a 404.
                </p>
              )}
            </div>

            {activeProvider !== tab && keys[tab] && (
              <button
                onClick={() => void setActive(tab)}
                className="text-xs text-accent transition-colors duration-150 hover:underline"
              >
                Use {PROVIDER_LABEL[tab]} for new messages
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The Cloudflare tab has two fields (Account ID + API Token) and a model
 * dropdown that fetches the live free catalogue. Carving it out keeps the
 * single-key tab above readable.
 */
function CloudflareTab({
  state,
  activeProvider,
  onActive,
}: {
  state: string;
  activeProvider: Provider;
  onActive: () => void;
}) {
  const { keys, removeKey, status, model, setModel, messages } = useKeys();
  const [accountDraft, setAccountDraft] = useState('');
  const [tokenDraft, setTokenDraft] = useState('');
  const [cloudModels, setCloudModels] = useState<CloudflareModel[]>([]);
  const [cloudModelsState, setCloudModelsState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [testing, setTesting] = useState(false);
  const [testMessage, setTestMessage] = useState('');
  const tokenInputRef = useRef<HTMLInputElement>(null);

  // Stored under the `cloudflare` slot (the token) and in the LLM config
  // (the account id). The token is the credential; the account id is part
  // of the URL. Both have to be present for a request to go out, and
  // neither alone is enough to call the API.
  const savedToken = keys['cloudflare'] ?? '';

  // The account id is carried in `settings.llm.apiKeyExtra.cloudflareAccountId`
  // rather than in the keys map because the keys map is keyed on the
  // credential that proves an account, and the account id is the URL
  // portion of the credential — semantically different.
  const accountId = useCloudflareAccountId();
  const setAccountId = useSetCloudflareAccountId();

  useEffect(() => {
    setAccountDraft(accountId);
  }, [accountId]);

  const refresh = async () => {
    if (!accountId.trim() || !savedToken.trim()) {
      setCloudModelsState('idle');
      return;
    }
    setCloudModelsState('loading');
    try {
      const { fetchCloudflareModels } = await import('@/core/keyProbe');
      const list = await fetchCloudflareModels(accountId, savedToken);
      if (list.length > 0) {
        setCloudModels(list);
        setCloudModelsState('ready');
      } else {
        setCloudModelsState('failed');
      }
    } catch {
      setCloudModelsState('failed');
    }
  };

  // Pull the catalogue when both credentials are present and the tab opens.
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, savedToken]);

  const submit = async () => {
    const idOk = accountDraft.trim().length > 0;
    const tokenOk = tokenDraft.replace(/\s+/g, '').length > 0;
    if (!idOk || !tokenOk) return;
    setAccountId(accountDraft.trim());
    // Reuse the regular key pipeline; the probe function for cloudflare
    // additionally checks the account id against the live API.
    setTesting(true);
    setTestMessage('');
    try {
      const { probeCloudflare } = await import('@/core/keyProbe');
      const result = await probeCloudflare(accountDraft.trim(), tokenDraft);
      if (!result.ok) {
        setTestMessage(result.message);
        setTesting(false);
        return;
      }
      // Persist token via the standard store. saveKey triggers `validate_key`
      // server-side — that path does not know about cloudflare yet, so we
      // bypass it and write the keys directly.
      const { useKeys: keys } = await import('@/store/keys');
      await keys.getState().saveKey('cloudflare', tokenDraft);
      setTestMessage(`Connected in ${result.latencyMs} ms.`);
      setTokenDraft('');
      if (activeProvider !== 'cloudflare') onActive();
    } catch (e) {
      setTestMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  };

  const onRemove = async () => {
    setAccountId('');
    await removeKey('cloudflare');
    setTestMessage('');
  };

  const hasSaved = savedToken.trim().length > 0 && accountId.trim().length > 0;

  return (
    <>
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-medium text-foreground">Cloudflare AI</h3>
        <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] uppercase tracking-wider text-accent">
          Free
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Free tier: 10,000 neurons/day. Account ID + API token from{' '}
        <span className="font-mono text-accent/80">dash.cloudflare.com</span>.
      </p>

      <div className="space-y-3">
        <div>
          <label className="text-xs text-muted-foreground">Account ID</label>
          <input
            type="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="32-character hex string"
            value={accountDraft}
            onChange={(e) => setAccountDraft(e.target.value)}
            className="mt-1 h-10 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 font-mono
              text-xs text-foreground outline-none transition-colors duration-150
              placeholder:text-muted-foreground/60 focus:border-accent/50"
          />
        </div>

        <div>
          <label className="text-xs text-muted-foreground">API Token</label>
          {savedToken && !tokenDraft ? (
            <div className="mt-1 flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
              <StatusDot state={state} />
              <code className="flex-1 font-mono text-xs text-foreground/90">{maskKey(savedToken)}</code>
              <button
                onClick={() => {
                  setTokenDraft(' ');
                  setTimeout(() => {
                    setTokenDraft('');
                    tokenInputRef.current?.focus();
                  }, 0);
                }}
                className="text-xs text-muted-foreground transition-colors duration-150 hover:text-accent"
              >
                Replace
              </button>
              <button
                onClick={() => void onRemove()}
                aria-label="Remove Cloudflare credentials"
                className="text-muted-foreground transition-colors duration-150 hover:text-danger"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <input
              ref={tokenInputRef}
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="Workers AI template token"
              value={tokenDraft}
              onChange={(e) => setTokenDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit();
                if (e.key === 'Escape') setTokenDraft('');
              }}
              className="mt-1 h-10 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 font-mono
                text-xs text-foreground outline-none transition-colors duration-150
                placeholder:text-muted-foreground/60 focus:border-accent/50"
            />
          )}
        </div>

        <button
          onClick={() => void submit()}
          disabled={
            testing ||
            accountDraft.trim().length === 0 ||
            tokenDraft.replace(/\s+/g, '').length === 0
          }
          className="h-10 rounded-xl bg-accent/15 px-4 text-xs font-medium text-accent
            transition-colors duration-150 hover:bg-accent/25 disabled:opacity-40"
        >
          {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Test Connection'}
        </button>

        {testMessage && (
          <p
            className={cn(
              'text-xs',
              state === 'failed' ? 'text-danger' : 'text-muted-foreground',
            )}
          >
            {testMessage}
          </p>
        )}
        {!testMessage && messages['cloudflare'] && (
          <p
            className={cn(
              'text-xs',
              status['cloudflare'] === 'failed' ? 'text-danger' : 'text-muted-foreground',
            )}
          >
            {messages['cloudflare']}
          </p>
        )}
      </div>

      <div className="space-y-2 border-t border-white/[0.06] pt-5">
        <label className="text-xs text-muted-foreground">Model</label>
        {cloudModelsState === 'failed' ? (
          <>
            <input
              value={model}
              onChange={(e) => void setModel(e.target.value)}
              spellCheck={false}
              placeholder="@cf/meta/llama-3.1-8b-instruct"
              className="h-10 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 font-mono
                text-xs text-foreground outline-none transition-colors duration-150
                focus:border-accent/50"
            />
            <p className="text-[11px] text-muted-foreground">
              Could not load the live free catalogue. Type any{' '}
              <span className="font-mono">@cf/…</span> instruct id from
              developers.cloudflare.com — it must be one Cloudflare serves on
              the free tier.
            </p>
          </>
        ) : (
          <>
            <select
              value={model}
              onChange={(e) => void setModel(e.target.value)}
              disabled={cloudModelsState === 'loading'}
              className="h-10 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3
                font-mono text-xs text-foreground outline-none transition-colors duration-150
                focus:border-accent/50 disabled:opacity-50"
            >
              {cloudModelsState === 'loading' && <option>Loading free models…</option>}
              {cloudModelsState === 'ready' && !model && (
                <option value="">Pick a model</option>
              )}
              {cloudModelsState === 'ready' &&
                Boolean(model) &&
                !cloudModels.some((m) => m.id === model) && (
                  <option value={model}>{model} — not in free catalogue</option>
                )}
              {cloudModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id} — {m.name}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-muted-foreground">
              Free-tier instruct models served by Cloudflare. The 8B Llama is
              the default — bigger models are slower and still cost the same
              neurons per token.
            </p>
          </>
        )}
      </div>

      {hasSaved && activeProvider !== 'cloudflare' && (
        <button
          onClick={onActive}
          className="text-xs text-accent transition-colors duration-150 hover:underline"
        >
          Use Cloudflare AI for new messages
        </button>
      )}
    </>
  );
}

/* ── Cloudflare account id plumbing ──────────────────────────────── */

import { useSettings } from '@/store/settings';

/**
 * Read the Cloudflare account id out of `settings.llm.apiKeyExtra`.
 *
 * It lives in the LLM config rather than in the keys map because the keys
 * map is keyed on the credential that proves an account, and the account id
 * is the URL portion of the credential — semantically different.
 */
function useCloudflareAccountId(): string {
  return useSettings((s) => s.settings.llm.apiKeyExtra?.cloudflareAccountId ?? '');
}

function useSetCloudflareAccountId(): (id: string) => void {
  return useSettings((s) => (value: string) => {
    s.updateLLM({
      apiKeyExtra: {
        ...s.settings.llm.apiKeyExtra,
        cloudflareAccountId: value,
      },
    });
  });
}

function StatusDot({ state }: { state: string }) {
  if (state === 'checking') {
    return <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />;
  }
  if (state === 'ok') return <Check className="h-3 w-3 text-accent" />;
  if (state === 'failed') return <X className="h-3 w-3 text-danger" />;
  return <span className="h-1.5 w-1.5 rounded-full bg-white/15" />;
}

/** 262144 -> "262K". The exact number is noise next to the magnitude. */
function formatContext(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 ? 1 : 0)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
  return String(tokens);
}
