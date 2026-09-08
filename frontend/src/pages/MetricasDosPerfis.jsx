import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Users, TrendingUp, Heart, Eye, Clock, BarChart3, List } from 'lucide-react';
import api from '../services/api';
import PageShell from '../components/PageShell';
import { urlDoAvatar, iniciaisDe } from '../utils/avatar';

/**
 * Métricas dos perfis — somadas de todas as contas conectadas.
 *
 * ── Duas grandezas diferentes na mesma tela
 *
 * SEGUIDORES é um ESTOQUE: é sempre o número de agora, qualquer que seja o
 * período. Não existe "seguidores de ontem" no que está gravado — o campo é
 * sobrescrito a cada sincronização. Por isso o cartão não muda ao trocar o
 * filtro, e o rótulo diz "agora" em vez de repetir o período.
 *
 * CURTIDAS e VIEWS são FLUXOS: acontecem dentro do período e mudam com ele.
 *
 * Tratar as duas como a mesma coisa é o erro fácil aqui — um cartão de
 * seguidores que reage ao filtro estaria mentindo sobre um dado que não existe.
 *
 * ── Sobre "novos seguidores"
 *
 * Vem de uma série diária, construída para responder isso. Ela começa no dia
 * em que entrou em produção: crescimento anterior não existe em lugar nenhum.
 * Quando não há medição, o cartão mostra "—" e diz por quê, em vez de "+0" —
 * "não sei" e "ninguém seguiu" são respostas diferentes.
 */

const PERIODOS = [
  ['hoje',  'Hoje'],
  ['ontem', 'Ontem'],
  ['7d',    '7 dias'],
  ['30d',   '30 dias'],
  ['total', 'Total'],
];

const fmt = n => Number(n || 0).toLocaleString('pt-BR');

