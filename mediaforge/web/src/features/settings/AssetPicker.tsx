import type { AssetDTO, AssetKind } from '@mediaforge/shared';
import { Select } from '../../components/ui/controls';
import { useAssets } from '../../lib/queries';

/** Escolhe um arquivo da sessão (por tipo) para uso como recurso editorial. */
export function AssetPicker({
  kinds,
  value,
  onChange,
  placeholder = 'Selecione um arquivo…',
  requireAudio,
  testId,
  ariaLabel,
}: {
  kinds: AssetKind[];
  value: string | null;
  onChange: (id: string | null) => void;
  placeholder?: string;
  requireAudio?: boolean;
  testId?: string;
  ariaLabel?: string;
}) {
  const { data: assets } = useAssets();
  const list = (assets ?? []).filter((a: AssetDTO) => a.status === 'ready' && kinds.includes(a.kind) && (!requireAudio || a.hasAudio));
  const missing = value && !list.some((a) => a.id === value);
  return (
    <Select
      testId={testId}
      ariaLabel={ariaLabel}
      value={value ?? ''}
      onChange={(v) => onChange(v || null)}
      options={[
        { value: '', label: list.length ? placeholder : 'Nenhum arquivo compatível importado' },
        ...(missing ? [{ value, label: '⚠ arquivo não está nesta sessão' }] : []),
        ...list.map((a) => ({ value: a.id, label: `${a.name} (${a.kind === 'video' ? 'vídeo' : a.kind === 'image' ? 'imagem' : a.kind === 'audio' ? 'áudio' : 'SRT'})` })),
      ]}
    />
  );
}
