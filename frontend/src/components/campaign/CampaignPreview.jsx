import { useEffect, useMemo, useState } from 'react';
import api from '../../services/api';

/**
 * Prévia da campanha: o plano completo, antes de criar qualquer coisa.
 *
 * Todo o conteúdo vem de POST /campaigns/preview, que roda o mesmo
 * PublicationPlanner e o mesmo templateResolver da execução. Nada aqui é
 * simulado no frontend — se a tela mostra um horário e um texto, é exatamente
 * o horário e o texto que serão publicados.
 *
 * O endpoint não grava nada: é só planejar e devolver.
 */

const FILTROS = [
  { id: 'todas',    rotulo: 'Todas'     },
  { id: 'erro',     rotulo: 'Com erro'  },
  { id: 'ok',       rotulo: 'Sem erro'  },
];

// Texto legível de cada tipo de problema devolvido pelo backend. O `detalhe`
// que acompanha cada um traz o número exato ("2314/2200") ou as marcações
// ("produto, cupom"), então é sempre mostrado junto.
const PROBLEMAS = {
  CAPTION_TOO_LONG:            'Legenda longa demais',
  COMMENT_TOO_LONG:            'Comentário longo demais',
  UNRESOLVED_VARIABLE:         'Marcação inexistente na legenda',
  UNRESOLVED_COMMENT_VARIABLE: 'Marcação inexistente no comentário',
};

/** Ex.: "Legenda longa demais (2314/2200)" */
const descreverProblema = pr =>
  `${PROBLEMAS[pr.tipo] || pr.tipo}${pr.detalhe ? ` (${pr.detalhe})` : ''}`;

const rotuloConta    = p => (p.account?.username ? `@${p.account.username}` : (p.account?.id || '—'));
const rotuloConteudo = p => p.content?.name || p.content?.id || '—';

const horario = iso => {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
};