export default function MetricasDosPerfis() {
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [periodo, setPeriodo] = useState('hoje');
  /* A faixa só entra na consulta quando o botão Filtrar é apertado. Digitar
     uma data não deve disparar dez requisições enquanto se escolhe a outra. */
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');
  const [faixa, setFaixa] = useState(null);

  useEffect(() => {
    let ignorar = false;
    (async () => {
      try {
        const { data } = await api.get('/analytics/metricas-dos-perfis', {
          params: faixa ? { de: faixa.de, ate: faixa.ate } : { periodo },
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
  }, [periodo, faixa]);

  const d = dados || {};

  const CARTOES = [
    {
      rotulo: 'Seguidores totais', valor: fmt(d.seguidores), Icone: Users,
      cor: 'var(--mf-mod-contas)',
      /* Não diz o período de propósito: seguidores é estoque. */
      nota: 'Somado de todas as contas conectadas — agora',
    },
    {
      rotulo: 'Novos seguidores', Icone: TrendingUp, cor: 'var(--mf-success-500)',
      /* "—" quando não há série. Um "+0" afirmaria que ninguém seguiu. */
      valor: d.novosSeguidoresMedido
        ? `${d.novosSeguidores > 0 ? '+' : ''}${fmt(d.novosSeguidores)}`
        : '—',
      nota: d.novosSeguidoresMedido
        ? `Crescimento — ${d.rotulo || ''}`
        : 'Ainda sem histórico para comparar',
    },
    {
      rotulo: 'Curtidas', valor: fmt(d.curtidas), Icone: Heart,
      cor: 'var(--mf-danger-500)', nota: `Nos posts publicados — ${d.rotulo || ''}`,
    },
    {
      rotulo: 'Views (posts)', valor: fmt(d.viewsPosts), Icone: Eye,
      cor: 'var(--mf-mod-publicar)', nota: d.rotulo || '',
    },
    {
      rotulo: 'Views nos stories', valor: fmt(d.viewsStories), Icone: Clock,
      cor: 'var(--mf-warning-500)', nota: d.rotulo || '',
    },
  ];

  return (
    <PageShell
      icon={<BarChart3 size={18} />}
      title="Métricas dos Perfis"
      subtitle="Seguidores, novos seguidores e curtidas — somados de todas as suas contas conectadas"
      accent="green"
    >
      {/* ── Filtros ──────────────────────────────────────────────────────────
          Sem seletor de REDE: o sistema publica só no Instagram, e um controle
          com uma opção não filtra nada. A coluna "Rede" da tabela fica, porque
          ali ela informa em vez de prometer uma escolha. */}
      <section className="mf-card" style={{ padding: 'var(--mf-4)', display: 'grid', gap: 'var(--mf-3)' }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {PERIODOS.map(([k, r]) => {
            const ativo = !faixa && periodo === k;
            return (
              <button key={k} onClick={() => { setFaixa(null); setPeriodo(k); }}
                className={ativo ? 'btn-primary' : 'btn-ghost'}
                style={{ padding: '5px 14px', fontSize: 'var(--mf-t-xs)' }}>
                {r}
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', gap: 'var(--mf-3)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ flex: '1 1 170px', minWidth: 0 }}>
            <span style={rotulo}>De</span>
            <input className="inp" type="date" value={de} onChange={e => setDe(e.target.value)} />
          </label>
          <label style={{ flex: '1 1 170px', minWidth: 0 }}>
            <span style={rotulo}>Até</span>
            <input className="inp" type="date" value={ate} onChange={e => setAte(e.target.value)} />
          </label>
          {/* Só habilita com as DUAS datas: uma faixa pela metade não é uma
              faixa, e o servidor a ignoraria sem dizer nada. */}
          <button className="btn-primary" disabled={!de || !ate}
            onClick={() => setFaixa({ de, ate })}
            style={{ padding: '9px 20px' }}>
            Filtrar
          </button>
          {faixa && (
            <button className="btn-ghost" onClick={() => { setFaixa(null); setDe(''); setAte(''); }}
              style={{ padding: '9px 14px', fontSize: 'var(--mf-t-xs)' }}>
              Limpar faixa
            </button>
          )}
        </div>
      </section>

      {erro && (
        <div style={{ padding: '11px 13px', borderRadius: 'var(--mf-r-md)',
          background: 'color-mix(in oklch, var(--mf-danger-500) 10%, transparent)',
          border: '1px solid color-mix(in oklch, var(--mf-danger-500) 26%, transparent)',
          color: 'var(--mf-danger-500)', fontSize: 'var(--mf-t-micro)' }}>
          {erro}
        </div>
      )}

      {/* Os cinco cartões. `auto-fit` e não cinco colunas fixas: em 1280 cabem
          cinco, em 900 cabem três, e uma grade fixa cortaria os números. */}
      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 190px), 1fr))' }}>
        {CARTOES.map((c, i) => (
          <motion.div key={c.rotulo} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * .05, duration: .28 }}
            style={{ '--c': c.cor, position: 'relative', overflow: 'hidden', minWidth: 0,
              containerType: 'inline-size',
              background: 'color-mix(in oklch, var(--c) 8%, transparent)',
              border: '1px solid color-mix(in oklch, var(--c) 20%, transparent)',
              borderRadius: 'var(--mf-r-lg)', padding: 'var(--mf-4)' }}>
            <span aria-hidden="true" style={{ position: 'absolute', inset: 'auto -8px -12px auto',
              width: 52, height: 52, borderRadius: 'var(--mf-r-full)',
              background: 'radial-gradient(circle, color-mix(in oklch, var(--c) 18%, transparent), transparent 70%)' }} />
            <c.Icone size={14} style={{ color: c.cor, display: 'block' }} />
            <div className="mf-mono" style={{ fontSize: 'clamp(1.4rem, 1.1rem + 1.6cqw, 1.85rem)', fontWeight: 650,
              color: c.cor, lineHeight: 1, letterSpacing: '-.03em', marginTop: 'var(--mf-3)',
              fontVariantNumeric: 'tabular-nums' }}>
              {carregando ? '…' : c.valor}
            </div>
            <div style={{ fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-2)', marginTop: 6, fontWeight: 700 }}>
              {c.rotulo}
            </div>
            <div style={{ fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)', marginTop: 2, lineHeight: 1.5 }}>
              {c.nota}
            </div>
          </motion.div>
        ))}
      </div>

      {/* O aviso do histórico curto. Aparece só quando há contas sem série —
          um aviso permanente viraria paisagem. */}
      {!carregando && d.contasSemHistorico > 0 && (
        <div style={{ padding: '10px 13px', borderRadius: 'var(--mf-r-md)',
          background: 'color-mix(in oklch, var(--mf-warning-500) 9%, transparent)',
          border: '1px solid color-mix(in oklch, var(--mf-warning-500) 26%, transparent)',
          color: 'var(--mf-warning-500)', fontSize: 'var(--mf-t-nano)', lineHeight: 1.7 }}>
          {d.contasSemHistorico} conta{d.contasSemHistorico === 1 ? '' : 's'} ainda sem histórico de
          seguidores. O crescimento passa a ser medido a partir do primeiro registro de cada conta —
          o número anterior era sobrescrito a cada sincronização e não existe mais.
        </div>
      )}

      <section className="mf-card" style={{ minWidth: 0 }}>
        <div className="mf-card__head">
          <div className="mf-row" style={{ gap: 'var(--mf-2)', minWidth: 0 }}>
            <List size={13} style={{ color: 'var(--mf-mod, var(--mf-accent-500))' }} />
            <span style={{ fontSize: 'var(--mf-t-h2)', fontWeight: 800 }}>Por conta</span>
          </div>
          {d.rotulo && (
            <span className="mf-mono" style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)' }}>
              {d.rotulo}
            </span>
          )}
        </div>

        <div style={{ overflowX: 'auto', padding: '0 var(--mf-4) var(--mf-4)' }}>
          {carregando ? (
            <Vazio texto="Carregando…" />
          ) : !(d.contas || []).length ? (
            <Vazio texto="Nenhuma conta conectada." />
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
              <thead>
                <tr>
                  {['Conta', 'Rede', 'Seguidores', 'Curtidas', 'Views (posts)', 'Views (stories)', 'Última sincronização']
                    .map((h, i) => (
                      <th key={h} style={{ textAlign: i >= 2 && i <= 5 ? 'right' : 'left',
                        padding: '0 10px 8px', fontSize: 'var(--mf-t-nano)', fontWeight: 700,
                        letterSpacing: '.08em', textTransform: 'uppercase',
                        color: 'var(--mf-text-3)', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                </tr>
              </thead>
              <tbody>
                {d.contas.map(c => <LinhaConta key={c.id} conta={c} />)}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </PageShell>
  );
}

function LinhaConta({ conta }) {
  const foto = urlDoAvatar(conta.avatar);
  const quando = conta.sincronizadoEm ? new Date(conta.sincronizadoEm) : null;

  return (
    <tr style={{ borderTop: '1px solid var(--mf-border)' }}>
      <td style={{ padding: '10px', maxWidth: 210 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ width: 24, height: 24, flexShrink: 0, borderRadius: 'var(--mf-r-full)',
            overflow: 'hidden', display: 'grid', placeItems: 'center',
            background: 'var(--mf-surface-3)', fontSize: 'var(--mf-t-nano)', fontWeight: 700,
            color: 'var(--mf-text-3)' }}>
            {foto
              ? <img src={foto} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  onError={e => { e.target.style.display = 'none'; }} />
              : iniciaisDe(conta.username)}
          </span>
          <span className="mf-trunc" style={{ fontSize: 'var(--mf-t-xs)', fontWeight: 700, color: 'var(--mf-text)' }}>
            @{conta.username}
          </span>
        </span>
      </td>
      <td style={{ padding: '10px' }}>
        <span style={{ fontSize: 'var(--mf-t-nano)', fontWeight: 700, padding: '2px 8px',
          borderRadius: 'var(--mf-r-xl)', whiteSpace: 'nowrap',
          color: 'var(--mf-mod-contas)',
          background: 'color-mix(in oklch, var(--mf-mod-contas) 12%, transparent)',
          border: '1px solid color-mix(in oklch, var(--mf-mod-contas) 28%, transparent)' }}>
          Instagram
        </span>
      </td>
      <Num v={conta.seguidores} />
      <Num v={conta.curtidas} />
      <Num v={conta.viewsPosts} />
      <Num v={conta.viewsStories} />
      <td style={{ padding: '10px', whiteSpace: 'nowrap' }}>
        <span className="mf-mono" style={{ fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)' }}>
          {quando
            ? `${quando.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${quando.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
            : 'nunca'}
        </span>
      </td>
    </tr>
  );
}

function Num({ v }) {
  return (
    <td style={{ padding: '10px', textAlign: 'right', whiteSpace: 'nowrap' }}>
      <span className="mf-mono" style={{ fontSize: 'var(--mf-t-xs)', fontWeight: 700,
        color: 'var(--mf-text)', fontVariantNumeric: 'tabular-nums' }}>
        {fmt(v)}
      </span>
    </td>
  );
}

function Vazio({ texto }) {
  return (
    <div className="mf-empty" style={{ minHeight: 110, padding: 'var(--mf-4)' }}>
      <span className="mf-empty__ico"><BarChart3 size={18} /></span>
      <span className="mf-empty__t">{texto}</span>
    </div>
  );
}

const rotulo = {
  display: 'block', marginBottom: 6,
  fontSize: 'var(--mf-t-micro)', fontWeight: 700, color: 'var(--mf-text-3)',
  letterSpacing: .5, textTransform: 'uppercase',
};
