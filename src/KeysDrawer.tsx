import { useEffect, useState } from "react";
import { getAiKeys, listAiModels, saveAiKeys, type AiKeysView, type AiModelList } from "./api";

type ModelListState = AiModelList & { loading?: boolean };
const CUSTOM = "__custom__";

/** Writing model picker: the provider's live list, with "type your own" as an escape hatch. */
function ModelPicker({ value, list, placeholder, onChange, onRefresh }: {
  value: string; list?: ModelListState; placeholder: string;
  onChange: (model: string) => void; onRefresh: () => void;
}) {
  const [typing, setTyping] = useState(false);
  const known = list ? [...list.recommended, ...list.models] : [];
  const listed = known.includes(value);
  const showInput = typing || !listed;
  return <>
    <label>Model
      <div className="model-picker">
        <select value={showInput ? CUSTOM : value} disabled={list?.loading} onChange={(event) => {
          if (event.target.value === CUSTOM) { setTyping(true); return; }
          setTyping(false); onChange(event.target.value);
        }}>
          {list?.loading && <option value={CUSTOM}>Loading models…</option>}
          {!list?.loading && list?.recommended.length ? <optgroup label="Recommended for songs">{list.recommended.map((model) => <option key={model} value={model}>{model}{model === list.default ? " (default)" : ""}</option>)}</optgroup> : null}
          {!list?.loading && list?.models.length ? <optgroup label="All writing models">{list.models.map((model) => <option key={model} value={model}>{model}{model === list.default ? " (default)" : ""}</option>)}</optgroup> : null}
          {!list?.loading && <option value={CUSTOM}>{!listed && value ? `Typed: ${value}` : "Type a model ID…"}</option>}
        </select>
        <button type="button" className="model-refresh" title="Reload this provider's model list" aria-label="Reload model list" disabled={list?.loading} onClick={onRefresh}>↻</button>
      </div>
    </label>
    {showInput && <input className="model-typed" aria-label="Model ID" spellCheck={false} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />}
    {list?.error && <small className="model-note warn">{list.error}</small>}
    {!list?.loading && !list?.error && known.length > 0 && value && !listed && <small className="model-note warn">This model isn't in the provider's current list. Songs may fail unless the ID is exactly right.</small>}
    {!list?.loading && !list?.error && known.length > 0 && <small className="model-note">{known.length} writing models available. Image, speech, and embedding models are hidden.</small>}
  </>;
}


const ORDER = ["writing", "images", "video"] as const;

function providerLabel(view: AiKeysView, id: string) {
  if (id === "local") return "Local (no cloud)";
  return view.catalog.providers[id]?.label ?? view.providers[id]?.label ?? id;
}