export default function CampaignPreview({ payload, onValidChange }) {
  const [carregando, setCarregando] = useState(true);
  const [previa, setPrevia] = useState(null);
  const [erro, setErro]     = useState(null);

  const [filtro, setFiltro]   = useState('todas');
  const [porConta, setPorConta]       = useState('');
  const [porConteudo, setPorConteudo] = useState('');
  const [expandida, setExpandida]     = useState(null);

  /* ── Busca o plano ─────────────────────────────────────────────────────── */
  useEffect(() => {
    let cancelado = false;
    setCarregando(true);
    setErro(null);

    api.post('/campaigns/preview', payload)
      .then(({ data }) => { if (!cancelado) { setPrevia(data); setErro(null); } })
      .catch(err => {
        if (cancelado) return;
        const d = err?.response?.data;
        setErro(d?.message || d?.error || 'Não foi possível gerar a prévia.');
        setPrevia(null);
      })
      .finally(() => { if (!cancelado) setCarregando(false); });

    // Se o usuário voltar e mudar algo, a resposta antiga não pode sobrescrever
    // a nova — daí o cancelamento.
    return () => { cancelado = true; };
    // payload é serializado pelo pai; comparar por referência recarregaria a
    // cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(payload)]);

  const publicacoes = previa?.publications || [];

  const comErro = useMemo(
    () => publicacoes.filter(p => (p.problemas || []).length),
    [publicacoes],
  );

  // O pai bloqueia o envio enquanto houver problema. `null` durante o
  // carregamento distingue "ainda não sei" de "tem erro" — o botão mostra
  // "Gerando plano..." em vez de fingir que a campanha está reprovada.
  useEffect(() => {
    if (carregando) return onValidChange?.(null);
    onValidChange?.(!erro && comErro.length === 0);
  }, [carregando, erro, comErro.length, onValidChange]);

  /* ── Listas dos filtros ────────────────────────────────────────────────── */
  const contas = useMemo(() => {
    const vistas = new Map();
    for (const p of publicacoes) {
      const id = p.account?.id;
      if (id && !vistas.has(id)) vistas.set(id, rotuloConta(p));
    }
    return [...vistas].map(([id, label]) => ({ id, label }));
  }, [publicacoes]);

  const conteudos = useMemo(() => {
    const vistas = new Map();
    for (const p of publicacoes) {
      const id = p.content?.id;
      if (id && !vistas.has(id)) vistas.set(id, rotuloConteudo(p));
    }
    return [...vistas].map(([id, label]) => ({ id, label }));
  }, [publicacoes]);

  const visiveis = useMemo(() => publicacoes.filter(p => {
    if (filtro === 'erro' && !(p.problemas || []).length) return false;
    if (filtro === 'ok'   &&  (p.problemas || []).length) return false;
    if (porConta    && p.account?.id !== porConta)    return false;
    if (porConteudo && p.content?.id !== porConteudo) return false;
    return true;
  }), [publicacoes, filtro, porConta, porConteudo]);

  // O plano já vem ordenado por `order`; primeira e última saem das pontas.
  const primeira = publicacoes[0]?.scheduledAt;
  const ultima   = publicacoes[publicacoes.length - 1]?.scheduledAt;

  /* ── Estados de carregamento e erro ────────────────────────────────────── */

  if (carregando) {
    return (
      <div style={{ padding:'34px 0', textAlign:'center', color:'var(--text3)', fontSize:12 }}>
        Gerando o plano…
      </div>
    );
  }

  if (erro) {
    return (
      <div style={{ background:'rgba(248,113,113,.08)', border:'1px solid rgba(248,113,113,.3)',
        borderRadius:12, padding:'14px 16px', fontSize:12, color:'#f87171', lineHeight:1.6 }}>
        <strong>Não foi possível gerar a prévia.</strong>
        <div style={{ marginTop:5, color:'var(--text2)' }}>{erro}</div>
      </div>
    );
  }

  const s = previa?.summary || {};

  /* ── UI ────────────────────────────────────────────────────────────────── */

  const cartao = (valor, rotulo, cor) => (
    <div style={{ background:'oklch(1 0 0 / 0.03)', border:'1px solid oklch(1 0 0 / 0.07)',
      borderRadius:11, padding:'11px 13px', minWidth:98, flex:1 }}>
      <div style={{ fontFamily:'var(--font-mono)', fontSize:19, fontWeight:800, color: cor || 'var(--text)' }}>
        {valor}
      </div>
      <div style={{ fontSize:9.5, color:'var(--text3)', marginTop:2, textTransform:'uppercase',
        letterSpacing:'.05em' }}>{rotulo}</div>
    </div>
  );

  const seletor = (valor, aoMudar, itens, vazio) => (
    <select className="input" style={{ fontSize:11, padding:'5px 8px', maxWidth:190 }}
      value={valor} onChange={e => aoMudar(e.target.value)}>
      <option value="">{vazio}</option>
      {itens.map(i => <option key={i.id} value={i.id}>{i.label}</option>)}
    </select>
  );

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>

      {/* Resumo */}
      <div style={{ display:'flex', gap:9, flexWrap:'wrap' }}>
        {cartao(s.publications ?? publicacoes.length, 'publicações')}
        {cartao(s.accounts ?? contas.length,          'contas')}
        {cartao(s.contents ?? conteudos.length,       'conteúdos')}
        {cartao(s.invalid ?? comErro.length, 'com erro', comErro.length ? '#f87171' : '#4ade80')}
      </div>

      <div style={{ fontSize:11.5, color:'var(--text3)', lineHeight:1.7 }}>
        {primeira && (<>
          Primeira publicação <strong style={{ color:'var(--text2)' }}>{horario(primeira)}</strong>,
          última <strong style={{ color:'var(--text2)' }}>{horario(ultima)}</strong>.{' '}
        </>)}
        Intervalo de <strong style={{ color:'var(--text2)' }}>{s.interval}</strong>
        {s.window && <> dentro da janela <strong style={{ color:'var(--text2)' }}>{s.window}</strong></>}.
      </div>

      {/* Bloqueio explícito quando há erro */}
      {comErro.length > 0 && (
        <div style={{ background:'rgba(248,113,113,.08)', border:'1px solid rgba(248,113,113,.3)',
          borderRadius:12, padding:'13px 15px' }}>
          <div style={{ fontSize:12, fontWeight:700, color:'#f87171', marginBottom:7 }}>
            {comErro.length} {comErro.length === 1 ? 'publicação precisa' : 'publicações precisam'} de correção
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:4, maxHeight:150, overflowY:'auto' }}>
            {comErro.slice(0, 25).map(p => (
              <div key={`${p.account?.id}-${p.content?.id}`}
                style={{ fontSize:11, color:'var(--text2)', lineHeight:1.5 }}>
                <strong>{rotuloConta(p)}</strong> · {rotuloConteudo(p)} —{' '}
                <span style={{ color:'#f87171' }}>
                  {(p.problemas || []).map(descreverProblema).join('; ')}
                </span>
              </div>
            ))}
            {comErro.length > 25 && (
              <div style={{ fontSize:10.5, color:'var(--text3)' }}>
                e mais {comErro.length - 25}…
              </div>
            )}
          </div>
        </div>
      )}

      {/* Filtros */}
      <div style={{ display:'flex', gap:7, flexWrap:'wrap', alignItems:'center' }}>
        {FILTROS.map(f => {
          const ativo = filtro === f.id;
          return (
            <button key={f.id} onClick={() => setFiltro(f.id)} style={{
              padding:'5px 11px', borderRadius:7, fontSize:10.5, fontWeight:700, cursor:'pointer',
              background: ativo ? 'rgba(0,212,255,.12)' : 'oklch(1 0 0 / 0.04)',
              color:      ativo ? 'var(--cyan)' : 'var(--text3)',
              border: `1px solid ${ativo ? 'rgba(0,212,255,.32)' : 'oklch(1 0 0 / 0.08)'}`,
            }}>{f.rotulo}</button>
          );
        })}
        {seletor(porConta,    setPorConta,    contas,    'Todas as contas')}
        {seletor(porConteudo, setPorConteudo, conteudos, 'Todos os conteúdos')}
        <span style={{ marginLeft:'auto', fontFamily:'var(--font-mono)', fontSize:10, color:'var(--text3)' }}>
          {visiveis.length}/{publicacoes.length}
        </span>
      </div>

      {/* Lista do plano */}
      <div style={{ display:'flex', flexDirection:'column', gap:6, maxHeight:460, overflowY:'auto' }}>
        {visiveis.map((p, i) => {
          const chave  = `${p.account?.id}-${p.content?.id}-${i}`;
          const falhou = (p.problemas || []).length > 0;
          const aberta = expandida === chave;
          return (
            <div key={chave} style={{
              borderRadius:10, padding:'9px 12px',
              background:'oklch(0.12 0.04 235 / 0.5)',
              border:`1px solid ${falhou ? 'rgba(248,113,113,.3)' : 'oklch(1 0 0 / 0.07)'}`,
            }}>
              <button onClick={() => setExpandida(aberta ? null : chave)} style={{
                display:'flex', alignItems:'center', gap:9, width:'100%', textAlign:'left',
                background:'transparent', border:'none', cursor:'pointer', padding:0,
              }}>
                <span style={{ fontFamily:'var(--font-mono)', fontSize:10, color:'var(--text3)',
                  width:26, flexShrink:0 }}>{p.order ?? i + 1}</span>
                <span style={{ fontSize:11.5, fontWeight:700, flexShrink:0 }}>{rotuloConta(p)}</span>
                <span style={{ fontSize:11, color:'var(--text3)', overflow:'hidden',
                  textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1 }}>{rotuloConteudo(p)}</span>
                <span style={{ fontFamily:'var(--font-mono)', fontSize:10, color:'var(--text3)', flexShrink:0 }}>
                  {horario(p.scheduledAt)}
                </span>
                {falhou && <span style={{ color:'#f87171', fontSize:11, flexShrink:0 }}>⚠</span>}
              </button>

              {aberta && (
                <div style={{ marginTop:9, paddingTop:9, borderTop:'1px solid oklch(1 0 0 / 0.06)',
                  display:'flex', flexDirection:'column', gap:8 }}>
                  <div>
                    <div style={{ fontSize:9.5, color:'var(--text3)', textTransform:'uppercase',
                      letterSpacing:'.05em', marginBottom:3 }}>Legenda publicada</div>
                    <div style={{ fontSize:11.5, color:'var(--text2)', lineHeight:1.55,
                      whiteSpace:'pre-wrap', wordBreak:'break-word' }}>
                      {p.resolvedCaption || <em style={{ color:'var(--text3)' }}>sem legenda</em>}
                    </div>
                  </div>

                  {p.resolvedComment && (
                    <div>
                      <div style={{ fontSize:9.5, color:'var(--text3)', textTransform:'uppercase',
                        letterSpacing:'.05em', marginBottom:3 }}>
                        Comentário{p.commentDelayMinutes != null && ` · ${p.commentDelayMinutes} min depois`}
                      </div>
                      <div style={{ fontSize:11.5, color:'var(--text2)', lineHeight:1.55,
                        whiteSpace:'pre-wrap', wordBreak:'break-word' }}>{p.resolvedComment}</div>
                    </div>
                  )}

                  {falhou && (
                    <div style={{ fontSize:11, color:'#f87171', lineHeight:1.5 }}>
                      {(p.problemas || []).map(descreverProblema).join(' · ')}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {!visiveis.length && (
          <div style={{ padding:'24px 0', textAlign:'center', color:'var(--text3)', fontSize:11.5 }}>
            Nenhuma publicação com esses filtros.
          </div>
        )}
      </div>
    </div>
  );
}
