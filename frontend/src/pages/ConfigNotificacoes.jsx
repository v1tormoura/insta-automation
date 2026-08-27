import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, Sparkles, Save, RotateCcw, Play } from 'lucide-react';
import api from '../services/api';
import PageShell from '../components/PageShell';
import Toast from '../components/Toast';
import { Cartao } from '../components/SmartActivity';
import { notificacaoDoNavegador } from '../services/notificacaoNavegador';
import { EsqueletoLista } from '../components/Estados';

/**
 * Editor do Smart Activity — mensagens, marcos e comportamento.
 *
 * ── Por que o preview usa o componente de verdade
 *
 * Um preview desenhado à parte é um preview que mente: ele acerta enquanto
 * ninguém mexe no cartão real, e a partir daí mostra uma coisa enquanto a tela
 * mostra outra — sem ninguém perceber, porque as duas foram escritas em
 * arquivos diferentes por motivos diferentes.
 *
 * Aqui o preview importa `Cartao`, o mesmo que a Central e o aviso usam. Se o
 * cartão mudar, o preview muda junto, porque é ele.
 *
 * ── Por que a validação acontece nos dois lados
 *
 * O editor avisa sobre `{{variavel_inexistente}}` enquanto se digita, e a rota
 * recusa a gravação se escapar mesmo assim. O editor existe para a pessoa
 * consertar cedo; o servidor existe porque o editor pode ser contornado.
 */

const METRICAS = [
  { id: 'storyViews',   rotulo: 'Stories',  desc: 'Quantas pessoas viram o story' },
  { id: 'contentViews', rotulo: 'Conteúdo', desc: 'Visualizações de Reels e posts' },
  { id: 'reach',        rotulo: 'Alcance',  desc: 'Contas únicas alcançadas' },
];

const TEMAS = ['story', 'viral', 'reach', 'milestone', 'achievement', 'success', 'warning', 'info'];

