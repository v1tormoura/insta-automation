import { useEffect, useMemo, useState } from 'react';
import brasil from '@svg-maps/brazil';
import api from '../services/api';

/**
 * Audiência por estado — mapa do Brasil com a demografia oficial da Meta.
 *
 * Os números vêm de `/dashboard/audiencia-estados`: a demografia por cidade de
 * cada conta (alcançados, engajados ou seguidores), somada no estado. Não há
 * estimativa — estado sem dado fica apagado.
 *
 * Mapa: @svg-maps/brazil (Victor Cazanave, CC BY 4.0).
 */

const RECORTES = [
  ['alcancados', 'Alcance'],
  ['engajados', 'Engajados'],
  ['seguidores', 'Seguidores'],
];
const ROTULO = { alcancados: 'Contas alcançadas', engajados: 'Contas engajadas', seguidores: 'Seguidores' };
const NOMES = Object.fromEntries(brasil.locations.map(l => [l.id, l.name]));
const fmt = n => Number(n || 0).toLocaleString('pt-BR');
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

/* Por que cada conta ficou fora do mapa — o servidor manda a situação de cada uma. */
const SITUACAO = {
  poucos_seguidores: 'menos de 100 seguidores (a Meta não libera)',
  fora_do_brasil: 'público deste mês fora do Brasil',
  sem_dados: 'a Meta ainda não liberou as cidades este mês',
  erro: 'a Meta recusou',
};
const NO_MES = { alcancados: 'contas alcançadas', engajados: 'contas engajadas' };

/**
 * A Meta esconde as cidades quando o público do mês é pequeno (abaixo de ~100
 * pessoas) e devolve vazio, sem erro. Com o total do mês da conta, a tela diz
 * qual dos dois casos é — em vez de deixar parecer defeito.
 */
function textoDaSituacao(c, recorte) {
  if (c.situacao !== 'sem_dados' || c.noMes == null || !NO_MES[recorte]) return SITUACAO[c.situacao] || c.situacao;
  return c.noMes < 100
    ? `só ${fmt(c.noMes)} ${NO_MES[recorte]} este mês — a Meta libera as cidades a partir de ~100`
    : `${fmt(c.noMes)} ${NO_MES[recorte]} este mês, mas a Meta ainda não liberou as cidades (ela esconde cidades com poucas pessoas)`;
}

function ForaDoMapa({ contas, recorte }) {
  const fora = (contas || []).filter(c => c.situacao !== 'ok');
  if (!fora.length) return null;
  return (
    <div data-fora-do-mapa style={{ display: 'grid', gap: 4, marginTop: 4 }}>
      <div style={{ fontSize: 'var(--mf-t-nano)', fontWeight: 700, letterSpacing: '.08em', color: 'var(--mf-text-3)' }}>
        FORA DO MAPA · {fora.length}
      </div>
      {fora.slice(0, 8).map(c => (
        <div key={c.username} title={c.erro || ''} style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', lineHeight: 1.4 }}>
          <strong style={{ color: 'var(--mf-text-2)' }}>@{c.username}</strong> · {textoDaSituacao(c, recorte)}
          {c.erro && <span style={{ color: 'var(--mf-danger-500)' }}>: {c.erro}</span>}
        </div>
      ))}
      {fora.length > 8 && <div style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)' }}>e mais {fora.length - 8}</div>}
    </div>
  );
}

/** A frase do mapa vazio, a partir do motivo de cada conta. */
function motivoDoVazio(contas) {
  if (!contas?.length) return 'Nenhuma conta conectada com a API para ler a audiência.';
  const conta = s => contas.filter(c => c.situacao === s).length;
  const partes = [
    conta('poucos_seguidores') && `${plural(conta('poucos_seguidores'), 'conta tem', 'contas têm')} menos de 100 seguidores`,
    conta('fora_do_brasil') && `${plural(conta('fora_do_brasil'), 'conta teve', 'contas tiveram')} público fora do Brasil`,
    conta('sem_dados') && `${plural(conta('sem_dados'), 'conta ainda não teve', 'contas ainda não tiveram')} as cidades liberadas pela Meta este mês (veja ao lado)`,
    conta('erro') && `${plural(conta('erro'), 'conta deu', 'contas deram')} erro na Meta (veja ao lado)`,
  ].filter(Boolean);
  return `Sem dados ainda: ${partes.join(' · ')}.`;
}

