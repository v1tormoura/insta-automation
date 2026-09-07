import { useState } from 'react';
import Segmentado from './Segmentado';
import { MARCA_PADRAO, POSICOES, TAMANHOS } from '../services/marcaDagua';

/**
 * Marca d'água com o @ de cada conta.
 *
 * ── Por que é um componente e não três telas
 *
 * A mesma marca é configurada no Postar, no Loop e na campanha. Escrita três
 * vezes, ela viraria três verdades sobre o mesmo recurso: a campanha ganharia
 * uma posição que o Loop não tem, o Postar guardaria a opacidade em escala
 * diferente, e o backend receberia três formas do mesmo objeto.
 *
 * ── O que o texto NÃO é
 *
 * Um campo. O texto é o @ de cada conta, resolvido no servidor na hora de
 * publicar. Um campo de texto aqui seria a marca de uma conta aparecendo no
 * vídeo de outra — e num sistema cujo objetivo é as contas não se parecerem,
 * isso é a assinatura de que todas saem do mesmo lugar.
 *
 * Props:
 *   aberto   — boolean
 *   valor    — { ativa, opacidade, posicao, tamanho }
 *   contas   — quantas contas estão selecionadas (só para o texto do cabeçalho)
 *   mod      — módulo do sistema para a cor ('publicar', 'campanhas', …)
 *   onCancelar, onAplicar — (config) => void
 */

/**
 * O invólucro existe só para montar o conteúdo a cada abertura.
 *
 * O rascunho tem de voltar ao valor salvo quando o modal reabre — senão
 * cancelar e abrir de novo mostraria o rascunho descartado como se tivesse sido
 * aplicado. A primeira versão fazia isso com um `useEffect` que reescrevia o
 * estado, o que a própria documentação do React desaconselha: é um render
 * jogado fora a cada abertura, e o lint aponta.
 *
 * Montando o conteúdo só quando aberto, o `useState` de dentro já nasce com o
 * valor certo e não há efeito nenhum a sincronizar.
 */
export default function MarcaDaguaModal({ aberto, ...resto }) {
  if (!aberto) return null;
  return <Conteudo {...resto} />;
}

function Conteudo({ valor, contas = 0, mod = 'publicar', onCancelar, onAplicar }) {
  /* Cópia local: mexer nos controles não deve alterar nada até Aplicar, senão
     Cancelar não cancela nada. */
  const [rascunho, setRascunho] = useState({ ...MARCA_PADRAO, ...(valor || {}) });

  const set = campo => v => setRascunho(r => ({ ...r, [campo]: v }));
  const desligada = !rascunho.ativa;

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ width: 'min(440px,100%)', '--mf-mod': `var(--mf-mod-${mod})` }}>

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 18 }}>
          <div style={{ width: 34, height: 34, borderRadius: 'var(--mf-r-md)', flexShrink: 0, display: 'grid', placeItems: 'center',
            background: 'color-mix(in oklch, var(--mf-mod) 14%, transparent)',
            border: '1px solid color-mix(in oklch, var(--mf-mod) 30%, transparent)',
            color: 'var(--mf-mod)' }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" />
            </svg>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 style={{ margin: 0, fontSize: 'var(--mf-t-h2)', fontWeight: 800 }}>Marca d'água</h3>
            <div style={{ fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-2)', marginTop: 3 }}>
              Aplica em <strong style={{ color: 'var(--mf-text)' }}>{contas}</strong> conta{contas === 1 ? '' : 's'} selecionada{contas === 1 ? '' : 's'}
            </div>
          </div>
          <button onClick={onCancelar} aria-label="Fechar"
            style={{ background: 'none', border: 'none', color: 'var(--mf-text-3)', fontSize: 'var(--mf-t-h1)', cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        {/* Ligar/desligar. O @ de cada conta está no rótulo porque é a resposta
            para a primeira pergunta de quem abre isto: qual texto vai sair. */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
          padding: '11px 13px', borderRadius: 'var(--mf-r-md)',
          background: rascunho.ativa ? 'color-mix(in oklch, var(--mf-mod) 9%, transparent)' : 'var(--mf-surface-2)',
          border: `1px solid ${rascunho.ativa ? 'color-mix(in oklch, var(--mf-mod) 28%, transparent)' : 'var(--mf-border)'}`,
          transition: 'background var(--mf-fast), border-color var(--mf-fast)' }}>
          <input type="checkbox" checked={rascunho.ativa} onChange={e => set('ativa')(e.target.checked)} />
          <span style={{ flex: 1, fontSize: 'var(--mf-t-sm)', fontWeight: 600, color: rascunho.ativa ? 'var(--mf-text)' : 'var(--mf-text-2)' }}>
            Ativar marca d'água <span style={{ color: 'var(--mf-text-3)', fontWeight: 500 }}>(@usuário de cada conta)</span>
          </span>
        </label>

        {/* Desligada, os controles continuam visíveis e inertes: escondê-los
            faria o modal saltar de altura ao ligar, e some a informação de o
            que se pode ajustar. */}
        <div aria-hidden={desligada} style={{ opacity: desligada ? 0.45 : 1, pointerEvents: desligada ? 'none' : 'auto', transition: 'opacity var(--mf-normal)' }}>

          <Rotulo>Opacidade
            <span className="mf-mono" style={{ color: 'var(--mf-mod)', fontWeight: 700 }}>{rascunho.opacidade}%</span>
          </Rotulo>
          <input type="range" min="5" max="100" step="5" value={rascunho.opacidade}
            onChange={e => set('opacidade')(Number(e.target.value))}
            disabled={desligada}
            style={{ width: '100%', accentColor: 'var(--mf-mod)', cursor: 'pointer' }} />

          <Rotulo>Posição</Rotulo>
          <Segmentado opcoes={POSICOES} valor={rascunho.posicao} onChange={set('posicao')} mod={mod} full rotulo="Posição da marca d'água" />

          <Rotulo>Tamanho</Rotulo>
          <Segmentado opcoes={TAMANHOS} valor={rascunho.tamanho} onChange={set('tamanho')} mod={mod} full rotulo="Tamanho da marca d'água" />

          {/* O que o Instagram cobre. Sem isto, quem escolhe "Inferior" acha
              que a marca não saiu — ela sai, atrás da legenda e dos botões. */}
          <div style={{ fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)', lineHeight: 1.7, marginTop: 12 }}>
            As três posições ficam dentro da área livre do reel — o Instagram
            desenha o autor e a câmera no topo, e a legenda e os botões na base.
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button className="btn-ghost" style={{ flex: 1, justifyContent: 'center' }} onClick={onCancelar}>
            Cancelar
          </button>
          <button className="btn-primary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => onAplicar(rascunho)}>
            Aplicar
          </button>
        </div>
      </div>
    </div>
  );
}

function Rotulo({ children }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      fontSize: 'var(--mf-t-micro)', fontWeight: 700, color: 'var(--mf-text-3)',
      letterSpacing: .5, textTransform: 'uppercase', margin: '18px 0 8px' }}>
      {children}
    </div>
  );
}
