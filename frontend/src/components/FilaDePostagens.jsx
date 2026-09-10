import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
/* `Instagram` não existe nesta versão do lucide-react — o build recusa o
   import com "Missing export". `AtSign` diz a mesma coisa aqui e melhor: a
   coluna mostra um @, não a marca. */
import { List, Eye, Trash2, Info, AtSign, ChevronRight, ChevronLeft, Eraser } from 'lucide-react';
import api from '../services/api';
import { useServerEvents } from '../services/useServerEvents';
import { urlDoAvatar } from '../utils/avatar';

/**
 * A fila de postagens.
 *
 * ── O que a tela não respondia antes
 *
 * Havia uma lista de posts sem filtro e sem agrupamento — trinta linhas iguais.
 * Três perguntas ficavam sem resposta, e duas delas por falta de DADO, não de
 * interface:
 *
 *   "de que envio é esta linha?"  → o Post não guardava o job
 *   "quantas views deu?"          → o Post não guardava o id da mídia, então
 *                                   não havia como ligar a linha às métricas
 *                                   que já existiam em `Insight`
 *   "quais falharam, e por quê?"  → o motivo do erro estava no documento e não
 *                                   aparecia em lugar nenhum
 *
 * Os dois primeiros foram elos que faltavam. A interface veio depois deles, na
 * ordem certa: um seletor de campanha sem o vínculo no banco seria um controle
 * que não filtra nada.
 *
 * ── Sobre a coluna de views
 *
 * Ela mostra um traço quando não se sabe, e não zero. Publicação que ainda não
 * saiu, ou que saiu antes de o id da mídia passar a ser gravado, não tem
 * métrica — e "0 views" seria uma afirmação falsa sobre um post que pode ter
 * tido mil.
 */

/* Cada status ganha uma cor e um rótulo. Sem isto a coluna seria a palavra do
   banco em cinza, e "concluido" sem acento no meio de uma tela em português
   denuncia o campo cru. */
const ESTADOS = {
  pendente:    { rotulo: 'Na fila',     tom: 'var(--mf-text-3)' },
  processando: { rotulo: 'Publicando',  tom: 'var(--mf-info-500)' },
  concluido:   { rotulo: 'Publicado',   tom: 'var(--mf-success-500)' },
  parcial:     { rotulo: 'Parcial',     tom: 'var(--mf-warning-500)' },
  erro:        { rotulo: 'Falhou',      tom: 'var(--mf-danger-500)' },
  cancelado:   { rotulo: 'Cancelado',   tom: 'var(--mf-text-3)' },
};

const FORMATOS = { reel: 'REEL', post: 'POST', story: 'STORY' };

