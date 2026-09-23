import type { AdapterId, ModelSpec } from "../types.js";
import type { Adapter, AdapterRegistry } from "./types.js";

export class Registry implements AdapterRegistry {
  private adapters = new Map<AdapterId, Adapter>();

  constructor(adapters: Adapter[] = []) {
    for (const a of adapters) this.adapters.set(a.id, a);
  }

  register(adapter: Adapter): this {
    this.adapters.set(adapter.id, adapter);
    return this;
  }

  get(spec: ModelSpec): Adapter {
    const a = this.adapters.get(spec.adapter);
    if (!a) throw new Error(`No hay adaptador registrado para "${spec.adapter}" (modelo ${spec.model})`);
    return a;
  }
}
