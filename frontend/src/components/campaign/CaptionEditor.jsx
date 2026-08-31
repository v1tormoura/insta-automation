import { useEffect, useMemo, useRef, useState } from 'react';
import VariableInserter, { inserirNoCursor, useVariaveisSuportadas } from './VariableInserter';
import LegendLibraryModal from './LegendLibraryModal';
import AiCaptionModal from './AiCaptionModal';

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

  /* ── Alvo dos modais ───────────────────────────────────────────────────────
     Biblioteca e IA agem sobre um campo específico — o geral ou uma das chaves.
     Concentrar as três operações aqui evita repetir o `if (mapa === 'global')`
     em cada botão, que foi como a versão anterior duplicou o comportamento. */

  const textoDoAlvo = (alvo) => {
    if (!alvo) return '';
    return alvo.mapa === 'global' ? (captions?.global || '') : ler(alvo.mapa, alvo.chave);
  };

  const aplicarNoAlvo = (alvo, texto) => {
    if (!alvo) return;
    if (alvo.mapa === 'global') onChange?.({ ...(captions || {}), global: texto });
    else escrever(alvo.mapa, alvo.chave, texto);
  };

  /**
   * Rótulo legível do campo — vira contexto inicial do briefing da IA.
   * Lê `linhas`, declarada abaixo: a função só é chamada no JSX, depois da
   * inicialização, então não há problema de ordem.
   */
  const rotuloDoAlvo = (alvo) => {
    if (!alvo || alvo.mapa === 'global') return '';
    return linhas.find(l => l.chave === alvo.chave)?.rotulo || '';
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
                fontFamily:'var(--mf-mono)', fontSize: 'var(--mf-t-nano)', fontWeight:700,
                padding:'2px 6px', borderRadius: 'var(--mf-r-xs)',
                background: ok ? 'color-mix(in oklch, var(--mf-mod-contas) 12%, transparent)' : 'color-mix(in oklch, var(--mf-danger-500) 14%, transparent)',
                color:      ok ? 'var(--mf-mod, var(--mf-accent-500))' : 'var(--mf-danger-500)',
                border: `1px solid ${ok ? 'color-mix(in oklch, var(--mf-mod-contas) 25%, transparent)' : 'color-mix(in oklch, var(--mf-danger-500) 30%, transparent)'}`,
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
      fontFamily:'var(--mf-mono)', fontSize: 'var(--mf-t-nano)', flexShrink:0,
      color: texto.length > LIMITE ? 'var(--mf-danger-500)' : 'var(--mf-text-3)',
    }}>{texto.length}/{LIMITE}</span>
  );

  const botaoAcao = (rotulo, aoClicar, cor = 'var(--mf-text-3)') => (
    <button onClick={aoClicar} style={{
      padding:'5px 10px', borderRadius: 'var(--mf-r-sm)', fontSize: 'var(--mf-t-nano)', fontWeight:700, cursor:'pointer',
      background:'var(--mf-border-subtle)', color: cor, border:'1px solid var(--mf-border)',
    }}>{rotulo}</button>
  );

  return (
    <div style={{ background:'color-mix(in oklch, var(--mf-surface-1) 55%, transparent)', border:'1px solid var(--mf-border)',
      borderRadius: 'var(--mf-r-lg)', padding:16, marginBottom:14 }}>

      <h3 style={{ margin:'0 0 12px', fontSize: 'var(--mf-t-sm)', fontWeight:700 }}>{titulo}</h3>

      {/* Seletor de modo */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(min(160px,100%),1fr))', gap:7, marginBottom:14 }}>
        {MODOS.map(m => {
          const ativo = mode === m.id;
          return (
            <button key={m.id} onClick={() => onModeChange(m.id)} title={m.desc} style={{
              textAlign:'left', padding:'9px 11px', borderRadius: 'var(--mf-r-md)', cursor:'pointer', transition:'all .15s',
              background: ativo ? 'color-mix(in oklch, var(--mf-mod-contas) 10%, transparent)' : 'var(--mf-border-subtle)',
              border: `1px solid ${ativo ? 'color-mix(in oklch, var(--mf-mod-contas) 35%, transparent)' : 'var(--mf-border)'}`,
            }}>
              <div style={{ fontSize: 'var(--mf-t-micro)', fontWeight:700, color: ativo ? 'var(--mf-mod, var(--mf-accent-500))' : 'var(--mf-text-2)' }}>
                {m.rotulo}
              </div>
              <div style={{ fontSize: 'var(--mf-t-nano)', color:'var(--mf-text-3)', marginTop:2, lineHeight:1.4 }}>{m.desc}</div>
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
                style={{ padding:'4px 8px', borderRadius: 'var(--mf-r-sm)', fontSize: 'var(--mf-t-nano)', fontWeight:700, cursor:'pointer', background:'var(--mf-border-subtle)', color:'var(--mf-text-2)', border:'1px solid var(--mf-border)' }}>
                📚 Biblioteca
              </button>
              <button onClick={() => setModalIA({ ativa: true, alvo: { mapa: 'global', chave: 'global' } })}
                style={{ padding:'4px 8px', borderRadius: 'var(--mf-r-sm)', fontSize: 'var(--mf-t-nano)', fontWeight:700, cursor:'pointer', background:'color-mix(in oklch, var(--mf-mod-publicar) 12%, transparent)', color:'var(--mf-mod-publicar)', border:'1px solid color-mix(in oklch, var(--mf-mod-publicar) 28%, transparent)' }}>
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
              <div style={{ fontSize: 'var(--mf-t-nano)', color:'var(--mf-text-3)', marginBottom:6 }}>
                Escolha a conta para editar os textos dos conteúdos dela:
              </div>
              <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                {accounts.map(a => {
                  const ativa = contaAtiva === a.id;
                  const feitas = contents.filter(c => ler('byAccountContent', `${a.id}__${c.id}`).trim()).length;
                  return (
                    <button key={a.id} onClick={() => setContaAtiva(a.id)} style={{
                      padding:'6px 11px', borderRadius: 'var(--mf-r-sm)', fontSize: 'var(--mf-t-micro)', fontWeight:700, cursor:'pointer',
                      background: ativa ? 'color-mix(in oklch, var(--mf-mod-publicar) 16%, transparent)' : 'var(--mf-border-subtle)',
                      color:      ativa ? 'var(--mf-mod-publicar)' : 'var(--mf-text-3)',
                      border:     `1px solid ${ativa ? 'color-mix(in oklch, var(--mf-mod-publicar) 35%, transparent)' : 'var(--mf-border)'}`,
                    }}>
                      {a.label}
                      <span style={{ marginLeft:6, fontFamily:'var(--mf-mono)', fontSize: 'var(--mf-t-nano)', opacity:.8 }}>
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
            {botaoAcao('Aplicar a todas', aplicarATodas, 'var(--mf-mod, var(--mf-accent-500))')}
            {botaoAcao('Preencher vazias', duplicarNasVazias, 'var(--mf-mod-publicar)')}
            {botaoAcao('Limpar', limpar, 'var(--mf-danger-500)')}
            <span style={{ marginLeft:'auto', fontFamily:'var(--mf-mono)', fontSize: 'var(--mf-t-nano)', color:'var(--mf-text-3)' }}>
              {preenchidas}/{linhas.length} preenchidas
            </span>
          </div>

          {/* Linhas inline */}
          <div style={{ display:'flex', flexDirection:'column', gap:8, maxHeight:420, overflowY:'auto' }}>
            {linhas.map(l => {
              const texto = ler(mapaAtual, l.chave);
              return (
                <div key={l.chave} style={{
                  border:'1px solid var(--mf-border)', borderRadius: 'var(--mf-r-md)', padding:'9px 11px',
                  background:'color-mix(in oklch, var(--mf-bg) 50%, transparent)',
                }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:8, marginBottom:6 }}>
                    <span style={{ fontSize: 'var(--mf-t-micro)', fontWeight:700, overflow:'hidden',
                      textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{l.rotulo}</span>
                    {contador(texto)}
                  </div>
                  <textarea className="input" rows={2}
                    style={{ width:'100%', resize:'vertical', fontSize: 'var(--mf-t-xs)' }}
                    placeholder={captions.global ? `Vazio usa a legenda geral: "${captions.global.slice(0, 42)}${captions.global.length > 42 ? '…' : ''}"` : placeholder}
                    value={texto}
                    onFocus={e => { focadoRef.current = e.target; }}
                    onChange={e => escrever(mapaAtual, l.chave, e.target.value)} />
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:5 }}>
                    <div style={{ display:'flex', gap:6 }}>
                      <VariableInserter compacto onInsert={m => inserirVariavel(
                        m, texto, t => escrever(mapaAtual, l.chave, t))} />
                      <button onClick={() => setModalBiblioteca({ ativa: true, alvo: { mapa: mapaAtual, chave: l.chave } })}
                        style={{ padding:'4px 8px', borderRadius: 'var(--mf-r-sm)', fontSize: 'var(--mf-t-nano)', fontWeight:700, cursor:'pointer', background:'var(--mf-border-subtle)', color:'var(--mf-text-2)', border:'1px solid var(--mf-border)' }}>
                        📚 Biblioteca
                      </button>
                      <button onClick={() => setModalIA({ ativa: true, alvo: { mapa: mapaAtual, chave: l.chave } })}
                        style={{ padding:'4px 8px', borderRadius: 'var(--mf-r-sm)', fontSize: 'var(--mf-t-nano)', fontWeight:700, cursor:'pointer', background:'color-mix(in oklch, var(--mf-mod-publicar) 12%, transparent)', color:'var(--mf-mod-publicar)', border:'1px solid color-mix(in oklch, var(--mf-mod-publicar) 28%, transparent)' }}>
                        ✨ IA
                      </button>
                    </div>
                  </div>
                  {fichasVariaveis(texto)}
                </div>
              );
            })}

            {!linhas.length && (
              <div style={{ padding:'22px 0', textAlign:'center', color:'var(--mf-text-3)', fontSize: 'var(--mf-t-micro)' }}>
                {mode === 'per_account'
                  ? 'Selecione contas na etapa anterior.'
                  : 'Selecione conteúdos na etapa anterior.'}
              </div>
            )}
          </div>

          {/* Legenda geral como reserva */}
          <div style={{ marginTop:12, paddingTop:12, borderTop:'1px solid var(--mf-border)' }}>
            <div style={{ fontSize: 'var(--mf-t-nano)', color:'var(--mf-text-3)', marginBottom:6 }}>
              Legenda geral — usada onde o campo acima ficar vazio
            </div>
            <textarea className="input" rows={2} style={{ width:'100%', resize:'vertical', fontSize: 'var(--mf-t-xs)' }}
              placeholder={placeholder}
              value={captions?.global || ''}
              onFocus={e => { focadoRef.current = e.target; }}
              onChange={e => onChange?.({ ...(captions || {}), global: e.target.value })} />
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:8, marginTop:5 }}>
              <div style={{ display:'flex', gap:6 }}>
                <VariableInserter compacto onInsert={m => inserirVariavel(
                  m, captions?.global || '', t => onChange?.({ ...(captions || {}), global: t }))} />
                <button onClick={() => setModalBiblioteca({ ativa: true, alvo: { mapa: 'global', chave: 'global' } })}
                  style={{ padding:'4px 8px', borderRadius: 'var(--mf-r-sm)', fontSize: 'var(--mf-t-nano)', fontWeight:700, cursor:'pointer', background:'var(--mf-border-subtle)', color:'var(--mf-text-2)', border:'1px solid var(--mf-border)' }}>
                  📚 Biblioteca
                </button>
                <button onClick={() => setModalIA({ ativa: true, alvo: { mapa: 'global', chave: 'global' } })}
                  style={{ padding:'4px 8px', borderRadius: 'var(--mf-r-sm)', fontSize: 'var(--mf-t-nano)', fontWeight:700, cursor:'pointer', background:'color-mix(in oklch, var(--mf-mod-publicar) 12%, transparent)', color:'var(--mf-mod-publicar)', border:'1px solid color-mix(in oklch, var(--mf-mod-publicar) 28%, transparent)' }}>
                  ✨ IA
                </button>
              </div>
              {contador(captions?.global || '')}
            </div>
            {fichasVariaveis(captions?.global || '')}
          </div>
        </>
      )}
      
      {/* Biblioteca e IA vivem em componentes próprios: os dois têm estado de
          rede (busca, geração, erro) que não pertence ao editor de texto. */}
      <LegendLibraryModal
        aberta={modalBiblioteca.ativa}
        textoAtual={textoDoAlvo(modalBiblioteca.alvo)}
        onAplicar={texto => aplicarNoAlvo(modalBiblioteca.alvo, texto)}
        onFechar={() => setModalBiblioteca({ ativa: false, alvo: null })}
      />

      <AiCaptionModal
        aberta={modalIA.ativa}
        contexto={rotuloDoAlvo(modalIA.alvo)}
        textoAtual={textoDoAlvo(modalIA.alvo)}
        onAplicar={texto => aplicarNoAlvo(modalIA.alvo, texto)}
        onFechar={() => setModalIA({ ativa: false, alvo: null })}
      />
    </div>
  );
}
