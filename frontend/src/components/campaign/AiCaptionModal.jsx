import { useEffect, useState } from 'react';
import api from '../../services/api';

/**
 * Geração de legenda por IA.
 *
 * Fluxo: briefing → o backend devolve N variações → o usuário escolhe uma, edita
 * se quiser e aplica. Nada substitui o campo sem confirmação: legenda gerada é
 * rascunho, não texto final.
 *
 * A disponibilidade é consultada em /ai/status antes de mostrar o formulário —
 * sem chave configurada no servidor, o modal explica o que fazer em vez de
 * deixar o usuário clicar em "gerar" e receber erro.
 */

const TONS = [
  { id: 'neutro',       rotulo: 'Neutro' },
  { id: 'vendedor',     rotulo: 'Vendedor' },
  { id: 'descontraido', rotulo: 'Descontraído' },
  { id: 'premium',      rotulo: 'Premium' },
  { id: 'educativo',    rotulo: 'Educativo' },
  { id: 'provocativo',  rotulo: 'Provocativo' },
];

export default function AiCaptionModal({
  aberta,
  contexto = '',        // nome da campanha/conteúdo, para pré-preencher o briefing
  textoAtual = '',      // usado como referência de estilo, quando existir
  onAplicar,            // (texto) => void
  onFechar,
}) {
  const [status, setStatus]         = useState(null);   // null = ainda consultando
  const [briefing, setBriefing]     = useState('');
  const [tom, setTom]               = useState('neutro');
  const [quantidade, setQuantidade] = useState(3);
  const [hashtags, setHashtags]     = useState(false);
  const [usarEstilo, setUsarEstilo] = useState(false);
  const [gerando, setGerando]       = useState(false);
  const [sugestoes, setSugestoes]   = useState([]);
  const [erro, setErro]             = useState('');

  useEffect(() => {
    if (!aberta) return;
    setErro('');
    setSugestoes([]);
    setBriefing(b => b || (contexto ? `Post sobre: ${contexto}` : ''));

    api.get('/ai/status')
      .then(({ data }) => setStatus(data))
      .catch(() => setStatus({ disponivel: false }));
  }, [aberta, contexto]);

  async function gerar() {
    const texto = briefing.trim();
    if (!texto) { setErro('Descreva do que o post trata.'); return; }

    setGerando(true);
    setErro('');
    try {
      const { data } = await api.post('/ai/captions', {
        briefing: texto,
        tom,
        quantidade,
        hashtags,
        exemplo: usarEstilo ? String(textoAtual || '').slice(0, 1000) : undefined,
      });
      setSugestoes(data?.legendas || []);
    } catch (e) {
      setErro(e?.response?.data?.error || 'Não foi possível gerar as legendas.');
    } finally {
      setGerando(false);
    }
  }

  if (!aberta) return null;

  const campo = {
    padding: '8px 10px', borderRadius: 'var(--mf-r-sm)', fontSize: 'var(--mf-t-xs)', width: '100%',
    background: 'oklch(0.10 0.03 235)', color: 'var(--mf-text)',
    border: '1px solid var(--mf-border)', outline: 'none',
  };
  const chip = (ativo) => ({
    padding: '5px 10px', borderRadius: 'var(--mf-r-sm)', fontSize: 'var(--mf-t-nano)', fontWeight: 700, cursor: 'pointer',
    background: ativo ? 'color-mix(in oklch, var(--mf-mod-publicar) 18%, transparent)' : 'var(--mf-border-subtle)',
    color:      ativo ? 'var(--mf-mod-publicar)'              : 'var(--mf-text-3)',
    border:     ativo ? '1px solid color-mix(in oklch, var(--mf-mod-publicar) 40%, transparent)' : '1px solid var(--mf-border)',
  });

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onFechar?.(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', zIndex: 999, display: 'grid', placeItems: 'center', padding: 20 }}>
      <div style={{
        background: 'oklch(0.14 0.04 235)', padding: 20, borderRadius: 'var(--mf-r-lg)',
        width: 'min(640px, 100%)', maxHeight: '88vh', display: 'flex', flexDirection: 'column',
        border: '1px solid var(--mf-border)',
      }}>
        <h3 style={{ margin: '0 0 4px', fontSize: 'var(--mf-t-h2)', fontWeight: 700 }}>Gerar legenda com IA</h3>

        {status && !status.disponivel ? (
          <>
            <p style={{ fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-2)', lineHeight: 1.7, margin: '8px 0 0' }}>
              A geração por IA não está configurada neste servidor. Para ativar, defina
              <code style={{ margin: '0 4px', padding: '1px 5px', borderRadius: 'var(--mf-r-xs)', background: 'var(--mf-border)' }}>ANTHROPIC_API_KEY</code>
              no arquivo <strong>.env</strong> do backend e reinicie o container.
            </p>
            <div style={{ marginTop: 18, textAlign: 'right' }}>
              <button onClick={onFechar} style={{ ...chip(false), padding: '8px 16px' }}>Fechar</button>
            </div>
          </>
        ) : (
          <>
            <p style={{ margin: '0 0 14px', fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', lineHeight: 1.6 }}>
              Descreva o post. As marcações do painel ({'{username}'}, {'{campaign}'}) podem
              aparecer no texto e são substituídas na publicação.
            </p>

            <div style={{ flex: 1, overflowY: 'auto', paddingRight: 4 }}>
              <textarea
                rows={4}
                value={briefing}
                onChange={e => setBriefing(e.target.value)}
                maxLength={2000}
                placeholder="Ex: divulgação do curso de edição de vídeo, turma abre segunda, foco em quem já tenta editar sozinho e trava na parte de áudio"
                style={{ ...campo, resize: 'vertical', marginBottom: 12 }} />

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)', marginBottom: 6 }}>Tom</div>
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                    {TONS.map(t => (
                      <button key={t.id} onClick={() => setTom(t.id)} style={chip(tom === t.id)}>{t.rotulo}</button>
                    ))}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-2)' }}>
                    Variações
                    <select value={quantidade} onChange={e => setQuantidade(Number(e.target.value))}
                      style={{ ...campo, width: 62, padding: '5px 6px', cursor: 'pointer' }}>
                      {[1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </label>

                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-2)', cursor: 'pointer' }}>
                    <input type="checkbox" checked={hashtags} onChange={e => setHashtags(e.target.checked)} />
                    Incluir hashtags
                  </label>

                  {String(textoAtual || '').trim() && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-2)', cursor: 'pointer' }}>
                      <input type="checkbox" checked={usarEstilo} onChange={e => setUsarEstilo(e.target.checked)} />
                      Imitar o estilo do texto atual
                    </label>
                  )}
                </div>
              </div>

              {erro && (
                <div style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-danger-500)', marginBottom: 10, lineHeight: 1.6 }}>{erro}</div>
              )}

              {sugestoes.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                  <div style={{ fontSize: 'var(--mf-t-micro)', fontWeight: 700, color: 'var(--mf-text-2)' }}>
                    Escolha uma variação — ela vai para o campo, onde você ainda pode editar.
                  </div>
                  {sugestoes.map((s, i) => (
                    <button key={i} onClick={() => { onAplicar?.(s.texto); onFechar?.(); }}
                      style={{ textAlign: 'left', padding: 12, borderRadius: 'var(--mf-r-md)', cursor: 'pointer',
                        background: 'var(--mf-border-subtle)', border: '1px solid var(--mf-border)' }}>
                      <div style={{ fontSize: 'var(--mf-t-nano)', fontWeight: 800, color: 'var(--mf-mod-publicar)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                        {s.gancho || `Variação ${i + 1}`}
                      </div>
                      <div style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-2)', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                        {s.texto}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
              <button onClick={onFechar} style={{ ...chip(false), padding: '8px 16px' }}>Fechar</button>
              <button onClick={gerar} disabled={gerando || status === null}
                style={{
                  padding: '8px 18px', borderRadius: 'var(--mf-r-sm)', fontSize: 'var(--mf-t-xs)', fontWeight: 700,
                  cursor: gerando ? 'default' : 'pointer',
                  background: 'color-mix(in oklch, var(--mf-mod-publicar) 20%, transparent)', color: 'var(--mf-mod-publicar)',
                  border: '1px solid color-mix(in oklch, var(--mf-mod-publicar) 50%, transparent)', opacity: gerando ? .6 : 1,
                }}>
                {gerando ? 'Gerando…' : sugestoes.length ? 'Gerar de novo' : 'Gerar'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
