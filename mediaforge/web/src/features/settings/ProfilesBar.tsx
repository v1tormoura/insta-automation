import { deepMerge, processingSettingsSchema, type AssetDTO } from '@mediaforge/shared';
import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Bookmark, BookmarkPlus, Check, Download, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button, IconButton } from '../../components/ui/Button';
import { Field, TextInput } from '../../components/ui/controls';
import { Modal } from '../../components/ui/Modal';
import { SectionTitle } from '../../components/ui/Panel';
import { useToast } from '../../components/ui/toast';
import { api } from '../../lib/api';
import { keys, usePresets, useProfiles } from '../../lib/queries';
import { useWorkspace } from '../../state/workspace';
import { countOutputs } from '../process/batchRequest';

function Chip({ active, onClick, title, children, testId }: { active: boolean; onClick: () => void; title?: string; children: React.ReactNode; testId?: string }) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active}
      data-testid={testId}
      onClick={onClick}
      className={clsx(
        'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium transition-colors',
        active ? 'border-accent bg-accent/15 text-white' : 'border-line-strong bg-surface-2 text-ink-2 hover:border-accent/50 hover:text-ink',
      )}
    >
      {active && <Check size={12} className="text-accent-soft" />}
      {children}
    </button>
  );
}

export function ProfilesBar({ selectedAssets }: { selectedAssets: AssetDTO[] }) {
  const ws = useWorkspace();
  const { data: presets } = usePresets();
  const { data: saved } = useProfiles();
  const qc = useQueryClient();
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const count = countOutputs(selectedAssets, ws.settingsFor, ws.profiles);
  const validSaved = new Set((saved ?? []).map((p) => `saved:${p.id}`));
  const activeProfiles = ws.profiles.filter((p) => !p.startsWith('saved:') || validSaved.has(p));

  const save = async () => {
    setBusy(true);
    try {
      await api.saveProfile(name.trim(), ws.activeSettings);
      await qc.invalidateQueries({ queryKey: keys.profiles });
      toast.push('success', `Perfil "${name.trim()}" salvo`, ['Disponível para lotes futuros, inclusive em novas sessões.']);
      setSaving(false);
      setName('');
    } catch (err) {
      toast.error(err, 'Não foi possível salvar o perfil');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string, label: string) => {
    try {
      await api.deleteProfile(id);
      ws.setProfiles(ws.profiles.filter((p) => p !== `saved:${id}`));
      await qc.invalidateQueries({ queryKey: keys.profiles });
      toast.push('info', `Perfil "${label}" excluído`);
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <div className="flex flex-col gap-3" data-testid="profiles-bar">
      <div>
        <SectionTitle hint="Cada perfil marcado gera uma saída por arquivo. Sem perfil marcado, usa a configuração atual.">Perfis de exportação</SectionTitle>
        <div className="flex flex-wrap gap-1.5">
          {presets?.exportProfiles.map((p) => (
            <Chip key={p.id} testId={`profile-${p.id}`} active={ws.profiles.includes(p.id)} onClick={() => ws.toggleProfile(p.id)} title={p.description}>
              {p.name}
            </Chip>
          ))}
        </div>
      </div>

      <div>
        <SectionTitle
          hint="Salve a configuração atual para reutilizar em lotes futuros."
          right={
            <Button size="xs" variant="subtle" icon={BookmarkPlus} onClick={() => setSaving(true)} data-testid="save-profile">
              Salvar atual
            </Button>
          }
        >
          Perfis salvos
        </SectionTitle>
        {saved && saved.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {saved.map((p) => (
              <span key={p.id} className="inline-flex items-center gap-0.5 rounded-full border border-line-strong bg-surface-2 pr-1">
                <Chip active={ws.profiles.includes(`saved:${p.id}`)} onClick={() => ws.toggleProfile(`saved:${p.id}`)} title={`Gerar uma saída com o perfil "${p.name}" (${p.mode})`}>
                  <Bookmark size={11} /> {p.name}
                </Chip>
                <IconButton
                  icon={Download}
                  size="xs"
                  label={`Carregar "${p.name}" nas configurações`}
                  onClick={() => {
                    ws.replaceSettings(processingSettingsSchema.parse(deepMerge(p.settings, {})));
                    toast.push('info', `Configurações de "${p.name}" carregadas`);
                  }}
                />
                <IconButton icon={Trash2} size="xs" label={`Excluir "${p.name}"`} onClick={() => remove(p.id, p.name)} />
              </span>
            ))}
          </div>
        ) : (
          <p className="text-[11.5px] text-ink-3">Nenhum perfil salvo ainda.</p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-accent/25 bg-accent/5 px-3 py-2" data-testid="output-count">
        <span className="text-[12px] text-ink-2">Quantidade:</span>
        <span className="tabular text-[12.5px] text-ink">
          {count.files} arquivo(s) × {activeProfiles.length ? `${activeProfiles.length} perfil(is)` : 'configuração atual'}
          {count.withParts ? ' × partes' : ''}
        </span>
        <span className="ml-auto tabular text-[13px] font-semibold text-accent-soft">= {count.total} saída(s)</span>
      </div>

      <Modal
        open={saving}
        onClose={() => setSaving(false)}
        title="Salvar perfil"
        subtitle={`Modo ${ws.activeSettings.mode === 'quick' ? 'rápido' : ws.activeSettings.mode === 'custom' ? 'personalizado' : 'editorial'} com todas as configurações atuais`}
        width="max-w-md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setSaving(false)}>
              Cancelar
            </Button>
            <Button variant="primary" loading={busy} disabled={!name.trim()} onClick={save} data-testid="confirm-save-profile">
              Salvar
            </Button>
          </>
        }
      >
        <Field label="Nome do perfil" hint="Referências a arquivos (logotipo, trilha, legenda) precisam existir na sessão em que o perfil for usado.">
          <TextInput value={name} onChange={setName} maxLength={60} placeholder="Ex.: Reels com logotipo" testId="profile-name" />
        </Field>
      </Modal>
    </div>
  );
}