export default function FilaDePostagens({ mod = 'publicar' }) {
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [filtros, setFiltros] = useState({ status: 'todos', formato: 'todos', job: 'todos' });
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(10);
  const [limpando, setLimpando] = useState(false);
  const [erro, setErro] = useState('');

  /* Um contador em vez de uma função de recarga.
     Quem quer recarregar incrementa; o efeito abaixo reage. Assim existe UM só
     lugar que busca, e ele já sabe descartar resposta obsoleta. */
  const [recarga, setRecarga] = useState(0);
  const recarregar = useCallback(() => setRecarga(n => n + 1), []);

  /* ── A busca, com descarte de resposta atrasada ─────────────────────────

     `ignorar` não é cerimônia: trocar o filtro duas vezes rápido dispara duas
     requisições, e elas não voltam necessariamente na ordem em que saíram. Sem
     o descarte, a resposta do filtro ANTIGO pode chegar depois e ser a que
     fica na tela — o sintoma é "escolhi 'Falhou' e apareceu tudo".

     A busca mora dentro do efeito, e não numa função fora dele, porque é isso
     que permite o descarte ficar amarrado a esta execução específica. */
  useEffect(() => {
    let ignorar = false;

    (async () => {
      try {
        const { data } = await api.get('/posts/fila', {
          params: {
            ...(filtros.status !== 'todos' ? { status: filtros.status } : {}),
            ...(filtros.formato !== 'todos' ? { formato: filtros.formato } : {}),
            ...(filtros.job !== 'todos' ? { job: filtros.job } : {}),
            page: pagina, limit: porPagina,
          },
        });
        if (ignorar) return;
        setDados(data);
        setErro('');
      } catch (e) {
        if (ignorar) return;
        setErro(e.response?.data?.error || e.message);
      } finally {
        if (!ignorar) setCarregando(false);
      }
    })();

    return () => { ignorar = true; };
  }, [filtros, pagina, porPagina, recarga]);

  /* A fila muda sozinha — o worker publica sem ninguém olhando. O SSE evita
     que a tela fique mostrando um estado velho até alguém apertar F5. */
  useServerEvents(['posts'], recarregar);

  /* Trocar filtro volta para a primeira página. Sem isto, filtrar na página 2
     de um resultado que agora tem uma página mostraria a fila vazia — e
     pareceria que o filtro não achou nada. */
  const mudarFiltro = (campo, valor) => { setFiltros(f => ({ ...f, [campo]: valor })); setPagina(1); };

  async function apagar(id) {
    try { await api.delete(`/posts/${id}`); recarregar(); }
    catch (e) { setErro(e.response?.data?.error || e.message); }
  }

  async function limpar() {
    setLimpando(true);
    try {
      await api.post('/posts/fila/limpar');
      /* Volta para a primeira página: depois de limpar, a página em que se
         estava pode não existir mais. */
      setPagina(1);
      recarregar();
    } catch (e) { setErro(e.response?.data?.error || e.message); }
    finally { setLimpando(false); }
  }

  const p = dados?.paginacao;
  const itens = dados?.itens || [];

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .3 }}
      className="mf-card"
      style={{ '--mf-mod': `var(--mf-mod-${mod})`, minWidth: 0 }}
    >
      <div className="mf-card__head">
        <div className="mf-row" style={{ gap: 'var(--mf-2)', minWidth: 0 }}>
          <span style={{ width: 26, height: 26, borderRadius: 'var(--mf-r-sm)', display: 'grid', placeItems: 'center', flexShrink: 0,
            background: 'color-mix(in oklch, var(--mf-mod) 12%, transparent)',
            border: '1px solid color-mix(in oklch, var(--mf-mod) 26%, transparent)' }}>
            <List size={12} style={{ color: 'var(--mf-mod)' }} />
          </span>
          <span style={{ fontSize: 'var(--mf-t-h2)', fontWeight: 800, color: 'var(--mf-text)' }}>Fila de Postagens</span>
        </div>
        {p && p.total > 0 && (
          <span className="mf-mono" style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', flexShrink: 0 }}>
            {p.total} no total
          </span>
        )}
      </div>

      {/* ── Filtros ────────────────────────────────────────────────────────
          `<select>` de verdade, com aparência de pílula: some o teclado e a
          leitura de tela quando isto é um botão que abre um menu inventado.

          Não há filtro de REDE. O sistema publica só no Instagram — um seletor
          com uma opção é um controle que não filtra nada, e a tela já tem
          controles demais para ganhar um decorativo. */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '0 var(--mf-4) var(--mf-3)' }}>
        <Pilula rotulo="status" valor={filtros.status} onChange={v => mudarFiltro('status', v)}
          opcoes={[['todos', 'Todos os status'], ...(dados?.status || []).map(s => [s, ESTADOS[s]?.rotulo || s])]} />

        <Pilula rotulo="formato" valor={filtros.formato} onChange={v => mudarFiltro('formato', v)}
          opcoes={[['todos', 'Todos os formatos'], ...(dados?.formatos || []).map(f => [f, FORMATOS[f] || f])]} />

        <Pilula rotulo="envio" valor={filtros.job} onChange={v => mudarFiltro('job', v)}
          opcoes={[['todos', 'Todos os envios'], ...(dados?.envios || []).map(e => [e.id, e.nome])]} />

        <Pilula rotulo="por página" valor={String(porPagina)}
          onChange={v => { setPorPagina(Number(v)); setPagina(1); }}
          opcoes={[['10', '10 postagens'], ['25', '25 postagens'], ['50', '50 postagens']]} />

        <button onClick={limpar} disabled={limpando} className="btn-ghost tom-modulo"
          style={{ '--tom': 'var(--mf-danger-500)', color: 'var(--mf-danger-500)',
            background: 'color-mix(in oklch, var(--mf-danger-500) 9%, transparent)',
            fontSize: 'var(--mf-t-nano)', padding: '5px 11px' }}
          title="Apaga as que falharam e as canceladas. Não mexe no que ainda pode acontecer.">
          <Eraser size={11} /> {limpando ? 'Limpando…' : 'Limpar interrompidas/canceladas'}
        </button>
      </div>

      {erro && (
        <div style={{ margin: '0 var(--mf-4) var(--mf-3)', padding: '9px 11px', borderRadius: 'var(--mf-r-md)',
          background: 'color-mix(in oklch, var(--mf-danger-500) 10%, transparent)',
          border: '1px solid color-mix(in oklch, var(--mf-danger-500) 26%, transparent)',
          color: 'var(--mf-danger-500)', fontSize: 'var(--mf-t-micro)' }}>
          {erro}
        </div>
      )}

      {/* A tabela rola dentro do próprio invólucro: sete colunas não cabem em
          360px, e sem isto a PÁGINA rolaria de lado. */}
      <div style={{ overflowX: 'auto', padding: '0 var(--mf-4) var(--mf-3)' }}>
        {carregando ? (
          <Vazio texto="Carregando…" />
        ) : itens.length === 0 ? (
          <Vazio texto={filtros.status !== 'todos' || filtros.formato !== 'todos' || filtros.job !== 'todos'
            ? 'Nenhuma publicação com esses filtros.'
            : 'A fila está vazia.'} />
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
            <thead>
              <tr>
                {['Data/hora', 'Envio', 'Conta', 'Post', 'Status', 'Views', ''].map((h, i) => (
                  <th key={h || i} style={{ textAlign: i === 5 ? 'right' : 'left', padding: '0 10px 8px',
                    fontSize: 'var(--mf-t-nano)', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase',
                    color: 'var(--mf-text-3)', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {itens.map(item => <Linha key={item.id} item={item} onApagar={apagar} />)}
            </tbody>
          </table>
        )}
      </div>

      {p && p.total > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
          padding: 'var(--mf-3) var(--mf-4)', borderTop: '1px solid var(--mf-border)' }}>
          <span className="mf-mono" style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)' }}>
            Mostrando {p.de}–{p.ate} de {p.total}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="mf-mono" style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)' }}>
              Página {p.pagina} de {p.paginas}
            </span>
            <button className="btn-ghost" disabled={p.pagina <= 1} onClick={() => setPagina(n => Math.max(1, n - 1))}
              style={{ padding: '4px 9px', fontSize: 'var(--mf-t-nano)' }}>
              <ChevronLeft size={11} /> Anterior
            </button>
            <button className="btn-primary" disabled={p.pagina >= p.paginas} onClick={() => setPagina(n => n + 1)}
              style={{ padding: '4px 11px', fontSize: 'var(--mf-t-nano)' }}>
              Próxima <ChevronRight size={11} />
            </button>
          </div>
        </div>
      )}
    </motion.section>
  );
}

