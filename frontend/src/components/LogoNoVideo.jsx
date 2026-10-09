import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import api from '../services/api';
import { avisar } from '../services/avisos';
import { CANTOS_LOGO } from '../services/variacoes';

/**
 * O logo da pessoa no vídeo — usado nas Variações e no Postar.
 *
 * O logo é um só por usuário (enviado aqui mesmo, guardado no servidor como
 * PNG); cada tela guarda só COMO aplicar: `{ ativa, canto, tamanho, opacidade }`.
 */

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const rotulo = { fontSize: 'var(--mf-t-nano)', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--mf-text-3)', marginBottom: 6 };
const chip = ativo => ({
  padding: '5px 10px', borderRadius: 'var(--mf-r-sm)', cursor: 'pointer', fontSize: 'var(--mf-t-xs)', fontWeight: 650,
  border: `1px solid ${ativo ? 'var(--mf-primary-500)' : 'var(--mf-border)'}`,
  background: ativo ? 'color-mix(in oklch, var(--mf-primary-500) 12%, transparent)' : 'transparent',
  color: ativo ? 'var(--mf-text)' : 'var(--mf-text-2)',
});

/** O logo salvo (url pública) — compartilhado entre as telas. */
export function useLogo() {
  const [logo, setLogo] = useState(undefined); // undefined = carregando, null = sem logo
  useEffect(() => { api.get('/conta/logo').then(r => setLogo(r.data.url ? r.data : null)).catch(() => setLogo(null)); }, []);
  return [logo, setLogo];
}

export default function LogoNoVideo({ valor, onChange, logo, setLogo }) {
  const entrada = useRef(null);
  const [enviando, setEnviando] = useState(false);
  const muda = parcial => onChange({ ...valor, ...parcial });

  async function enviar(arquivo) {
    if (!arquivo) return;
    setEnviando(true);
    try {
      const fd = new FormData();
      fd.append('logo', arquivo);
      const { data } = await api.post('/conta/logo', fd);
      setLogo(data);
      muda({ ativa: true });
      avisar('success', 'Logo salvo', 'Ele fica guardado para os próximos envios.');
    } catch (e) {
      avisar('error', 'Não deu para salvar o logo', e.response?.data?.error || e.message);
    } finally { setEnviando(false); }
  }
  async function remover() {
    await api.delete('/conta/logo').catch(() => {});
    setLogo(null);
    muda({ ativa: false });
  }

  return (
    <div data-logo-no-video style={{ display: 'grid', gap: 'var(--mf-3)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {logo?.url && (
          <img src={`${API_URL}${logo.url}`} alt="Seu logo" style={{ width: 44, height: 44, objectFit: 'contain', borderRadius: 6,
            background: 'repeating-conic-gradient(var(--mf-surface-2) 0 25%, var(--mf-border) 0 50%) 0 0/12px 12px' }} />
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--mf-t-xs)', color: logo ? 'var(--mf-text-2)' : 'var(--mf-text-3)', cursor: logo ? 'pointer' : 'default' }}>
          <input type="checkbox" data-aplicar-logo disabled={!logo} checked={!!logo && valor.ativa} onChange={e => muda({ ativa: e.target.checked })} />
          Aplicar meu logo
        </label>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn-ghost btn-sm" disabled={enviando} onClick={() => entrada.current?.click()}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <ImagePlus size={13} /> {enviando ? 'Enviando…' : logo ? 'Trocar logo' : 'Enviar logo'}
        </button>
        {logo && (
          <button type="button" className="btn-ghost btn-sm" onClick={remover} aria-label="Remover logo" style={{ display: 'inline-grid', placeItems: 'center', padding: 6 }}>
            <Trash2 size={13} />
          </button>
        )}
        <input ref={entrada} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={e => { enviar(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
      {logo === null && (
        <div style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)' }}>PNG com fundo transparente fica melhor. Até 3 MB.</div>
      )}
      {logo && valor.ativa && (
        <div style={{ display: 'flex', gap: 'var(--mf-4)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <div style={rotulo}>Canto</div>
            <div style={{ display: 'flex', gap: 4 }}>
              {CANTOS_LOGO.map(c => (
                <button key={c.value} type="button" aria-label={`Canto ${c.value}`} aria-pressed={valor.canto === c.value}
                  onClick={() => muda({ canto: c.value })} style={{ ...chip(valor.canto === c.value), width: 34 }}>{c.label}</button>
              ))}
            </div>
          </div>
          <div>
            <div style={rotulo}>Tamanho</div>
            <div style={{ display: 'flex', gap: 4 }}>
              {[['pequeno', 'P'], ['medio', 'M'], ['grande', 'G']].map(([v, t]) => (
                <button key={v} type="button" aria-pressed={valor.tamanho === v} onClick={() => muda({ tamanho: v })} style={{ ...chip(valor.tamanho === v), width: 34 }}>{t}</button>
              ))}
            </div>
          </div>
          <label style={{ display: 'grid', gap: 4, fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-2)', minWidth: 160 }}>
            <span style={rotulo}>Opacidade · {valor.opacidade}%</span>
            <input type="range" min={20} max={100} step={5} value={valor.opacidade} onChange={e => muda({ opacidade: Number(e.target.value) })} aria-label="Opacidade do logo" />
          </label>
        </div>
      )}
    </div>
  );
}
