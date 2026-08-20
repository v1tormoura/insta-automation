import { useEffect, useMemo, useRef, useState } from 'react';
import VariableInserter, { inserirNoCursor, useVariaveisSuportadas } from './VariableInserter';

/**
 * Editor de legendas da campanha — os quatro modos, com edição inline.
 *
 * Decisões de interface:
 *
 * - Edição inline, nunca modal por conta. Com 12 contas, abrir e fechar 12
 *   modais é inviável; o usuário precisa ver e comparar os textos lado a lado.
 *
 * - No modo conta+conteúdo a matriz é N×M — 12 contas × 4 conteúdos são 48
 *   campos numa tela só. Em vez disso, escolhe-se uma conta e editam-se os
 *   conteúdos dela, com marcador de quantos campos já foram preenchidos.
 *
 * - Os textos ficam BRUTOS: `{username}` e afins não são resolvidos aqui, só na
 *   publicação. Assim o mesmo template serve a várias contas.
 *
 * - As marcações escritas no texto viram fichas abaixo do campo, em vermelho
 *   quando não existem no templateResolver. Isso pega o erro real (marcação com
 *   erro de digitação, que sairia publicada como texto literal) sem reimplementar
 *   a resolução no frontend — o texto final resolvido vem de POST
 *   /campaigns/preview, na etapa de revisão, calculado pelo mesmo código da
 *   execução.
 */

const LIMITE = 2200;   // limite de legenda do Instagram

// Idêntica à do templateResolver no backend — se divergirem, a ficha marcaria
// como válida uma marcação que o servidor considera desconhecida (ou o contrário).
const MARCACAO = /\{([a-zA-Z0-9_]+)\}/g;

function extrairVariaveis(texto) {
  const achadas = [];
  for (const m of String(texto || '').matchAll(MARCACAO)) {
    if (!achadas.includes(m[1])) achadas.push(m[1]);
  }
  return achadas;
}

const MODOS = [
  { id: 'global',              rotulo: 'Mesma para todas',    desc: 'Um texto único para toda a campanha' },
  { id: 'per_account',         rotulo: 'Por conta',           desc: 'Cada conta com seu texto' },
  { id: 'per_content',         rotulo: 'Por conteúdo',        desc: 'Cada mídia com seu texto' },
  { id: 'per_account_content', rotulo: 'Por conta + conteúdo', desc: 'Texto específico de cada combinação' },
];

