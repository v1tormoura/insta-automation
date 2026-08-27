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

/**
 * Traduz a falha para uma frase que diz o que fazer.
 *
 * O texto cru não servia: um 405 chegava como "405 Not Allowed 405 Not Allowed
 * nginx/1.31.4" — verdadeiro e inútil. Quem lê precisa saber se espera, se
 * corrige alguma coisa, ou se avisa alguém. O detalhe técnico continua logo
 * abaixo, para quando for preciso investigar.
 */
function explicar(status, dados) {
  // Corpo em HTML significa que a resposta veio do nginx, não do backend: a
  // requisição não chegou ao Express.
  const doProxy = typeof dados === 'string' && /<html/i.test(dados);

  /* Um 404 tem dois significados MUITO diferentes, e tratá-los igual foi um
     erro meu: sem rota, o nginx devolve HTML; com rota, o Express devolve JSON
     com `code`. Quando há code, o problema é do que foi pedido — e dizer "é
     configuração do servidor" manda a pessoa procurar no lugar errado. */
  const doAplicativo = dados && typeof dados === 'object' && (dados.code || dados.error);
  const codigo = doAplicativo ? String(dados.code || '') : '';

  if (codigo === 'ACCOUNT_NOT_FOUND')
    return 'Algumas contas selecionadas não existem mais — provavelmente foram removidas ' +
           'depois que esta campanha começou a ser montada. Volte à etapa Contas e refaça a seleção.';
  if (codigo === 'ACCOUNT_NOT_ELIGIBLE')
    return 'Uma das contas está banida ou bloqueada. Volte à etapa Contas e tire ela da lista.';
  if (codigo === 'CONTENT_NOT_FOUND')
    return 'Alguns conteúdos não estão mais na biblioteca. Volte à etapa Conteúdos e refaça a seleção.';

  if (!status)              return 'O servidor não respondeu. Verifique a conexão e tente de novo.';
  if (status === 401 ||
      status === 403)       return 'Sua sessão expirou. Entre de novo e refaça a campanha.';
  if ((status === 404 && !doAplicativo) ||
      status === 405 ||
      doProxy)              return 'A rota da prévia não chegou ao servidor. É configuração do servidor, não da campanha.';
  if (status === 404)       return 'Algo que a campanha usa não existe mais. Revise as etapas anteriores.';
  if (status === 413)       return 'O plano ficou grande demais para enviar. Reduza contas ou conteúdos.';
  if (status === 429)       return 'Requisições demais em pouco tempo. Espere alguns segundos e tente de novo.';
  if (status === 502 ||
      status === 503 ||
      status === 504)       return 'O servidor está reiniciando ou fora do ar. Tente de novo em alguns segundos.';
  if (status >= 500)        return 'O servidor falhou ao montar o plano. Tente de novo; se insistir, é erro nosso.';
  return 'A campanha tem algo que o servidor recusou. Revise as etapas anteriores.';
}

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
  // Falha de rede e reinício do backend são transitórios — sem um botão, a
  // única saída era recarregar a página e refazer o wizard inteiro.
  const [tentativa, setTentativa] = useState(0);

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
        // O diagnóstico não pode ser descartado. A versão anterior lia só
        // `message` e `error` e, quando a resposta não tinha nenhum dos dois
        // (página HTML de erro do proxy, corpo grande demais, falha de rede),
        // mostrava "Não foi possível gerar a prévia" — uma frase que não diz
        // status, nem código, nem causa, e deixa quem está usando sem saída.
        const r = err?.response;
        const d = r?.data;

        const detalhe = d?.message
          || d?.error
          || (typeof d === 'string' ? d.replace(/<[^>]*>/g, ' ').trim().slice(0, 200) : '')
          || err?.message
          || 'sem detalhe';

        const partes = [
          r?.status ? `HTTP ${r.status}` : 'sem resposta do servidor',
          d?.code || '',
          detalhe,
        ].filter(Boolean);

        setErro({ resumo: explicar(r?.status, d), detalhe: partes.join(' · ') });
        // O objeto inteiro no console: às vezes a pista está numa chave que a
        // tela não mostra.
        console.error('[CampaignPreview] falha ao gerar a prévia', { status: r?.status, data: d, err });
        setPrevia(null);
      })
      .finally(() => { if (!cancelado) setCarregando(false); });

    // Se o usuário voltar e mudar algo, a resposta antiga não pode sobrescrever
    // a nova — daí o cancelamento.
    return () => { cancelado = true; };
    // payload é serializado pelo pai; comparar por referência recarregaria a
    // cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(payload), tentativa]);

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
      <div style={{ padding:'34px 0', textAlign:'center', color:'var(--mf-text-3)', fontSize: 'var(--mf-t-xs)' }}>
        Gerando o plano…
      </div>
    );
  }

  if (erro) {
    return (
      <div style={{
        display:'flex', gap:13, alignItems:'flex-start',
        background:'color-mix(in oklch, var(--mf-danger-500) 8%, transparent)',
        border:'1px solid color-mix(in oklch, var(--mf-danger-500) 32%, transparent)',
        borderRadius: 'var(--mf-r-lg)', padding:'16px 18px',
      }}>
        <span style={{
          width:32, height:32, borderRadius: 'var(--mf-r-md)', flexShrink:0, display:'grid', placeItems:'center',
          background:'color-mix(in oklch, var(--mf-danger-500) 16%, transparent)',
          color:'var(--mf-danger-500)',
        }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </span>

        <div style={{ minWidth:0, flex:1 }}>
          <div style={{ fontSize: 'var(--mf-t-sm)', fontWeight:750, color:'var(--mf-text)', marginBottom:4 }}>
            Não foi possível gerar a prévia
          </div>
          <div style={{ fontSize: 'var(--mf-t-xs)', color:'var(--mf-text-2)', lineHeight:1.6 }}>
            {erro.resumo}
          </div>
          <div style={{
            marginTop:9, padding:'7px 10px', borderRadius: 'var(--mf-r-sm)',
            background:'var(--mf-surface-2)', border:'1px solid var(--mf-border)',
            fontFamily:'var(--mf-mono)', fontSize: 'var(--mf-t-nano)', color:'var(--mf-text-3)',
            overflowX:'auto', whiteSpace:'nowrap',
          }}>{erro.detalhe}</div>

          <button
            onClick={() => setTentativa(t => t + 1)}
            style={{ marginTop:12, padding:'7px 15px', borderRadius: 'var(--mf-r-sm)', fontSize: 'var(--mf-t-micro)', fontWeight:700,
              cursor:'pointer',
              background:'color-mix(in oklch, var(--mf-danger-500) 14%, transparent)',
              color:'var(--mf-danger-500)',
              border:'1px solid color-mix(in oklch, var(--mf-danger-500) 34%, transparent)' }}>
            Tentar de novo
          </button>
        </div>
      </div>
    );
  }

  const s = previa?.summary || {};

  /* ── UI ────────────────────────────────────────────────────────────────── */

  const cartao = (valor, rotulo, cor) => (
    <div style={{ background:'var(--mf-border-subtle)', border:'1px solid var(--mf-border)',
      borderRadius: 'var(--mf-r-md)', padding:'11px 13px', minWidth:98, flex:1 }}>
      <div style={{ fontFamily:'var(--mf-mono)', fontSize: 'var(--mf-t-h1)', fontWeight:800, color: cor || 'var(--mf-text)' }}>
        {valor}
      </div>
      <div style={{ fontSize: 'var(--mf-t-nano)', color:'var(--mf-text-3)', marginTop:2, textTransform:'uppercase',
        letterSpacing:'.05em' }}>{rotulo}</div>
    </div>
  );

  const seletor = (valor, aoMudar, itens, vazio) => (
    <select className="input" style={{ fontSize: 'var(--mf-t-micro)', padding:'5px 8px', maxWidth:190 }}
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
        {cartao(s.invalid ?? comErro.length, 'com erro', comErro.length ? 'var(--mf-danger-500)' : 'var(--mf-success-500)')}
      </div>

      <div style={{ fontSize: 'var(--mf-t-micro)', color:'var(--mf-text-3)', lineHeight:1.7 }}>
        {primeira && (<>
          Primeira publicação <strong style={{ color:'var(--mf-text-2)' }}>{horario(primeira)}</strong>,
          última <strong style={{ color:'var(--mf-text-2)' }}>{horario(ultima)}</strong>.{' '}
        </>)}
        Intervalo de <strong style={{ color:'var(--mf-text-2)' }}>{s.interval}</strong>
        {s.window && <> dentro da janela <strong style={{ color:'var(--mf-text-2)' }}>{s.window}</strong></>}.
      </div>

      {/* Bloqueio explícito quando há erro */}
      {comErro.length > 0 && (
        <div style={{ background:'color-mix(in oklch, var(--mf-danger-500) 8%, transparent)', border:'1px solid color-mix(in oklch, var(--mf-danger-500) 30%, transparent)',
          borderRadius: 'var(--mf-r-md)', padding:'13px 15px' }}>
          <div style={{ fontSize: 'var(--mf-t-xs)', fontWeight:700, color:'var(--mf-danger-500)', marginBottom:7 }}>
            {comErro.length} {comErro.length === 1 ? 'publicação precisa' : 'publicações precisam'} de correção
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:4, maxHeight:150, overflowY:'auto' }}>
            {comErro.slice(0, 25).map(p => (
              <div key={`${p.account?.id}-${p.content?.id}`}
                style={{ fontSize: 'var(--mf-t-micro)', color:'var(--mf-text-2)', lineHeight:1.5 }}>
                <strong>{rotuloConta(p)}</strong> · {rotuloConteudo(p)} —{' '}
                <span style={{ color:'var(--mf-danger-500)' }}>
                  {(p.problemas || []).map(descreverProblema).join('; ')}
                </span>
              </div>
            ))}
            {comErro.length > 25 && (
              <div style={{ fontSize: 'var(--mf-t-nano)', color:'var(--mf-text-3)' }}>
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
              padding:'5px 11px', borderRadius: 'var(--mf-r-sm)', fontSize: 'var(--mf-t-nano)', fontWeight:700, cursor:'pointer',
              background: ativo ? 'color-mix(in oklch, var(--mf-mod-contas) 12%, transparent)' : 'var(--mf-border-subtle)',
              color:      ativo ? 'var(--mf-mod, var(--mf-accent-500))' : 'var(--mf-text-3)',
              border: `1px solid ${ativo ? 'color-mix(in oklch, var(--mf-mod-contas) 32%, transparent)' : 'var(--mf-border)'}`,
            }}>{f.rotulo}</button>
          );
        })}
        {seletor(porConta,    setPorConta,    contas,    'Todas as contas')}
        {seletor(porConteudo, setPorConteudo, conteudos, 'Todos os conteúdos')}
        <span style={{ marginLeft:'auto', fontFamily:'var(--mf-mono)', fontSize: 'var(--mf-t-nano)', color:'var(--mf-text-3)' }}>
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
              borderRadius: 'var(--mf-r-md)', padding:'9px 12px',
              background:'oklch(0.12 0.04 235 / 0.5)',
              border:`1px solid ${falhou ? 'color-mix(in oklch, var(--mf-danger-500) 30%, transparent)' : 'var(--mf-border)'}`,
            }}>
              <button onClick={() => setExpandida(aberta ? null : chave)} style={{
                display:'flex', alignItems:'center', gap:9, width:'100%', textAlign:'left',
                background:'transparent', border:'none', cursor:'pointer', padding:0,
              }}>
                <span style={{ fontFamily:'var(--mf-mono)', fontSize: 'var(--mf-t-nano)', color:'var(--mf-text-3)',
                  width:26, flexShrink:0 }}>{p.order ?? i + 1}</span>
                <span style={{ fontSize: 'var(--mf-t-micro)', fontWeight:700, flexShrink:0 }}>{rotuloConta(p)}</span>
                <span style={{ fontSize: 'var(--mf-t-micro)', color:'var(--mf-text-3)', overflow:'hidden',
                  textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1 }}>{rotuloConteudo(p)}</span>
                <span style={{ fontFamily:'var(--mf-mono)', fontSize: 'var(--mf-t-nano)', color:'var(--mf-text-3)', flexShrink:0 }}>
                  {horario(p.scheduledAt)}
                </span>
                {p.cover && (
                  <img src={p.cover.url} alt="capa"
                    title="Capa configurada para este vídeo"
                    style={{ width:16, height:22, objectFit:'cover', borderRadius: 'var(--mf-r-xs)',
                      border:'1px solid color-mix(in oklch, var(--mf-mod-publicar) 60%, transparent)', flexShrink:0 }} />
                )}
                {falhou && <span style={{ color:'var(--mf-danger-500)', fontSize: 'var(--mf-t-micro)', flexShrink:0 }}>⚠</span>}
              </button>

              {aberta && (
                <div style={{ marginTop:9, paddingTop:9, borderTop:'1px solid var(--mf-border)',
                  display:'flex', flexDirection:'column', gap:8 }}>
                  <div>
                    <div style={{ fontSize: 'var(--mf-t-nano)', color:'var(--mf-text-3)', textTransform:'uppercase',
                      letterSpacing:'.05em', marginBottom:3 }}>Legenda publicada</div>
                    <div style={{ fontSize: 'var(--mf-t-micro)', color:'var(--mf-text-2)', lineHeight:1.55,
                      whiteSpace:'pre-wrap', wordBreak:'break-word' }}>
                      {p.resolvedCaption || <em style={{ color:'var(--mf-text-3)' }}>sem legenda</em>}
                    </div>
                  </div>

                  {p.resolvedComment && (
                    <div>
                      <div style={{ fontSize: 'var(--mf-t-nano)', color:'var(--mf-text-3)', textTransform:'uppercase',
                        letterSpacing:'.05em', marginBottom:3 }}>
                        Comentário{p.commentDelayMinutes != null && (
                          p.commentDelayMaxMinutes > p.commentDelayMinutes
                            ? ` · ${p.commentDelayMinutes} a ${p.commentDelayMaxMinutes} min depois`
                            : ` · ${p.commentDelayMinutes} min depois`
                        )}
                      </div>
                      <div style={{ fontSize: 'var(--mf-t-micro)', color:'var(--mf-text-2)', lineHeight:1.55,
                        whiteSpace:'pre-wrap', wordBreak:'break-word' }}>{p.resolvedComment}</div>
                    </div>
                  )}

                  {falhou && (
                    <div style={{ fontSize: 'var(--mf-t-micro)', color:'var(--mf-danger-500)', lineHeight:1.5 }}>
                      {(p.problemas || []).map(descreverProblema).join(' · ')}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {!visiveis.length && (
          <div style={{ padding:'24px 0', textAlign:'center', color:'var(--mf-text-3)', fontSize: 'var(--mf-t-micro)' }}>
            Nenhuma publicação com esses filtros.
          </div>
        )}
      </div>
    </div>
  );
}