export default function KeysDrawer({
  open, onClose, width, onResizeStart,
}: { open: boolean; onClose: () => void; width: number; onResizeStart: (event: React.PointerEvent) => void }) {
  const [view, setView] = useState<AiKeysView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [drafts, setDrafts] = useState<Record<string, { enabled: boolean; provider: string; model: string; key: string; base_url: string }>>({});
  const [modelLists, setModelLists] = useState<Record<string, ModelListState>>({});

  const loadModels = async (provider: string, key = "", baseUrl = "") => {
    if (!provider || provider === "local") return;
    setModelLists((current) => ({ ...current, [provider]: { ...(current[provider] ?? { provider, default: "", models: [], recommended: [] }), loading: true, error: undefined } }));
    try {
      const list = await listAiModels({ provider, key: key.trim(), base_url: baseUrl.trim() });
      setModelLists((current) => ({ ...current, [provider]: { ...list, loading: false } }));
    } catch (reason: any) {
      setModelLists((current) => ({ ...current, [provider]: { provider, default: "", models: [], recommended: [], loading: false, error: reason?.message ?? String(reason) } }));
    }
  };

  const load = async () => {
    try {
      const next = await getAiKeys();
      setView(next);
      setDrafts(Object.fromEntries(ORDER.map((id) => {
        const cap = next.capabilities[id];
        const provider = cap?.provider ?? "local";
        return [id, {
          enabled: cap?.enabled ?? false,
          provider,
          model: cap?.model ?? (provider === "ollama" ? "gemma3:4b" : ""),
          key: "",
          base_url: next.providers.ollama?.base_url || "http://127.0.0.1:11434/v1",
        }];
      })));
      const writingProvider = next.capabilities.writing?.provider;
      if (writingProvider && writingProvider !== "local") void loadModels(writingProvider, "", next.providers.ollama?.base_url || "");
      setError("");
    } catch (reason: any) {
      setError(reason?.message ?? String(reason));
    }
  };

  useEffect(() => { if (open) void load(); }, [open]);

  if (!open) return null;

  const saveCategory = async (id: string) => {
    const draft = drafts[id]; if (!draft || !view) return;
    setBusy(id); setError("");
    try {
      const providers: Record<string, { key?: string; base_url?: string; clear?: boolean }> = {};
      if (draft.provider === "ollama") {
        providers.ollama = { base_url: draft.base_url.trim(), key: draft.key.trim() || "ollama" };
      } else if (draft.provider !== "local" && draft.key.trim()) {
        providers[draft.provider] = { key: draft.key.trim() };
      }
      const next = await saveAiKeys({
        providers,
        capabilities: { [id]: { enabled: draft.enabled, provider: draft.provider, model: draft.model.trim() } },
      });
      setView(next);
      setDrafts((current) => ({ ...current, [id]: {
        ...draft,
        key: "",
        enabled: next.capabilities[id]?.enabled ?? draft.enabled,
        provider: next.capabilities[id]?.provider ?? draft.provider,
        model: next.capabilities[id]?.model ?? draft.model,
        base_url: next.providers.ollama?.base_url || draft.base_url,
      } }));
    } catch (reason: any) {
      setError(reason?.message ?? String(reason));
    } finally { setBusy(""); }
  };

  const clearKey = async (provider: string) => {
    setBusy(provider); setError("");
    try {
      const next = await saveAiKeys({ providers: { [provider]: { clear: true } } });
      setView(next);
      await load();
    } catch (reason: any) {
      setError(reason?.message ?? String(reason));
    } finally { setBusy(""); }
  };

  return <aside className="keys-drawer left-drawer" style={{ width }}>
    <div className="drawer-resizer right" role="separator" aria-label="Resize API Keys panel" onPointerDown={onResizeStart} />
    <div className="drawer-head"><div><div className="eyebrow">API KEYS</div><h2>Helpers</h2></div><button aria-label="Close API Keys" onClick={onClose}>✕</button></div>
    <p className="drawer-note">Saving a key does nothing by itself. Check <b>Enable</b> on a category only when you want that helper. Uncheck it any time. Local YuE2, covers, and Video Studio stay the default.</p>
    {error && <div className="error">{error}</div>}
    {!view && !error && <p className="drawer-note">Loading saved keys…</p>}
    {view && ORDER.map((id) => {
      const spec = view.catalog.capabilities[id];
      const draft = drafts[id]; if (!spec || !draft) return null;
      const selected = view.providers[draft.provider];
      const isLocalLlm = draft.provider === "ollama";
      const hasKey = draft.provider === "local" ? false : Boolean(selected?.configured);
      const canEnable = draft.provider !== "local" && (isLocalLlm ? Boolean(draft.base_url.trim() || selected?.base_url) : (hasKey || Boolean(draft.key.trim())));
      return <section className="keys-category" key={id}>
        <div className="keys-category-head">
          <strong>{spec.label}</strong>
          <span>{draft.enabled ? (isLocalLlm ? "Enabled — Local LLM" : "Enabled — cloud actions can spend credits") : hasKey ? (isLocalLlm ? "Server saved · still off" : "Key saved · still off") : "Local / manual only"}</span>
        </div>
        <p>{spec.blurb}</p>
        {spec.how && <ul className="keys-how">{spec.how.rules.slice(0, 4).map((rule) => <li key={rule}>{rule}</li>)}</ul>}
        <label>Provider
          <select value={draft.provider} onChange={(event) => {
            const provider = event.target.value;
            const switchingToLocal = provider === "ollama";
            setDrafts((current) => ({ ...current, [id]: {
              ...draft,
              provider,
              enabled: provider === "local" ? false : draft.enabled,
              key: "",
              // Writing: never carry one provider's model over to another.
              model: id === "writing"
                ? (view.capabilities[id]?.provider === provider ? view.capabilities[id].model : (view.catalog.default_models?.[provider] ?? ""))
                : switchingToLocal ? (view.capabilities[id]?.provider === "ollama" ? draft.model : "gemma3:4b") : (provider === "gemini" ? "gemini-3.6-flash" : draft.model),
              base_url: switchingToLocal ? (view.providers.ollama?.base_url || draft.base_url || "http://127.0.0.1:11434/v1") : draft.base_url,
            } }));
            if (id === "writing" && provider !== "local") void loadModels(provider, "", view.providers.ollama?.base_url || draft.base_url);
          }}>
            {spec.providers.map((provider) => <option value={provider} key={provider}>{providerLabel(view, provider)}{provider !== "local" && view.providers[provider]?.configured ? " · saved" : ""}</option>)}
          </select>
        </label>
        <label className="switch keys-enable" title={canEnable ? (isLocalLlm ? "Allow writing via the Local LLM server" : "Allow this category to call the cloud") : (isLocalLlm ? "Save the server URL first" : "Save a cloud key first")}>
          <input type="checkbox" checked={draft.enabled} disabled={!canEnable && !draft.enabled} onChange={(event) => setDrafts((current) => ({ ...current, [id]: { ...draft, enabled: event.target.checked } }))} />
          <span />{isLocalLlm ? "Enable Local LLM writing" : `Enable cloud for ${spec.label.toLowerCase()}`}
        </label>
        <small>{isLocalLlm ? "Off = current tools only. On = one request at a time to this server. No cloud credits." : "Off = current tools only. On = you may spend this provider’s credits when you press a button."}</small>
        {isLocalLlm && <>
          <label>Server URL (Ollama IP and port)
            <input type="url" autoComplete="off" spellCheck={false} value={draft.base_url} placeholder="http://127.0.0.1:11434/v1" onChange={(event) => setDrafts((current) => ({ ...current, [id]: { ...draft, base_url: event.target.value } }))} onBlur={() => void loadModels("ollama", draft.key, draft.base_url)} />
          </label>
          <small>Use this computer or a private-network address, for example <code>http://192.168.x.x:11434/v1</code>. OpenAI-compatible <code>/v1</code> endpoint.</small>
          <ModelPicker value={draft.model} list={modelLists.ollama} placeholder="gemma3:4b"
            onChange={(model) => setDrafts((current) => ({ ...current, [id]: { ...current[id], model } }))}
            onRefresh={() => void loadModels("ollama", draft.key, draft.base_url)} />
          <small>Gemma 3 4B is the recommended Live default. Aya Expanse is CC BY-NC — personal use only.</small>
          <label>API key (optional)
            <input type="password" autoComplete="off" spellCheck={false} value={draft.key} placeholder={selected?.configured ? `Saved ·••••${selected.last4}` : "ollama"} onChange={(event) => setDrafts((current) => ({ ...current, [id]: { ...draft, key: event.target.value } }))} />
          </label>
          {selected?.configured && <button type="button" className="keys-clear" disabled={Boolean(busy)} onClick={() => void clearKey("ollama")}>Remove saved Local LLM server</button>}
        </>}
        {draft.provider !== "local" && !isLocalLlm && <>
          <label>API key
            <input type="password" autoComplete="off" spellCheck={false} value={draft.key} placeholder={selected?.configured ? `Saved ·••••${selected.last4}` : "Paste key — it is never shown again"} onChange={(event) => setDrafts((current) => ({ ...current, [id]: { ...draft, key: event.target.value } }))} onBlur={() => { if (id === "writing" && draft.key.trim()) void loadModels(draft.provider, draft.key); }} />
          </label>
          {id === "writing"
            ? <ModelPicker key={draft.provider} value={draft.model} list={modelLists[draft.provider]} placeholder={view.catalog.default_models?.[draft.provider] || "Default model"}
                onChange={(model) => setDrafts((current) => ({ ...current, [id]: { ...current[id], model } }))}
                onRefresh={() => void loadModels(draft.provider, draft.key)} />
            : <label>Model<input value={draft.model} onChange={(event) => setDrafts((current) => ({ ...current, [id]: { ...draft, model: event.target.value } }))} placeholder={draft.provider === "gemini" ? "gemini-3.6-flash" : "Default model"} /></label>}
          {selected?.configured && <button type="button" className="keys-clear" disabled={Boolean(busy)} onClick={() => void clearKey(draft.provider)}>Remove saved {providerLabel(view, draft.provider)} key</button>}
        </>}
        <button type="button" className="system-action" disabled={busy === id} onClick={() => void saveCategory(id)}>{busy === id ? "Saving…" : "Save this category"}</button>
      </section>;
    })}
  </aside>;
}