function Linha({ item, onApagar }) {
  const estado = ESTADOS[item.status] || { rotulo: item.status, tom: 'var(--mf-text-3)' };
  const quando = item.quando ? new Date(item.quando) : null;

  return (
    <tr style={{ borderTop: '1px solid var(--mf-border)' }}>
      <td style={{ padding: '10px', whiteSpace: 'nowrap' }}>
        <span className="mf-mono" style={{ fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-2)' }}>
          {quando
            ? `${quando.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${quando.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
            : '—'}
        </span>
      </td>

      <td style={{ padding: '10px', maxWidth: 160 }}>
        <span className="mf-trunc" style={{ display: 'block', fontSize: 'var(--mf-t-xs)', fontWeight: 700, color: 'var(--mf-text)' }}>
          {item.envio || '—'}
        </span>
      </td>

      <td style={{ padding: '10px', maxWidth: 190 }}>
        {/* Uma publicação pode ter mais de uma conta. Mostrar só a primeira
            mentiria sobre onde ela saiu. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {item.contas.length === 0 && (
            <span style={{ fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-3)', fontStyle: 'italic' }}>Conta removida</span>
          )}
          {item.contas.map(c => (
            <span key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              {c.avatar
                ? <img src={urlDoAvatar(c.avatar)} alt="" width={15} height={15}
                    style={{ borderRadius: 'var(--mf-r-full)', objectFit: 'cover', flexShrink: 0 }}
                    onError={e => { e.target.style.display = 'none'; }} />
                : <AtSign size={12} style={{ color: 'var(--mf-mod-contas)', flexShrink: 0 }} />}
              <span className="mf-trunc" style={{ fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-2)' }}>@{c.username}</span>
            </span>
          ))}
        </div>
      </td>

      <td style={{ padding: '10px' }}>
        <span className="mf-mono" style={{ fontSize: 'var(--mf-t-nano)', fontWeight: 700, padding: '2px 7px',
          borderRadius: 'var(--mf-r-xs)', color: 'var(--mf-text-2)',
          background: 'var(--mf-surface-2)', border: '1px solid var(--mf-border)', whiteSpace: 'nowrap' }}>
          {FORMATOS[item.formato] || item.formato}
        </span>
      </td>

      <td style={{ padding: '10px', maxWidth: 210 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--mf-t-nano)', fontWeight: 700,
          padding: '2px 8px', borderRadius: 'var(--mf-r-xl)', whiteSpace: 'nowrap',
          color: estado.tom,
          background: `color-mix(in oklch, ${estado.tom} 12%, transparent)`,
          border: `1px solid color-mix(in oklch, ${estado.tom} 28%, transparent)` }}>
          {/* O mesmo ponto de `.mf-badge__dot` — aqui à mão, porque a cor vem
              de `estado.tom` (um token por status) e não de `--mf-mod`, que é
              o que a classe global espera herdar. Pulsa só em "Publicando":
              é o único status em que algo está de fato acontecendo agora. */}
          <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 'var(--mf-r-full)',
            background: 'currentColor', flexShrink: 0,
            animation: item.status === 'processando' ? 'mf-pulse 1.6s var(--mf-ease-inout) infinite' : 'none' }} />
          {estado.rotulo}
          {item.erro && <Info size={10} />}
        </span>
        {/* O motivo do erro, na própria linha. Antes ele existia no documento e
            não aparecia em lugar nenhum: a linha dizia "erro" e pronto. */}
        {item.erro && (
          <span className="mf-trunc" title={item.erro}
            style={{ display: 'block', marginTop: 3, fontSize: 'var(--mf-t-nano)', color: 'var(--mf-danger-500)' }}>
            {item.erro}
          </span>
        )}
      </td>

      <td style={{ padding: '10px', textAlign: 'right', whiteSpace: 'nowrap' }}>
        {/* Traço, não zero, quando não se sabe: publicação que não saiu ainda
            não tem métrica, e "0 views" afirmaria algo falso. */}
        {item.views === null ? (
          <span style={{ fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-3)' }} title="Sem métrica ainda">—</span>
        ) : (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <Eye size={11} style={{ color: 'var(--mf-text-3)' }} />
            <span className="mf-mono" style={{ fontSize: 'var(--mf-t-xs)', fontWeight: 700, color: 'var(--mf-text)', fontVariantNumeric: 'tabular-nums' }}>
              {item.views.toLocaleString('pt-BR')}
            </span>
          </span>
        )}
      </td>

      <td style={{ padding: '10px', textAlign: 'right' }}>
        <button onClick={() => onApagar(item.id)} aria-label="Apagar esta publicação"
          className="btn-ghost tom-modulo"
          style={{ '--tom': 'var(--mf-danger-500)', color: 'var(--mf-danger-500)', padding: '4px 7px' }}>
          <Trash2 size={12} />
        </button>
      </td>
    </tr>
  );
}

/** Filtro com aparência de pílula e comportamento de `<select>`. */
function Pilula({ rotulo, valor, onChange, opcoes }) {
  return (
    <select aria-label={`Filtrar por ${rotulo}`} value={valor} onChange={e => onChange(e.target.value)}
      style={{
        appearance: 'none', cursor: 'pointer', maxWidth: 190,
        padding: '5px 11px', borderRadius: 'var(--mf-r-xl)',
        fontSize: 'var(--mf-t-nano)', fontWeight: 700,
        color: valor === 'todos' ? 'var(--mf-text-2)' : 'var(--mf-mod)',
        background: valor === 'todos'
          ? 'var(--mf-surface-2)'
          : 'color-mix(in oklch, var(--mf-mod) 12%, transparent)',
        border: `1px solid ${valor === 'todos' ? 'var(--mf-border)' : 'color-mix(in oklch, var(--mf-mod) 30%, transparent)'}`,
        textOverflow: 'ellipsis',
      }}>
      {opcoes.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
    </select>
  );
}

function Vazio({ texto }) {
  return (
    <div className="mf-empty" style={{ minHeight: 120, padding: 'var(--mf-4)' }}>
      <span className="mf-empty__ico"><List size={18} /></span>
      <span className="mf-empty__t">{texto}</span>
    </div>
  );
}
