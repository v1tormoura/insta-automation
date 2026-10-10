import {
  defaultSettings,
  effectiveSettings,
  processingSettingsSchema,
  type ProcessingMode,
  type ProcessingSettings,
} from '@mediaforge/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

export type Scope = 'common' | 'individual';

interface PersistedState {
  selected: string[];
  focusAssetId: string | null;
  scope: Scope;
  settings: ProcessingSettings;
  perAsset: Record<string, ProcessingSettings>;
  profiles: string[];
}

export interface Workspace extends PersistedState {
  /** Configurações sendo editadas agora (comum ou do arquivo em foco). */
  activeSettings: ProcessingSettings;
  editingIndividual: boolean;
  toggleSelected(id: string): void;
  setSelected(ids: string[]): void;
  setFocus(id: string | null): void;
  setScope(scope: Scope): void;
  setMode(mode: ProcessingMode): void;
  /** Altera as configurações ativas por meio de uma função que muta um rascunho. */
  update(mutator: (draft: ProcessingSettings) => void): void;
  replaceSettings(s: ProcessingSettings): void;
  resetIndividual(id: string): void;
  setProfiles(ids: string[]): void;
  toggleProfile(id: string): void;
  /** Configurações efetivas por arquivo (para montar o lote). */
  settingsFor(id: string): ProcessingSettings;
  forgetAssets(validIds: Set<string>): void;
}

const Ctx = createContext<Workspace | null>(null);

function load(key: string): PersistedState | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<PersistedState>;
    const settings = processingSettingsSchema.safeParse(p.settings);
    const perAsset: Record<string, ProcessingSettings> = {};
    for (const [k, v] of Object.entries(p.perAsset ?? {})) {
      const r = processingSettingsSchema.safeParse(v);
      if (r.success) perAsset[k] = r.data;
    }
    return {
      selected: Array.isArray(p.selected) ? p.selected.filter((x) => typeof x === 'string') : [],
      focusAssetId: typeof p.focusAssetId === 'string' ? p.focusAssetId : null,
      scope: p.scope === 'individual' ? 'individual' : 'common',
      settings: settings.success ? settings.data : defaultSettings('quick'),
      perAsset,
      profiles: Array.isArray(p.profiles) ? p.profiles.filter((x) => typeof x === 'string') : [],
    };
  } catch {
    return null;
  }
}

const initial = (): PersistedState => ({
  selected: [],
  focusAssetId: null,
  scope: 'common',
  settings: defaultSettings('quick'),
  perAsset: {},
  profiles: [],
});

export function WorkspaceProvider({ sessionId, children }: { sessionId: string; children: ReactNode }) {
  const storageKey = `mediaforge:workspace:${sessionId}`;
  const [state, setState] = useState<PersistedState>(() => load(storageKey) ?? initial());
  const keyRef = useRef(storageKey);

  useEffect(() => {
    if (keyRef.current !== storageKey) {
      keyRef.current = storageKey;
      setState(load(storageKey) ?? initial());
    }
  }, [storageKey]);

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(state));
      } catch {
        /* armazenamento indisponível: segue só em memória */
      }
    }, 250);
    return () => clearTimeout(t);
  }, [state, storageKey]);

  const editingIndividual = state.scope === 'individual' && !!state.focusAssetId && state.selected.includes(state.focusAssetId);
  const activeSettings = editingIndividual
    ? state.perAsset[state.focusAssetId!] ?? { ...structuredClone(state.settings) }
    : state.settings;

  const update = useCallback((mutator: (draft: ProcessingSettings) => void) => {
    setState((s) => {
      const individual = s.scope === 'individual' && !!s.focusAssetId && s.selected.includes(s.focusAssetId);
      const base = individual ? s.perAsset[s.focusAssetId!] ?? s.settings : s.settings;
      const draft = structuredClone(base);
      mutator(draft);
      return individual ? { ...s, perAsset: { ...s.perAsset, [s.focusAssetId!]: draft } } : { ...s, settings: draft };
    });
  }, []);

  const value = useMemo<Workspace>(
    () => ({
      ...state,
      activeSettings,
      editingIndividual,
      toggleSelected: (id) =>
        setState((s) => ({ ...s, selected: s.selected.includes(id) ? s.selected.filter((x) => x !== id) : [...s.selected, id] })),
      setSelected: (ids) => setState((s) => ({ ...s, selected: ids })),
      setFocus: (id) => setState((s) => ({ ...s, focusAssetId: id })),
      setScope: (scope) => setState((s) => ({ ...s, scope })),
      setMode: (mode) =>
        update((d) => {
          d.mode = mode;
        }),
      update,
      replaceSettings: (next) => update((d) => Object.assign(d, structuredClone(next))),
      resetIndividual: (id) =>
        setState((s) => {
          const perAsset = { ...s.perAsset };
          delete perAsset[id];
          return { ...s, perAsset };
        }),
      setProfiles: (ids) => setState((s) => ({ ...s, profiles: ids })),
      toggleProfile: (id) =>
        setState((s) => ({ ...s, profiles: s.profiles.includes(id) ? s.profiles.filter((x) => x !== id) : [...s.profiles, id] })),
      settingsFor: (id) => (state.scope === 'individual' && state.perAsset[id] ? state.perAsset[id] : state.settings),
      forgetAssets: (valid) =>
        setState((s) => {
          const selected = s.selected.filter((x) => valid.has(x));
          const focus = s.focusAssetId && valid.has(s.focusAssetId) ? s.focusAssetId : null;
          const perAsset = Object.fromEntries(Object.entries(s.perAsset).filter(([k]) => valid.has(k)));
          if (selected.length === s.selected.length && focus === s.focusAssetId && Object.keys(perAsset).length === Object.keys(s.perAsset).length)
            return s;
          return { ...s, selected, focusAssetId: focus, perAsset };
        }),
    }),
    [state, activeSettings, editingIndividual, update],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkspace(): Workspace {
  const v = useContext(Ctx);
  if (!v) throw new Error('WorkspaceProvider ausente');
  return v;
}

/** Configurações que o servidor efetivamente aplicará (seções do modo). */
export function useEffective(s: ProcessingSettings) {
  return useMemo(() => effectiveSettings(s), [s]);
}