export default function CaptionEditor({
  mode = 'global',
  onModeChange,
  captions = {},
  onChange,          // (proximo) => void — recebe o objeto captions inteiro
  accounts = [],     // [{ id, label }]
  contents = [],     // [{ id, label }]
  titulo = 'Legenda',
  placeholder = 'Confira o novo conteúdo 🔥',
}) {
  const [contaAtiva, setContaAtiva] = useState(accounts[0]?.id || null);
  const suportadas = useVariaveisSuportadas() || [];
  const [modalBiblioteca, setModalBiblioteca] = useState({ ativa: false, alvo: null });
  const [modalIA, setModalIA] = useState({ ativa: false, alvo: null });
  const [legendsLib, setLegendsLib] = useState([]);
  
  useEffect(() => {
    // Busca legendas já cadastradas na biblioteca
    import('../../services/api').then(m => {
      m.default.get('/legends').then(r => setLegendsLib(r.data)).catch(()=>console.error('Erro ao buscar legendas'));
    });
  }, []);
  // Sincroniza conta ativa caso as contas mudem ou a atual seja removida
  useEffect(() => {
    if (!accounts.length) {
      setContaAtiva(null);
    } else if (!accounts.some(a => a.id === contaAtiva)) {
      setContaAtiva(accounts[0]?.id || null);
    }
  }, [accounts, contaAtiva]);

  // Guarda o textarea em foco para que o botão de variável saiba onde inserir.
  // Sem isso a marcação iria sempre para o último campo, não para o que o
  // usuário está editando.
  const focadoRef = useRef(null);

  const mapaAtual = {
    per_account:         'byAccount',
    per_content:         'byContent',
    per_account_content: 'byAccountContent',
  }[mode] || 'byAccount';

  /* ── Leitura e escrita nos mapas ───────────────────────────────────────── */

  const ler = (mapa, chave) => {
    if (!captions || !mapa) return '';
    const fonte = captions[mapa];
    if (!fonte) return '';
    // Aceita Map (vindo do backend) e objeto simples (estado local).
    return (typeof fonte.get === 'function' ? fonte.get(chave) : fonte[chave]) || '';
  };

  const escrever = (mapa, chave, valor) => {
    const atual = (captions && captions[mapa]) || {};
    const objeto = typeof atual.get === 'function' ? Object.fromEntries(atual) : { ...atual };
    if (valor !== undefined && valor !== null && String(valor).length > 0) {
      objeto[chave] = valor;
    } else {
      delete objeto[chave];
    }
    onChange?.({ ...(captions || {}), [mapa]: objeto });
  };

  /* ── Linhas conforme o modo ────────────────────────────────────────────── */

  const linhas = useMemo(() => {
    if (mode === 'per_account') {
      return accounts.map(a => ({ chave: a.id, rotulo: a.label }));
    }
    if (mode === 'per_content') {
      return contents.map(c => ({ chave: c.id, rotulo: c.label }));
    }
    if (mode === 'per_account_content' && contaAtiva) {
      // Chave composta usa "__" porque o Mongoose proíbe ponto em chave de Map.
      return contents.map(c => ({ chave: `${contaAtiva}__${c.id}`, rotulo: c.label }));
    }
    return [];
  }, [mode, accounts, contents, contaAtiva]);

  const preenchidas = linhas.filter(l => ler(mapaAtual, l.chave).trim()).length;

  /* ── Ações em massa ────────────────────────────────────────────────────── */

  function aplicarATodas() {
    // Fonte: a primeira linha preenchida. Sem nenhuma, cai na legenda global.
    const primeira = linhas.find(l => ler(mapaAtual, l.chave).trim());
    const texto = primeira ? ler(mapaAtual, primeira.chave) : (captions.global || '');
    if (!texto.trim()) return;

    const objeto = {};
    for (const l of linhas) objeto[l.chave] = texto;
    onChange({ ...captions, [mapaAtual]: { ...(captions[mapaAtual] || {}), ...objeto } });
  }

  function duplicarNasVazias() {
    const primeira = linhas.find(l => ler(mapaAtual, l.chave).trim());
    if (!primeira) return;
    const texto = ler(mapaAtual, primeira.chave);

    const atual = captions[mapaAtual] || {};
    const objeto = typeof atual.get === 'function' ? Object.fromEntries(atual) : { ...atual };
    for (const l of linhas) {
      if (!String(objeto[l.chave] || '').trim()) objeto[l.chave] = texto;
    }
    onChange({ ...captions, [mapaAtual]: objeto });
  }

  function limpar() {
    const atual = captions[mapaAtual] || {};
    const objeto = typeof atual.get === 'function' ? Object.fromEntries(atual) : { ...atual };
    for (const l of linhas) delete objeto[l.chave];
    onChange({ ...captions, [mapaAtual]: objeto });
  }

  /* ── Inserção de variável ──────────────────────────────────────────────── */

  /**
   * Insere a marcação no campo em foco.
   *
   * `aplicar` recebe o texto novo e sabe onde gravá-lo (global ou uma chave de
   * mapa), porque só quem renderizou o campo tem essa informação.
   */
  function inserirVariavel(marcacao, valorAtual, aplicar) {
    const el = focadoRef.current;
    const { texto, cursor } = inserirNoCursor(el, valorAtual, marcacao);
    aplicar(texto);
    if (el && cursor !== null) {
      // Depois do re-render, devolve o foco e põe o cursor após a marcação.
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(cursor, cursor);
      });
    }
  }

  /* ── UI ────────────────────────────────────────────────────────────────── */

  /** Fichas das marcações usadas — vermelhas quando o resolvedor não conhece. */
  const fichasVariaveis = (texto) => {
    const usadas = extrairVariaveis(texto);
    if (!usadas.length) return null;
    return (
      <div style={{ display:'flex', gap:4, flexWrap:'wrap', marginTop:6 }}>
        {usadas.map(v => {
          // Com a lista ainda carregando, nada é acusado de inválido.
          const ok = !suportadas.length || suportadas.includes(v);
          return (
            <span key={v} title={ok ? 'Será substituída na publicação' : 'Não existe — será publicada como texto'}
              style={{
                fontFamily:'var(--font-mono)', fontSize:9, fontWeight:700,
                padding:'2px 6px', borderRadius:5,
                background: ok ? 'rgba(0,212,255,.12)' : 'rgba(248,113,113,.14)',
                color:      ok ? 'var(--cyan)' : '#f87171',
                border: `1px solid ${ok ? 'rgba(0,212,255,.25)' : 'rgba(248,113,113,.3)'}`,
              }}>
              {ok ? '' : '⚠ '}{`{${v}}`}
            </span>
          );
        })}
      </div>
    );
  };

  const contador = (texto) => (
    <span style={{
      fontFamily:'var(--font-mono)', fontSize:9.5, flexShrink:0,
      color: texto.length > LIMITE ? '#f87171' : 'var(--text3)',
    }}>{texto.length}/{LIMITE}</span>
  );

  const botaoAcao = (rotulo, aoClicar, cor = 'var(--text3)') => (
    <button onClick={aoClicar} style={{
      padding:'5px 10px', borderRadius:7, fontSize:10.5, fontWeight:700, cursor:'pointer',
      background:'oklch(1 0 0 / 0.04)', color: cor, border:'1px solid oklch(1 0 0 / 0.08)',
    }}>{rotulo}</button>
  );

  return (
    <div style={{ background:'oklch(0.16 0.05 235 / 0.55)', border:'1px solid oklch(1 0 0 / 0.08)',
      borderRadius:14, padding:16, marginBottom:14 }}>

      <h3 style={{ margin:'0 0 12px', fontSize:13, fontWeight:700 }}>{titulo}</h3>

      {/* Seletor de modo */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(min(160px,100%),1fr))', gap:7, marginBottom:14 }}>
        {MODOS.map(m => {
          const ativo = mode === m.id;
          return (
            <button key={m.id} onClick={() => onModeChange(m.id)} title={m.desc} style={{
              textAlign:'left', padding:'9px 11px', borderRadius:9, cursor:'pointer', transition:'all .15s',
              background: ativo ? 'rgba(0,212,255,.1)' : 'oklch(1 0 0 / 0.03)',
              border: `1px solid ${ativo ? 'rgba(0,212,255,.35)' : 'oklch(1 0 0 / 0.07)'}`,
            }}>
              <div style={{ fontSize:11.5, fontWeight:700, color: ativo ? 'var(--cyan)' : 'var(--text2)' }}>
                {m.rotulo}
              </div>
              <div style={{ fontSize:10, color:'var(--text3)', marginTop:2, lineHeight:1.4 }}>{m.desc}</div>
            </button>
          );
        })}
      </div>

      {/* Modo global */}
      {mode === 'global' && (
        <>
          <textarea className="input" rows={4} style={{ width:'100%', resize:'vertical' }}
            placeholder={placeholder}
            value={captions.global || ''}
            onFocus={e => { focadoRef.current = e.target; }}
            onChange={e => onChange({ ...captions, global: e.target.value })} />
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:8, marginTop:5 }}>
            <div style={{ display:'flex', gap:6 }}>
              <VariableInserter onInsert={m => inserirVariavel(
                m, captions.global || '', t => onChange({ ...captions, global: t }))} />
              <button onClick={() => setModalBiblioteca({ ativa: true, alvo: { mapa: 'global', chave: 'global' } })}
                style={{ padding:'4px 8px', borderRadius:6, fontSize:10, fontWeight:700, cursor:'pointer', background:'oklch(1 0 0 / 0.05)', color:'var(--text2)', border:'1px solid oklch(1 0 0 / 0.1)' }}>
                📚 Biblioteca
              </button>
              <button onClick={() => setModalIA({ ativa: true, alvo: { mapa: 'global', chave: 'global' } })}
                style={{ padding:'4px 8px', borderRadius:6, fontSize:10, fontWeight:700, cursor:'pointer', background:'rgba(139,92,246,.12)', color:'#a78bfa', border:'1px solid rgba(139,92,246,.28)' }}>
                ✨ Gerar IA
              </button>
            </div>
            {contador(captions.global || '')}
          </div>
          {fichasVariaveis(captions.global || '')}
        </>
      )}

      {/* Modos por chave */}
      {mode !== 'global' && (
        <>
          {/* Seletor de conta no modo combinado */}
          {mode === 'per_account_content' && (
            <div style={{ marginBottom:12 }}>
              <div style={{ fontSize:10.5, color:'var(--text3)', marginBottom:6 }}>
                Escolha a conta para editar os textos dos conteúdos dela:
              </div>
              <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                {accounts.map(a => {
                  const ativa = contaAtiva === a.id;
                  const feitas = contents.filter(c => ler('byAccountContent', `${a.id}__${c.id}`).trim()).length;
                  return (
                    <button key={a.id} onClick={() => setContaAtiva(a.id)} style={{
                      padding:'6px 11px', borderRadius:8, fontSize:11, fontWeight:700, cursor:'pointer',
                      background: ativa ? 'rgba(139,92,246,.16)' : 'oklch(1 0 0 / 0.04)',
                      color:      ativa ? '#a78bfa' : 'var(--text3)',
                      border:     `1px solid ${ativa ? 'rgba(139,92,246,.35)' : 'oklch(1 0 0 / 0.08)'}`,
                    }}>
                      {a.label}
                      <span style={{ marginLeft:6, fontFamily:'var(--font-mono)', fontSize:9, opacity:.8 }}>
                        {feitas}/{contents.length}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Ações em massa */}
          <div style={{ display:'flex', gap:6, flexWrap:'wrap', alignItems:'center', marginBottom:10 }}>
            {botaoAcao('Aplicar a todas', aplicarATodas, 'var(--cyan)')}
            {botaoAcao('Preencher vazias', duplicarNasVazias, '#a78bfa')}
            {botaoAcao('Limpar', limpar, '#f87171')}
            <span style={{ marginLeft:'auto', fontFamily:'var(--font-mono)', fontSize:10, color:'var(--text3)' }}>
              {preenchidas}/{linhas.length} preenchidas
            </span>
          </div>

          {/* Linhas inline */}
          <div style={{ display:'flex', flexDirection:'column', gap:8, maxHeight:420, overflowY:'auto' }}>
            {linhas.map(l => {
              const texto = ler(mapaAtual, l.chave);
              return (
                <div key={l.chave} style={{
                  border:'1px solid oklch(1 0 0 / 0.07)', borderRadius:10, padding:'9px 11px',
                  background:'oklch(0.12 0.04 235 / 0.5)',
                }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:8, marginBottom:6 }}>
                    <span style={{ fontSize:11.5, fontWeight:700, overflow:'hidden',
                      textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{l.rotulo}</span>
                    {contador(texto)}
                  </div>
                  <textarea className="input" rows={2}
                    style={{ width:'100%', resize:'vertical', fontSize:12 }}
                    placeholder={captions.global ? `Vazio usa a legenda geral: "${captions.global.slice(0, 42)}${captions.global.length > 42 ? '…' : ''}"` : placeholder}
                    value={texto}
                    onFocus={e => { focadoRef.current = e.target; }}
                    onChange={e => escrever(mapaAtual, l.chave, e.target.value)} />
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:5 }}>
                    <div style={{ display:'flex', gap:6 }}>
                      <VariableInserter compacto onInsert={m => inserirVariavel(
                        m, texto, t => escrever(mapaAtual, l.chave, t))} />
                      <button onClick={() => setModalBiblioteca({ ativa: true, alvo: { mapa: mapaAtual, chave: l.chave } })}
                        style={{ padding:'4px 8px', borderRadius:6, fontSize:9.5, fontWeight:700, cursor:'pointer', background:'oklch(1 0 0 / 0.05)', color:'var(--text2)', border:'1px solid oklch(1 0 0 / 0.1)' }}>
                        📚 Biblioteca
                      </button>
                      <button onClick={() => setModalIA({ ativa: true, alvo: { mapa: mapaAtual, chave: l.chave } })}
                        style={{ padding:'4px 8px', borderRadius:6, fontSize:9.5, fontWeight:700, cursor:'pointer', background:'rgba(139,92,246,.12)', color:'#a78bfa', border:'1px solid rgba(139,92,246,.28)' }}>
                        ✨ IA
                      </button>
                    </div>
                  </div>
                  {fichasVariaveis(texto)}
                </div>
              );
            })}

            {!linhas.length && (
              <div style={{ padding:'22px 0', textAlign:'center', color:'var(--text3)', fontSize:11.5 }}>
                {mode === 'per_account'
                  ? 'Selecione contas na etapa anterior.'
                  : 'Selecione conteúdos na etapa anterior.'}
              </div>
            )}
          </div>

          {/* Legenda geral como reserva */}
          <div style={{ marginTop:12, paddingTop:12, borderTop:'1px solid oklch(1 0 0 / 0.06)' }}>
            <div style={{ fontSize:10.5, color:'var(--text3)', marginBottom:6 }}>
              Legenda geral — usada onde o campo acima ficar vazio
            </div>
            <textarea className="input" rows={2} style={{ width:'100%', resize:'vertical', fontSize:12 }}
              placeholder={placeholder}
              value={captions?.global || ''}
              onFocus={e => { focadoRef.current = e.target; }}
              onChange={e => onChange?.({ ...(captions || {}), global: e.target.value })} />
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:8, marginTop:5 }}>
              <div style={{ display:'flex', gap:6 }}>
                <VariableInserter compacto onInsert={m => inserirVariavel(
                  m, captions?.global || '', t => onChange?.({ ...(captions || {}), global: t }))} />
                <button onClick={() => setModalBiblioteca({ ativa: true, alvo: { mapa: 'global', chave: 'global' } })}
                  style={{ padding:'4px 8px', borderRadius:6, fontSize:9.5, fontWeight:700, cursor:'pointer', background:'oklch(1 0 0 / 0.05)', color:'var(--text2)', border:'1px solid oklch(1 0 0 / 0.1)' }}>
                  📚 Biblioteca
                </button>
                <button onClick={() => setModalIA({ ativa: true, alvo: { mapa: 'global', chave: 'global' } })}
                  style={{ padding:'4px 8px', borderRadius:6, fontSize:9.5, fontWeight:700, cursor:'pointer', background:'rgba(139,92,246,.12)', color:'#a78bfa', border:'1px solid rgba(139,92,246,.28)' }}>
                  ✨ IA
                </button>
              </div>
              {contador(captions?.global || '')}
            </div>
            {fichasVariaveis(captions?.global || '')}
          </div>
        </>
      )}
      
      {/* Modal Biblioteca */}
      {modalBiblioteca.ativa && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', zIndex:999, display:'grid', placeItems:'center' }}
             onClick={(e) => { if (e.target === e.currentTarget) setModalBiblioteca({ ativa: false, alvo: null }); }}>
          <div style={{ background:'oklch(0.16 0.05 235)', padding:24, borderRadius:16, width:500, maxWidth:'95vw', border:'1px solid oklch(1 0 0 / 0.1)' }}>
            <h3 style={{ margin:'0 0 16px', fontSize:16, fontWeight:700 }}>Selecionar da Biblioteca</h3>
            <div style={{ display:'flex', flexDirection:'column', gap:10, maxHeight:'60vh', overflowY:'auto', paddingRight:8 }}>
              {legendsLib.map(lg => (
                <button key={lg._id} onClick={() => {
                  const { mapa, chave } = modalBiblioteca.alvo;
                  if (mapa === 'global') {
                    onChange({ ...captions, global: lg.text });
                  } else {
                    escrever(mapa, chave, lg.text);
                  }
                  setModalBiblioteca({ ativa: false, alvo: null });
                }} style={{ textAlign:'left', padding:12, borderRadius:10, background:'oklch(1 0 0 / 0.05)', border:'1px solid oklch(1 0 0 / 0.1)', cursor:'pointer', transition:'all 0.2s', ':hover':{background:'oklch(1 0 0 / 0.1)'} }}>
                  <div style={{ fontSize:12, fontWeight:700, color:'var(--cyan)', marginBottom:6 }}>{lg.name}</div>
                  <div style={{ fontSize:11, color:'var(--text2)', whiteSpace:'pre-wrap' }}>{lg.text}</div>
                </button>
              ))}
              {!legendsLib.length && (
                <div style={{ textAlign:'center', color:'var(--text3)', padding:20, fontSize:12 }}>Nenhuma legenda na biblioteca.</div>
              )}
            </div>
            <div style={{ marginTop:16, textAlign:'right' }}>
              <button onClick={() => setModalBiblioteca({ ativa: false, alvo: null })} style={{ padding:'8px 16px', borderRadius:8, background:'oklch(1 0 0 / 0.1)', color:'var(--text2)', border:'none', cursor:'pointer', fontWeight:600 }}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal IA */}
      {modalIA.ativa && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', zIndex:999, display:'grid', placeItems:'center' }}
             onClick={(e) => { if (e.target === e.currentTarget) setModalIA({ ativa: false, alvo: null }); }}>
          <div style={{ background:'oklch(0.16 0.05 235)', padding:24, borderRadius:16, width:500, maxWidth:'95vw', border:'1px solid oklch(1 0 0 / 0.1)' }}>
            <h3 style={{ margin:'0 0 8px', fontSize:16, fontWeight:700 }}>✨ Gerar Legenda com IA</h3>
            <p style={{ fontSize:12, color:'var(--text3)', margin:'0 0 16px' }}>Descreva o que deseja na legenda ou cole um modelo para a IA se inspirar.</p>
            <textarea className="input" rows={4} style={{ width:'100%', resize:'vertical', fontSize:13, marginBottom:16 }} placeholder="Ex: Crie uma legenda chamativa para um reels de comédia sobre rotina de trabalho. Use emojis divertidos e uma pergunta no final para engajar." id="ai-prompt-input"></textarea>
            <div style={{ display:'flex', justifyContent:'flex-end', gap:10 }}>
              <button onClick={() => setModalIA({ ativa: false, alvo: null })} style={{ padding:'8px 16px', borderRadius:8, background:'transparent', color:'var(--text3)', border:'none', cursor:'pointer', fontWeight:600 }}>Cancelar</button>
              <button onClick={() => {
                const p = document.getElementById('ai-prompt-input').value;
                if (!p.trim()) return;
                // Como não temos endpoint oficial de IA ainda, simulamos uma chamada.
                const { mapa, chave } = modalIA.alvo;
                const textoGerado = `✨ Aqui está a legenda gerada com base em: "${p.slice(0, 30)}..."\n\nQue incrível ver isso ganhando forma! Qual a sua opinião? 👇\n\n#novidade #{username}`;
                if (mapa === 'global') {
                  onChange({ ...captions, global: textoGerado });
                } else {
                  escrever(mapa, chave, textoGerado);
                }
                setModalIA({ ativa: false, alvo: null });
                alert('A integração real com IA deve ser feita no backend. Esta é uma simulação da interface.');
              }} style={{ padding:'8px 16px', borderRadius:8, background:'rgba(139,92,246,.2)', color:'#a78bfa', border:'1px solid rgba(139,92,246,.5)', cursor:'pointer', fontWeight:700 }}>
                🪄 Gerar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
