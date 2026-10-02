import type { CatalogModel, ModelSpec, ProviderDef, ProviderStatus, UiConfig } from "../api";

export const ACCESS_LABEL: Record<string, string> = {
  "cli-login": "CLI con login",
  "cli-key": "CLI con clave",
  api: "API",
};

export const LETTER_CLASS = (k: string) => `p${k}`;

export interface Readiness {
  ok: boolean;
  text: string;
}

/** ¿Está lista esta vía? Revisa CLI instalado, login o clave según el modo de acceso. */
export function readiness(spec: ModelSpec, providers: ProviderDef[], statuses: ProviderStatus[] | null): Readiness {
  if (spec.adapter === "fake") return { ok: true, text: "simulado" };
  if (!statuses) return { ok: true, text: "…" };
  const p = providers.find((x) => x.id === spec.provider);
  const st = statuses.find((x) => x.id === spec.provider);
  if (!p || !st) return { ok: false, text: "proveedor desconocido" };
  if (p.kind === "cli" && st.cli && !st.cli.installed) return { ok: false, text: `${p.binary} no instalado` };
  if (spec.access === "cli-login") {
    if (st.cli?.login === "logged-in") return { ok: true, text: `login ✓${st.cli.loginDetail ? ` · ${st.cli.loginDetail}` : ""}` };
    if (st.cli?.login === "logged-out") return { ok: false, text: "falta iniciar sesión" };
    return { ok: true, text: "login sin confirmar" };
  }
  if (!st.keySet) return { ok: false, text: `falta ${p.keyEnv}` };
  return { ok: true, text: `clave ✓ …${st.keyHint ?? ""}` };
}

function offeringValue(provider?: string, access?: string) {
  return `${provider}:${access}`;
}

export function specFromCatalog(m: CatalogModel, provider: string, access: string, providers: ProviderDef[]): ModelSpec {
  const o = m.offerings.find((x) => x.provider === provider && x.access === access) ?? m.offerings[0];
  const p = providers.find((x) => x.id === o.provider)!;
  return { adapter: p.adapter, provider: o.provider, access: o.access, model: o.model, effort: o.effort, params: o.params, label: m.label, catalogId: m.id };
}

export function ModelPicker({
  config,
  value,
  onChange,
  statuses,
  disabled,
}: {
  config: UiConfig;
  value: ModelSpec;
  onChange: (s: ModelSpec) => void;
  statuses: ProviderStatus[] | null;
  disabled?: boolean;
}) {
  const { catalog, providers } = config;
  const current = catalog.find((m) => m.id === value.catalogId);
  const isCustom = !current && value.adapter !== "fake";
  const r = readiness(value, providers, statuses);

  const pickModel = (id: string) => {
    if (id === "__custom") {
      onChange({ adapter: "openai-compat", provider: "openrouter", access: "api", model: "", label: "Personalizado" });
      return;
    }
    const m = catalog.find((x) => x.id === id)!;
    // Conserva la vía si el nuevo modelo la ofrece; si no, la primera.
    const same = m.offerings.find((o) => o.provider === value.provider && o.access === value.access);
    const o = same ?? m.offerings[0];
    onChange(specFromCatalog(m, o.provider, o.access, providers));
  };

  return (
    <div className="picker">
      <select value={isCustom ? "__custom" : (value.catalogId ?? "")} onChange={(e) => pickModel(e.target.value)} disabled={disabled}>
        {value.adapter === "fake" && <option value="">{value.label}</option>}
        {catalog.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label} · {m.vendor} · ${m.priceIn}/${m.priceOut}
          </option>
        ))}
        <option value="__custom">Otro modelo (id manual)…</option>
      </select>
      {current && (
        <select
          value={offeringValue(value.provider, value.access)}
          onChange={(e) => {
            const [prov, acc] = e.target.value.split(":");
            onChange(specFromCatalog(current, prov, acc, providers));
          }}
          disabled={disabled}
        >
          {current.offerings.map((o) => {
            const p = providers.find((x) => x.id === o.provider);
            return (
              <option key={offeringValue(o.provider, o.access)} value={offeringValue(o.provider, o.access)}>
                {p?.label.replace(/ \(.*\)$/, "") ?? o.provider} · {ACCESS_LABEL[o.access]}
              </option>
            );
          })}
        </select>
      )}
      {isCustom && (
        <>
          <select
            value={value.provider}
            onChange={(e) => {
              const p = providers.find((x) => x.id === e.target.value)!;
              onChange({ ...value, provider: p.id, adapter: p.adapter, access: p.access[0] });
            }}
            disabled={disabled}
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          {(providers.find((p) => p.id === value.provider)?.access.length ?? 0) > 1 && (
            <select value={value.access} onChange={(e) => onChange({ ...value, access: e.target.value as ModelSpec["access"] })} disabled={disabled}>
              {providers
                .find((p) => p.id === value.provider)!
                .access.map((a) => (
                  <option key={a} value={a}>
                    {ACCESS_LABEL[a]}
                  </option>
                ))}
            </select>
          )}
          <input
            placeholder="id del modelo en el proveedor"
            value={value.model}
            onChange={(e) => onChange({ ...value, model: e.target.value.trim(), label: e.target.value.trim() || "Personalizado" })}
            disabled={disabled}
          />
        </>
      )}
      <span className={`badge ${r.ok ? "ok" : "err"}`} title={current?.offerings.find((o) => o.provider === value.provider && o.access === value.access)?.note}>
        {r.text}
      </span>
    </div>
  );
}
