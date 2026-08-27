import { useEffect, useRef, useState } from 'react';
import api from '../../services/api';

/**
 * Botão "inserir variável" com a lista REAL suportada pelo templateResolver.
 *
 * A lista vem de GET /campaigns/variables, não de uma cópia no frontend. Manter
 * duas listas garantiria que uma delas ficasse desatualizada e o usuário
 * inserisse uma marcação que a execução não resolve — que apareceria publicada
 * como texto literal.
 *
 * A variável é inserida na posição do cursor e o template continua BRUTO: a
 * resolução só acontece na publicação.
 */

// Descrição de cada marcação. Chaves ausentes aqui ainda aparecem na lista —
// o que manda é a resposta da API.
const DESCRICOES = {
  username:         'usuário da conta, sem @',
  account_username: 'mesmo que username',
  nome:             'nome de exibição da conta',
  name:             'mesmo que nome',
  campaign:         'nome da campanha',
  campaign_name:    'mesmo que campaign',
  content:          'nome do arquivo/conteúdo',
  content_name:     'mesmo que content',
  date:             'data da publicação',
  time:             'horário da publicação',
};

// Cache no módulo: o wizard monta vários editores e não faz sentido cada um
// pedir a mesma lista.
let _cache = null;

/**
 * Lista de marcações suportadas, vinda do backend.
 *
 * Exportado porque o editor também precisa dela para marcar em vermelho as
 * marcações que o resolvedor não conhece.
 */
export function useVariaveisSuportadas() {
  const [variaveis, setVariaveis] = useState(_cache || []);

  useEffect(() => {
    if (_cache) return;
    api.get('/campaigns/variables')
      .then(({ data }) => { _cache = data.variables || []; setVariaveis(_cache); })
      .catch(() => { /* sem lista, nada é marcado como inválido */ });
  }, []);

  return variaveis;
}

export default function VariableInserter({ onInsert, compacto = false }) {
  const [aberto, setAberto] = useState(false);
  const variaveis = useVariaveisSuportadas();
  const caixaRef = useRef(null);

  // Fecha ao clicar fora — sem isso o popover fica preso na tela.
  useEffect(() => {
    if (!aberto) return;
    const aoClicar = e => {
      if (caixaRef.current && !caixaRef.current.contains(e.target)) setAberto(false);
    };
    document.addEventListener('mousedown', aoClicar);
    return () => document.removeEventListener('mousedown', aoClicar);
  }, [aberto]);

  if (!variaveis.length) return null;

  return (
    <div ref={caixaRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => setAberto(a => !a)}
        title="Inserir marcação no texto"
        style={{
          padding: compacto ? '3px 8px' : '5px 10px',
          borderRadius: 'var(--mf-r-sm)', fontSize: compacto ? 10 : 10.5, fontWeight: 700, cursor: 'pointer',
          background: aberto ? 'color-mix(in oklch, var(--mf-mod-contas) 14%, transparent)' : 'var(--mf-border-subtle)',
          color: aberto ? 'var(--mf-mod, var(--mf-accent-500))' : 'var(--mf-text-3)',
          border: `1px solid ${aberto ? 'color-mix(in oklch, var(--mf-mod-contas) 35%, transparent)' : 'var(--mf-border)'}`,
          whiteSpace: 'nowrap',
        }}
      >
        {'{ }'} Inserir variável
      </button>

      {aberto && (
        <div style={{
          position: 'absolute', zIndex: 60, top: 'calc(100% + 6px)', left: 0,
          minWidth: 240, maxHeight: 260, overflowY: 'auto', padding: 6,
          borderRadius: 'var(--mf-r-md)', background: 'oklch(0.13 0.04 235 / 0.98)',
          border: '1px solid var(--mf-border-strong)', boxShadow: 'var(--mf-shadow-3)',
          backdropFilter: 'blur(12px)',
        }}>
          {variaveis.map(v => (
            <button
              key={v}
              type="button"
              onClick={() => { onInsert(`{${v}}`); setAberto(false); }}
              style={{
                display: 'block', width: '100%', textAlign: 'left', padding: '7px 9px',
                borderRadius: 'var(--mf-r-sm)', border: 'none', background: 'transparent', cursor: 'pointer',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--mf-border)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <span style={{ fontFamily: 'var(--mf-mono)', fontSize: 'var(--mf-t-micro)', fontWeight: 700, color: 'var(--mf-mod, var(--mf-accent-500))' }}>
                {`{${v}}`}
              </span>
              {DESCRICOES[v] && (
                <span style={{ display: 'block', fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)', marginTop: 2 }}>
                  {DESCRICOES[v]}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Insere texto na posição do cursor de um textarea/input.
 *
 * Concatenar no fim seria mais simples, mas quebra o fluxo de quem está
 * escrevendo no meio da frase — que é o caso comum ao inserir uma marcação.
 */
export function inserirNoCursor(elemento, valorAtual, textoInserir) {
  if (!elemento || typeof elemento.selectionStart !== 'number') {
    return { texto: `${valorAtual || ''}${textoInserir}`, cursor: null };
  }
  const ini = elemento.selectionStart;
  const fim = elemento.selectionEnd;
  const texto = `${valorAtual.slice(0, ini)}${textoInserir}${valorAtual.slice(fim)}`;
  return { texto, cursor: ini + textoInserir.length };
}