/** 0..1 → cor: do chão do cartão até o ciano do tema, com raiz para os estados pequenos aparecerem. */
function corDe(frac) {
  if (!frac) return 'color-mix(in oklch, var(--mf-surface-3) 70%, transparent)';
  const p = Math.round(18 + Math.sqrt(frac) * 82);
  return `color-mix(in oklch, var(--mf-primary-500) ${p}%, var(--mf-surface-2))`;
}

export default function MapaDeAudiencia() {
  const [recorte, setRecorte] = useState('alcancados');
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [sobre, setSobre] = useState(null);

  useEffect(() => {
    let vivo = true;
    api.get('/dashboard/audiencia-estados', { params: { metrica: recorte } })
      .then(r => { if (vivo) setDados(r.data); })
      .catch(() => { if (vivo) setDados(null); })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [recorte]);

  const estados = useMemo(() => dados?.estados || {}, [dados]);
  const total = dados?.total || 0;
  const maximo = Math.max(0, ...Object.values(estados));
  const ranking = useMemo(
    () => Object.entries(estados).sort((a, b) => b[1] - a[1]).slice(0, 6),
    [estados],
  );
  const alcancados = Object.keys(estados).length;
  const emFoco = sobre && { uf: sobre, nome: NOMES[sobre], valor: estados[sobre] || 0 };

  return (
    <section className="mf-card" style={{ overflow: 'hidden', padding: 0 }}>
      {/* Cabeçalho */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--mf-3)', flexWrap: 'wrap',
        padding: 'var(--mf-3) var(--mf-4)', borderBottom: '1px solid var(--mf-border)' }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--mf-primary-500)',
          boxShadow: '0 0 10px var(--mf-primary-500)', flexShrink: 0 }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 'var(--mf-t-sm)', fontWeight: 700, color: 'var(--mf-text)' }}>Audiência por estado</div>
          <div style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)' }}>Mapa de {ROTULO[recorte].toLowerCase()} · este mês</div>
        </div>
        <span style={{ flex: 1 }} />
        <div role="group" aria-label="Recorte do mapa" style={{ display: 'inline-flex', gap: 2, padding: 3,
          borderRadius: 'var(--mf-r-md)', background: 'var(--mf-surface-2)', border: '1px solid var(--mf-border)' }}>
          {RECORTES.map(([id, rot]) => {
            const ativo = id === recorte;
            return (
              <button key={id} type="button" onClick={() => { if (id !== recorte) { setCarregando(true); setRecorte(id); } }} aria-pressed={ativo}
                style={{ height: 26, padding: '0 12px', border: 'none', borderRadius: 'var(--mf-r-sm)', cursor: 'pointer',
                  fontSize: 'var(--mf-t-micro)', fontWeight: 700,
                  background: ativo ? 'var(--mf-primary-500)' : 'transparent',
                  color: ativo ? 'var(--mf-bg)' : 'var(--mf-text-3)' }}>
                {rot}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(200px, 240px)' }} className="mapa-audiencia__grade">
        {/* Mapa */}
        <div style={{ position: 'relative', padding: 'var(--mf-4)', minHeight: 320,
          display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ position: 'absolute', top: 'var(--mf-3)', right: 'var(--mf-3)', padding: '8px 10px', width: 110,
            borderRadius: 'var(--mf-r-sm)', background: 'var(--mf-surface-1)', border: '1px solid var(--mf-border)' }}>
            <div style={{ fontSize: 'var(--mf-t-nano)', fontWeight: 700, letterSpacing: '.08em', color: 'var(--mf-text-3)' }}>INTENSIDADE</div>
            <div style={{ height: 5, borderRadius: 3, margin: '6px 0 3px',
              background: `linear-gradient(90deg, ${corDe(0.02)}, ${corDe(1)})` }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)' }}>
              <span>0</span><span>{fmt(maximo)}</span>
            </div>
          </div>

          <svg viewBox={brasil.viewBox} role="img" aria-label="Mapa do Brasil por estado"
            style={{ width: '100%', maxWidth: 440, height: 'auto', opacity: carregando ? .5 : 1, transition: 'opacity .2s' }}>
            {brasil.locations.map(l => (
              <path key={l.id} d={l.path}
                fill={corDe(maximo ? (estados[l.id] || 0) / maximo : 0)}
                stroke={sobre === l.id ? 'var(--mf-text)' : 'color-mix(in oklch, var(--mf-border-strong) 80%, transparent)'}
                strokeWidth={sobre === l.id ? 1.4 : 0.7}
                onMouseEnter={() => setSobre(l.id)} onMouseLeave={() => setSobre(null)}
                style={{ cursor: 'default', transition: 'fill .3s' }}>
                <title>{`${l.name}: ${fmt(estados[l.id])}`}</title>
              </path>
            ))}
          </svg>

          {emFoco && (
            <div style={{ position: 'absolute', bottom: 'var(--mf-3)', left: 'var(--mf-3)', padding: '6px 10px',
              borderRadius: 'var(--mf-r-sm)', background: 'var(--mf-surface-1)', border: '1px solid var(--mf-border)',
              fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-2)' }}>
              <strong style={{ color: 'var(--mf-text)' }}>{emFoco.nome}</strong> · {fmt(emFoco.valor)}
              {total > 0 && <span style={{ color: 'var(--mf-text-3)' }}> ({((emFoco.valor / total) * 100).toFixed(1)}%)</span>}
            </div>
          )}

          {!carregando && total === 0 && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
              <div style={{ maxWidth: 300, textAlign: 'center', padding: 'var(--mf-3) var(--mf-4)', borderRadius: 'var(--mf-r-md)',
                background: 'color-mix(in oklch, var(--mf-surface-1) 88%, transparent)', border: '1px solid var(--mf-border)',
                fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', lineHeight: 1.6 }}>
                {dados ? motivoDoVazio(dados.contas) : 'Não deu para consultar a audiência agora.'}
              </div>
            </div>
          )}
        </div>

        {/* Coluna lateral */}
        <div style={{ borderLeft: '1px solid var(--mf-border)', padding: 'var(--mf-4)', display: 'flex', flexDirection: 'column', gap: 'var(--mf-3)' }}>
          {[
            [ROTULO[recorte], total, 'var(--mf-primary-500)'],
            ['Estados', alcancados, 'var(--mf-mod-publicar)'],
          ].map(([rot, val, cor]) => (
            <div key={rot} style={{ padding: 'var(--mf-3)', borderRadius: 'var(--mf-r-md)',
              background: `color-mix(in oklch, ${cor} 8%, var(--mf-surface-1))`,
              border: `1px solid color-mix(in oklch, ${cor} 22%, transparent)` }}>
              <div style={{ fontSize: 'var(--mf-t-nano)', fontWeight: 700, letterSpacing: '.08em', color: cor, textTransform: 'uppercase' }}>{rot}</div>
              <div style={{ fontSize: 'var(--mf-t-h1)', fontWeight: 800, color: 'var(--mf-text)', fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>{fmt(val)}</div>
            </div>
          ))}

          <div style={{ fontSize: 'var(--mf-t-nano)', fontWeight: 700, letterSpacing: '.08em', color: 'var(--mf-text-3)', marginTop: 4 }}>RANKING</div>
          {ranking.length === 0 && <div style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)' }}>—</div>}
          <div style={{ display: 'grid', gap: 8 }}>
            {ranking.map(([uf, v], i) => (
              <div key={uf} onMouseEnter={() => setSobre(uf)} onMouseLeave={() => setSobre(null)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 'var(--mf-t-micro)' }}>
                  <span style={{ color: 'var(--mf-text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <span style={{ color: 'var(--mf-text-3)', fontFamily: 'var(--mf-mono)', marginRight: 6 }}>{i + 1}</span>{NOMES[uf]}
                  </span>
                  <span style={{ color: 'var(--mf-text)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmt(v)}</span>
                </div>
                <div style={{ height: 4, borderRadius: 2, marginTop: 4, background: 'var(--mf-surface-3)', overflow: 'hidden' }}>
                  <div style={{ width: `${maximo ? (v / maximo) * 100 : 0}%`, height: '100%', borderRadius: 2,
                    background: 'linear-gradient(90deg, var(--mf-primary-500), var(--mf-glow, var(--mf-primary-500)))' }} />
                </div>
              </div>
            ))}
          </div>
          <ForaDoMapa contas={dados?.contas} recorte={recorte} />
        </div>
      </div>
      <style>{`@media (max-width: 720px) { .mapa-audiencia__grade { grid-template-columns: 1fr !important; } .mapa-audiencia__grade > div + div { border-left: none !important; border-top: 1px solid var(--mf-border); } }`}</style>
    </section>
  );
}