export default function ConfigNotificacoes() {
  const [cfg, setCfg] = useState(null);
  const [metrica, setMetrica] = useState('storyViews');
  const [salvando, setSalvando] = useState(false);
  const [toast, setToast] = useState(null);
  const [navegadorLigado, setNavegadorLigado] = useState(
    () => notificacaoDoNavegador.ligada() && notificacaoDoNavegador.permissao() === 'granted');

  const aviso = (type, title, message) => setToast({ type, title, message, id: Date.now() });

  const carregar = useCallback(async () => {
    try {
      const { data } = await api.get('/notificacoes/config');
      setCfg({
        thresholds: data.thresholds || {},
        ativos: data.ativos || {},
        exibicao: data.exibicao || {},
        mensagens: data.mensagens || {},
        variaveis: data.variaveis || {},
        modelosPadrao: data.modelosPadrao || {},
      });
    } catch {
      aviso('error', 'Erro', 'Não foi possível carregar as configurações.');
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  /* Modelo em edição: o do painel, ou o padrão do sistema como ponto de
     partida — nunca um campo vazio, que obrigaria a pessoa a inventar do zero
     o que o produto já sabe escrever. */
  const modelo = useMemo(() => {
    if (!cfg) return { titulo: '', mensagem: '', tema: 'milestone' };
    return cfg.mensagens[metrica] || cfg.modelosPadrao[metrica] || { titulo: '', mensagem: '', tema: 'milestone' };
  }, [cfg, metrica]);

  const mudarModelo = (campo, valor) => {
    setCfg(c => ({
      ...c,
      mensagens: { ...c.mensagens, [metrica]: { ...modelo, [campo]: valor } },
    }));
  };

  /* Variáveis usadas no texto que o sistema não conhece. */
  const invalidas = useMemo(() => {
    if (!cfg) return [];
    const conhecidas = Object.keys(cfg.variaveis);
    const achar = t => [...String(t || '').matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)]
      .map(m => m[1]).filter(v => !conhecidas.includes(v));
    return [...new Set([...achar(modelo.titulo), ...achar(modelo.mensagem)])];
  }, [cfg, modelo]);

  /* Renderização local, com os mesmos dados de exemplo do servidor. Local para
     o preview acompanhar cada tecla sem uma ida ao servidor por caractere. */
  const exemplo = useMemo(() => {
    const vars = {
      username: 'oliviapaganini', account: '@oliviapaganini',
      views: '1.024', threshold: '1.000', storyId: '178551331', content: '178551331',
      contentType: metrica === 'storyViews' ? 'Story' : 'Reel',
      time: 'há 2h', likes: '87', comments: '12', shares: '4', reach: '940',
    };
    const render = t => String(t || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,
      (inteiro, nome) => (nome in vars ? vars[nome] : inteiro));
    return {
      _id: 'preview',
      titulo: render(modelo.titulo) || 'Sem título',
      mensagem: render(modelo.mensagem),
      tema: modelo.tema || 'milestone',
      username: 'oliviapaganini',
      avatar: '',
      metricType: metrica,
      criadaEm: new Date().toISOString(),
      lidaEm: null,
    };
  }, [modelo, metrica]);

  async function salvar() {
    if (invalidas.length) {
      aviso('error', 'Variável desconhecida',
        `${invalidas.map(v => `{{${v}}}`).join(', ')} não existe. Use uma da lista.`);
      return;
    }
    setSalvando(true);
    try {
      await api.put('/notificacoes/config', {
        thresholds: cfg.thresholds,
        ativos: cfg.ativos,
        exibicao: cfg.exibicao,
        mensagens: cfg.mensagens,
      });
      aviso('success', 'Salvo', 'As notificações passam a usar estes modelos.');
    } catch (err) {
      const d = err.response?.data;
      aviso('error', d?.code === 'VARIAVEL_INVALIDA' ? 'Variável desconhecida' : 'Erro',
        d?.detalhes?.join(' · ') || d?.error || 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  }

  function restaurarModelo() {
    setCfg(c => {
      const m = { ...c.mensagens };
      delete m[metrica];
      return { ...c, mensagens: m };
    });
    aviso('info', 'Restaurado', 'O modelo voltou ao padrão do sistema.');
  }

  const rotulo = t => (
    <label style={{ display: 'block', fontSize: 'var(--mf-t-nano)', fontWeight: 700,
      color: 'var(--mf-text-3)', letterSpacing: '.05em', marginBottom: 6 }}>{t}</label>
  );

  const painel = (titulo, filhos) => (
    <div style={{ background: 'var(--mf-surface-1)', border: '1px solid var(--mf-border)',
      borderRadius: 'var(--mf-r-lg)', padding: 'var(--mf-4)' }}>
      {titulo && <h3 style={{ margin: '0 0 var(--mf-3)', fontSize: 'var(--mf-t-sm)',
        fontWeight: 700, color: 'var(--mf-text)' }}>{titulo}</h3>}
      {filhos}
    </div>
  );

  const acoes = (
    <>
      <button onClick={restaurarModelo} className="btn btn-ghost"
        style={{ fontSize: 'var(--mf-t-xs)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <RotateCcw size={13} /> Restaurar padrão
      </button>
      <button onClick={salvar} disabled={salvando || !!invalidas.length} className="btn btn-primary"
        style={{ fontSize: 'var(--mf-t-xs)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <Save size={13} /> {salvando ? 'Salvando…' : 'Salvar'}
      </button>
    </>
  );

  return (
    <PageShell
      icon={<Bell size={18} />}
      title="Smart Activity"
      subtitle="Avisos de marco e o que eles dizem"
      accent="cyan"
      actions={cfg ? acoes : null}
    >
      <div style={{ padding: '8px 20px 40px', display: 'flex', flexDirection: 'column', gap: 'var(--mf-4)' }}>

        {!cfg && <EsqueletoLista itens={3} />}

        {cfg && (
          <>
            {/* ── Métrica em edição ── */}
            <div style={{ display: 'flex', gap: 'var(--mf-2)', flexWrap: 'wrap' }}>
              {METRICAS.map(m => {
                const ativa = metrica === m.id;
                const ligada = cfg.ativos[m.id];
                return (
                  <button key={m.id} onClick={() => setMetrica(m.id)} style={{
                    flex: '1 1 180px', textAlign: 'left', padding: 'var(--mf-3)',
                    borderRadius: 'var(--mf-r-md)', cursor: 'pointer', minWidth: 0,
                    background: ativa ? 'color-mix(in oklch, var(--mf-primary-500) 12%, transparent)' : 'var(--mf-surface-1)',
                    border: `1px solid ${ativa ? 'color-mix(in oklch, var(--mf-primary-500) 38%, transparent)' : 'var(--mf-border)'}`,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <span style={{ fontSize: 'var(--mf-t-sm)', fontWeight: 700,
                        color: ativa ? 'var(--mf-primary-500)' : 'var(--mf-text)' }}>{m.rotulo}</span>
                      <span style={{ flex: 1 }} />
                      <span style={{
                        fontSize: 'var(--mf-t-nano)', fontWeight: 700, padding: '1px 7px',
                        borderRadius: 'var(--mf-r-full)',
                        background: ligada ? 'var(--mf-success-bg)' : 'var(--mf-border-subtle)',
                        color: ligada ? 'var(--mf-success-500)' : 'var(--mf-text-3)',
                      }}>{ligada ? 'ligado' : 'desligado'}</span>
                    </div>
                    <div style={{ fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)', marginTop: 3 }}>
                      {m.desc}
                    </div>
                  </button>
                );
              })}
            </div>

            <div style={{ display: 'grid', gap: 'var(--mf-4)',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))' }}>

              {/* ── Editor ── */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--mf-4)', minWidth: 0 }}>
                {painel('Mensagem', <>
                  <div style={{ marginBottom: 'var(--mf-3)' }}>
                    {rotulo('TÍTULO')}
                    <input className="input" style={{ width: '100%' }}
                      value={modelo.titulo}
                      onChange={e => mudarModelo('titulo', e.target.value)}
                      placeholder="Seu Story está bombando 🚀" />
                  </div>
                  <div style={{ marginBottom: 'var(--mf-3)' }}>
                    {rotulo('MENSAGEM')}
                    <textarea className="input" rows={3} style={{ width: '100%', resize: 'vertical' }}
                      value={modelo.mensagem}
                      onChange={e => mudarModelo('mensagem', e.target.value)}
                      placeholder="{{account}} chegou a {{views}} visualizações." />
                  </div>
                  <div>
                    {rotulo('APARÊNCIA')}
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                      {TEMAS.map(t => (
                        <button key={t} onClick={() => mudarModelo('tema', t)} style={{
                          fontSize: 'var(--mf-t-nano)', fontWeight: 700, padding: '4px 10px',
                          borderRadius: 'var(--mf-r-full)', cursor: 'pointer',
                          background: modelo.tema === t ? 'var(--mf-surface-3)' : 'transparent',
                          color: modelo.tema === t ? 'var(--mf-text)' : 'var(--mf-text-3)',
                          border: `1px solid ${modelo.tema === t ? 'var(--mf-border-strong)' : 'var(--mf-border)'}`,
                        }}>{t}</button>
                      ))}
                    </div>
                  </div>

                  {invalidas.length > 0 && (
                    <div style={{
                      marginTop: 'var(--mf-3)', padding: 'var(--mf-2) var(--mf-3)',
                      borderRadius: 'var(--mf-r-sm)', fontSize: 'var(--mf-t-xs)',
                      background: 'var(--mf-danger-bg)', color: 'var(--mf-danger-500)',
                      border: '1px solid color-mix(in oklch, var(--mf-danger-500) 30%, transparent)',
                    }}>
                      {invalidas.map(v => `{{${v}}}`).join(', ')} não existe.
                      O texto sairia com o marcador literal na tela.
                    </div>
                  )}
                </>)}

                {painel('Variáveis disponíveis', (
                  <div style={{ display: 'grid', gap: '3px 14px',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 210px), 1fr))' }}>
                    {Object.entries(cfg.variaveis).map(([nome, desc]) => (
                      <button key={nome}
                        onClick={() => mudarModelo('mensagem', `${modelo.mensagem || ''}{{${nome}}}`)}
                        title={desc}
                        style={{
                          display: 'flex', alignItems: 'baseline', gap: 7, padding: '4px 0',
                          background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
                          borderBottom: '1px solid var(--mf-border-subtle)', minWidth: 0,
                        }}>
                        <code style={{ fontSize: 'var(--mf-t-nano)', color: 'var(--mf-primary-500)',
                          fontFamily: 'var(--mf-mono)', flexShrink: 0 }}>{`{{${nome}}}`}</code>
                        <span style={{ fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{desc}</span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>

              {/* ── Preview e ajustes ── */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--mf-4)', minWidth: 0 }}>
                {painel(null, <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 'var(--mf-3)' }}>
                    <Sparkles size={13} style={{ color: 'var(--mf-primary-500)' }} />
                    <span style={{ fontSize: 'var(--mf-t-sm)', fontWeight: 700, color: 'var(--mf-text)' }}>
                      Como vai aparecer
                    </span>
                    <span style={{ flex: 1 }} />
                    <span style={{ fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)' }}>
                      cartão real, dados de exemplo
                    </span>
                  </div>
                  {/* O MESMO componente que a Central usa. Ver o comentário no topo. */}
                  <Cartao notificacao={exemplo} onFechar={() => {}} />
                </>)}

                {painel('Marcos', <>
                  <div style={{ fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)',
                    marginBottom: 'var(--mf-2)', lineHeight: 1.6 }}>
                    Um aviso por marco, uma única vez. Separe por vírgula.
                  </div>
                  <input className="input" style={{ width: '100%', fontFamily: 'var(--mf-mono)' }}
                    value={(cfg.thresholds[metrica] || []).join(', ')}
                    onChange={e => setCfg(c => ({
                      ...c,
                      thresholds: {
                        ...c.thresholds,
                        [metrica]: e.target.value.split(',').map(v => Number(v.trim())).filter(Boolean),
                      },
                    }))} />
                </>)}

                {painel('Comportamento', <>
                  {METRICAS.map(m => (
                    <label key={m.id} style={{
                      display: 'flex', alignItems: 'center', gap: 9, padding: '7px 0',
                      borderBottom: '1px solid var(--mf-border-subtle)', cursor: 'pointer',
                    }}>
                      <input type="checkbox" checked={!!cfg.ativos[m.id]}
                        onChange={e => setCfg(c => ({ ...c, ativos: { ...c.ativos, [m.id]: e.target.checked } }))} />
                      <span style={{ fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-2)' }}>
                        Avisar sobre {m.rotulo.toLowerCase()}
                      </span>
                    </label>
                  ))}

                  <label style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 0',
                    borderBottom: '1px solid var(--mf-border-subtle)', cursor: 'pointer' }}>
                    <input type="checkbox" checked={!!cfg.ativos.global}
                      onChange={e => setCfg(c => ({ ...c, ativos: { ...c.ativos, global: e.target.checked } }))} />
                    <span style={{ fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-2)' }}>
                      Resumo de todas as contas
                    </span>
                  </label>

                  {/* Notificação do navegador: a permissão só é pedida ao ligar
                      este interruptor. Ver o comentário em SmartActivity.jsx. */}
                  <label style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 0',
                    cursor: notificacaoDoNavegador.suportada() ? 'pointer' : 'not-allowed',
                    opacity: notificacaoDoNavegador.suportada() ? 1 : .5 }}>
                    <input type="checkbox" checked={navegadorLigado}
                      disabled={!notificacaoDoNavegador.suportada()}
                      onChange={async e => {
                        if (!e.target.checked) {
                          notificacaoDoNavegador.desligar();
                          setNavegadorLigado(false);
                          return;
                        }
                        const r = await notificacaoDoNavegador.ligar();
                        setNavegadorLigado(r === 'granted');
                        if (r === 'denied') aviso('warning', 'Permissão negada',
                          'O navegador bloqueou. Os avisos internos continuam funcionando.');
                      }} />
                    <span style={{ fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-2)' }}>
                      Avisar pelo navegador quando a aba estiver em segundo plano
                    </span>
                  </label>

                  <div style={{ marginTop: 'var(--mf-3)' }}>
                    {rotulo('SOME DEPOIS DE')}
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                      {[4000, 6000, 9000, 0].map(ms => (
                        <button key={ms}
                          onClick={() => setCfg(c => ({ ...c, exibicao: { ...c.exibicao, duracaoMs: ms } }))}
                          style={{
                            fontSize: 'var(--mf-t-nano)', fontWeight: 700, padding: '5px 11px',
                            borderRadius: 'var(--mf-r-sm)', cursor: 'pointer',
                            background: cfg.exibicao.duracaoMs === ms ? 'var(--mf-surface-3)' : 'transparent',
                            color: cfg.exibicao.duracaoMs === ms ? 'var(--mf-text)' : 'var(--mf-text-3)',
                            border: `1px solid ${cfg.exibicao.duracaoMs === ms ? 'var(--mf-border-strong)' : 'var(--mf-border)'}`,
                          }}>{ms ? `${ms / 1000}s` : 'só ao fechar'}</button>
                      ))}
                    </div>
                  </div>
                </>)}

                {painel('Primeira execução', (
                  <>
                    <div style={{ fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)',
                      lineHeight: 1.65, marginBottom: 'var(--mf-3)' }}>
                      Contas com histórico já passaram de vários marcos. Semear grava esses
                      marcos como <strong style={{ color: 'var(--mf-text-2)' }}>já avisados</strong>,
                      sem notificar — senão a estreia despeja centenas de avisos sobre
                      coisas de semanas atrás. Roda uma vez só.
                    </div>
                    <button onClick={async () => {
                      try {
                        const { data } = await api.post('/notificacoes/semear');
                        aviso(data.semeado ? 'success' : 'info',
                          data.semeado ? 'Semeado' : 'Nada a fazer',
                          data.semeado ? `${data.tetos} marco(s) marcados como já vistos.` : data.motivo);
                      } catch { aviso('error', 'Erro', 'Não foi possível semear.'); }
                    }} className="btn btn-ghost"
                      style={{ fontSize: 'var(--mf-t-xs)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <Play size={12} /> Semear marcos existentes
                    </button>
                  </>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      <Toast toast={toast} onClose={() => setToast(null)} />
    </PageShell>
  );
}
