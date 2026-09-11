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

/**
 * Os avisos de MARCO: nascem de uma métrica ter subido, têm marcos
 * configuráveis e podem ser desligados.
 */
const METRICAS = [
  { id: 'storyViews',   rotulo: 'Stories',  desc: 'Quantas pessoas viram o story' },
  { id: 'contentViews', rotulo: 'Conteúdo', desc: 'Visualizações de Reels e posts' },
  { id: 'reach',        rotulo: 'Alcance',  desc: 'Contas únicas alcançadas' },
];

/**
 * Os avisos do SISTEMA: nascem do vigia encontrando um problema.
 *
 * Estes eram os únicos com texto embutido no código — não por decisão, e sim
 * porque foram escritos depois do editor. Agora usam o mesmo modelo dos marcos.
 *
 * Não têm marcos nem interruptor: um proxy morto não tem "marco de 1.000", e
 * um botão para desligar o aviso de que a automação parou seria um botão para
 * desligar a única coisa que avisa que a automação parou.
 */
const SISTEMA = [
  { id: 'cota',        rotulo: 'Cota do proxy',      desc: 'Antes de a cota acabar' },
  { id: 'proxy',       rotulo: 'Proxy fora do ar',   desc: 'O proxy parou de responder' },
  { id: 'pool',        rotulo: 'Pool esgotado',      desc: 'Não há proxy livre para a próxima conta' },
  { id: 'sessoes',     rotulo: 'Contas sem conectar', desc: 'Quando é a maioria de uma vez' },
  { id: 'fila',        rotulo: 'Fila presa',         desc: 'Publicação em processamento há mais de 1h' },
  { id: 'erros',       rotulo: 'Erros do dia',       desc: 'Muitos erros de publicação no mesmo dia' },
  { id: 'normalizado', rotulo: 'Voltou ao normal',   desc: 'O aviso de que um problema passou' },
];

const RESUMO = { id: 'resumo', rotulo: 'Resumo do dia', desc: 'O balanço de todas as contas' };

/**
 * Os avisos de PUBLICAÇÃO: nascem no instante em que a publicação sai (ou
 * falha), sem esperar métrica nenhuma chegar do Instagram. Têm interruptor,
 * como os marcos, mas não têm marco nenhum para configurar — cada publicação
 * já É o evento, não algo que precisa cruzar um teto.
 */
const PUBLICACAO = [
  { id: 'postPublicado',  rotulo: 'Publicado',        desc: 'Quando uma publicação sai com sucesso' },
  { id: 'erroPublicacao', rotulo: 'Falha ao publicar', desc: 'Quando uma publicação falha' },
];

/** Todo aviso editável, por id — para achar o rótulo sem varrer as listas. */
const TODOS = [...METRICAS, RESUMO, ...PUBLICACAO, ...SISTEMA];
const PELO_ID = Object.fromEntries(TODOS.map(a => [a.id, a]));

/** Um aviso do sistema não tem marcos nem interruptor. */
const ehDoSistema = id => SISTEMA.some(a => a.id === id);

/** Um aviso de publicação tem interruptor, mas não tem marco para configurar. */
const ehDePublicacao = id => PUBLICACAO.some(a => a.id === id);

/**
 * A condição real de disparo de cada aviso do sistema.
 *
 * Está escrita aqui porque quem edita o texto precisa saber QUANDO ele sai —
 * um limiar de "mais de uma hora" muda como a frase é redigida. Os números
 * vêm do vigia: mudá-los lá sem mudar aqui deixaria esta tela mentindo, e é
 * por isso que a frase cita o número em vez de dizer "quando trava".
 */
const GATILHO = {
  cota:    'Quando a cota passa de 85% do total, ou quando a projeção mostra 5 dias ou menos até acabar.',
  proxy:   'Quando um teste de conexão ao proxy configurado falha.',
  pool:    'Quando nenhum proxy do pool está livre para a próxima conta.',
  sessoes: 'Quando metade ou mais das contas está sem conseguir conectar.',
  fila:    'Quando uma publicação fica em processamento por mais de 1 hora.',
  erros:   'Quando o dia acumula 20 erros de publicação ou mais.',
  normalizado: 'Quando qualquer um dos avisos acima deixa de valer — o problema passou.',
};

const TEMAS = ['story', 'viral', 'reach', 'milestone', 'achievement', 'success', 'warning', 'info'];

export default function ConfigNotificacoes() {
  const [cfg, setCfg] = useState(null);
  const [metrica, setMetrica] = useState('storyViews');
  const [salvando, setSalvando] = useState(false);
  const [toast, setToast] = useState(null);
  const [navegadorLigado, setNavegadorLigado] = useState(
    () => notificacaoDoNavegador.ligada() && notificacaoDoNavegador.permissao() === 'granted');
  /* Por que o interruptor não pode ser ligado, quando não pode. Um botão que
     não faz nada e não diz por quê é pior que um botão ausente. */
  const [diagnostico] = useState(() => notificacaoDoNavegador.diagnostico());
  /* Guarda QUAL aviso está sendo testado, não um booleano. Com três botões,
     um `testando` compartilhado acenderia os três de uma vez e ninguém saberia
     qual está em voo. */
  const [testando, setTestando] = useState('');

  /* Envia um aviso real aos aparelhos inscritos, SEM gravar nada na central.
     A distinção importa: a central é o registro do que aconteceu, e um teste
     que se grava ali inventaria um marco que ninguém atingiu. */
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
        /* Quais variáveis cada aviso oferece. Sem isto o editor listaria
           `{{presas}}` num aviso de story: existe no sistema, não existe ali,
           e sairia como marcador literal na notificação. */
        variaveisPorTipo: data.variaveisPorTipo || {},
        /* Os valores de exemplo vêm do servidor. Antes estavam escritos aqui
           também, e duas listas da mesma coisa divergem na primeira variável
           nova — foi exatamente o que aconteceu com as sete do sistema. */
        exemplos: data.exemplos || {},
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

  /* Depois de `modelo`, porque lê `modelo`.

     Estava acima da declaração: funcionava, porque só é CHAMADA depois, mas o
     compilador do React não consegue preservar a memoização atravessando um
     `const` ainda não inicializado — e a memoização que ele desiste de manter
     é a do próprio `modelo`, que o editor relê a cada tecla. */
  /**
   * @param {string} alvo — 'storyViews' | 'contentViews' | 'reach'
   * @param {boolean} comRascunho — manda o texto da tela em vez do gravado
   */
  async function testarAviso(alvo = metrica, comRascunho = true) {
    setTestando(alvo);
    try {
      /* O rascunho vai junto. Sem isso, testar o texto que você acabou de
         escrever exigiria salvar antes — e salvar para descobrir que a frase
         ficou ruim é a ordem errada de fazer as duas coisas. */
      const corpo = { metrica: alvo };
      if (comRascunho && alvo === metrica && modelo) {
        corpo.modelo = { titulo: modelo.titulo, mensagem: modelo.mensagem, tema: modelo.tema };
      }
      const { data } = await api.post('/notificacoes/push/testar', corpo);
      aviso(data.enviados ? 'success' : 'info',
            data.enviados ? `Enviado — ${data.aviso}` : 'Nenhum aparelho',
            data.mensagem);
    } catch (e) {
      const d = e.response?.data;
      aviso('error', 'Não deu para enviar',
            d?.code === 'SEM_VAPID'
              ? 'O servidor ainda não tem chaves de push configuradas.'
              : (d?.error || 'Tente de novo em instantes.'));
    } finally {
      setTestando('');
    }
  }

  /* Testa os três em sequência, e não em paralelo: três notificações chegando
     no mesmo instante viram uma pilha em que não se lê nenhuma, e o objetivo
     aqui é justamente olhar cada uma. */
  async function testarTodos() {
    for (const m of METRICAS) {
      await testarAviso(m.id, false);
      await new Promise(r => setTimeout(r, 1200));
    }
  }

  const mudarModelo = (campo, valor) => {
    setCfg(c => ({
      ...c,
      mensagens: { ...c.mensagens, [metrica]: { ...modelo, [campo]: valor } },
    }));
  };

  /* As variáveis DESTE aviso, com a descrição de cada uma. É o que a lista
     mostra e é contra o que a validação confere — os dois a partir da mesma
     fonte, para o editor não oferecer o que ele mesmo vai recusar. */
  const variaveis = useMemo(() => {
    if (!cfg) return {};
    const nomes = cfg.variaveisPorTipo[metrica];
    if (!nomes) return cfg.variaveis;
    return Object.fromEntries(nomes.map(n => [n, cfg.variaveis[n] || '']));
  }, [cfg, metrica]);

  /* Variáveis usadas no texto que este aviso não sabe preencher. */
  const invalidas = useMemo(() => {
    const conhecidas = Object.keys(variaveis);
    if (!conhecidas.length) return [];
    const achar = t => [...String(t || '').matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)]
      .map(m => m[1]).filter(v => !conhecidas.includes(v));
    return [...new Set([...achar(modelo.titulo), ...achar(modelo.mensagem)])];
  }, [variaveis, modelo]);

  /* Renderização local, com os mesmos dados de exemplo do servidor. Local para
     o preview acompanhar cada tecla sem uma ida ao servidor por caractere. */
  const exemplo = useMemo(() => {
    const vars = {
      ...(cfg?.exemplos || {}),
      /* A única que depende do aviso escolhido: o resto vem do servidor. */
      contentType: metrica === 'storyViews' ? 'Story' : 'Reel',
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
  }, [modelo, metrica, cfg?.exemplos]);

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
      <div style={{ padding: '8px 16px 40px', display: 'flex', flexDirection: 'column', gap: 'var(--mf-4)' }}>

        {!cfg && <EsqueletoLista itens={3} />}

        {cfg && (
          <>
            {/* ── Qual aviso está sendo editado ──────────────────────────────
                Dois grupos, e não uma lista de dez. Marcos e avisos de sistema
                são coisas diferentes: um celebra, o outro avisa que algo
                quebrou. Misturados na mesma fila, "Fila presa" apareceria ao
                lado de "Stories" como se fossem o mesmo tipo de coisa. */}
            {[
              { titulo: 'MARCOS DE AUDIÊNCIA', itens: [...METRICAS, RESUMO], comInterruptor: true },
              { titulo: 'PUBLICAÇÃO',          itens: PUBLICACAO,           comInterruptor: true },
              { titulo: 'AVISOS DO SISTEMA',   itens: SISTEMA,               comInterruptor: false },
            ].map(grupo => (
              <div key={grupo.titulo} style={{ display: 'grid', gap: 'var(--mf-2)' }}>
                <span style={{ fontSize: 'var(--mf-t-nano)', fontWeight: 700, letterSpacing: '.09em',
                  color: 'var(--mf-text-3)' }}>{grupo.titulo}</span>
                <div style={{ display: 'grid', gap: 'var(--mf-2)',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 176px), 1fr))' }}>
                  {grupo.itens.map(m => {
                    const ativa = metrica === m.id;
                    /* O interruptor só aparece onde existe. Um selo "ligado"
                       fixo nos avisos de sistema sugeriria que dá para
                       desligar — e não dá, de propósito. */
                    const ligada = m.id === 'resumo' ? cfg.ativos.global : cfg.ativos[m.id];
                    /* Um ponto quando há texto próprio salvo: sem ele, não há
                       como saber quais dos dez foram editados sem clicar nos
                       dez. */
                    const editado = !!cfg.mensagens[m.id];
                    return (
                      <button key={m.id} onClick={() => setMetrica(m.id)} style={{
                        textAlign: 'left', padding: 'var(--mf-3)', minWidth: 0,
                        borderRadius: 'var(--mf-r-md)', cursor: 'pointer',
                        background: ativa ? 'color-mix(in oklch, var(--mf-primary-500) 12%, transparent)' : 'var(--mf-surface-1)',
                        border: `1px solid ${ativa ? 'color-mix(in oklch, var(--mf-primary-500) 38%, transparent)' : 'var(--mf-border)'}`,
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 'var(--mf-t-xs)', fontWeight: 700, minWidth: 0,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            color: ativa ? 'var(--mf-primary-500)' : 'var(--mf-text)' }}>{m.rotulo}</span>
                          {editado && (
                            <span title="Com texto próprio" style={{ width: 5, height: 5, flexShrink: 0,
                              borderRadius: 'var(--mf-r-full)', background: 'var(--mf-primary-500)' }} />
                          )}
                          <span style={{ flex: 1 }} />
                          {grupo.comInterruptor && (
                            <span style={{
                              fontSize: 'var(--mf-t-nano)', fontWeight: 700, padding: '2px 7px',
                              borderRadius: 'var(--mf-r-full)', flexShrink: 0,
                              background: ligada ? 'var(--mf-success-bg)' : 'var(--mf-border-subtle)',
                              color: ligada ? 'var(--mf-success-500)' : 'var(--mf-text-3)',
                            }}>{ligada ? 'ligado' : 'desligado'}</span>
                          )}
                        </div>
                        <div style={{ fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)',
                          marginTop: 3, lineHeight: 1.5 }}>
                          {m.desc}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            <div style={{ display: 'grid', gap: 'var(--mf-4)',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))' }}>

              {/* ── Editor ── */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--mf-4)', minWidth: 0 }}>
                {painel(`Mensagem — ${PELO_ID[metrica]?.rotulo || metrica}`, <>
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
                          fontSize: 'var(--mf-t-nano)', fontWeight: 700, padding: '4px 8px',
                          borderRadius: 'var(--mf-r-full)', cursor: 'pointer',
                          background: modelo.tema === t ? 'var(--mf-surface-3)' : 'transparent',
                          color: modelo.tema === t ? 'var(--mf-text)' : 'var(--mf-text-3)',
                          border: `1px solid ${modelo.tema === t ? 'var(--mf-border-strong)' : 'var(--mf-border)'}`,
                        }}>{t}</button>
                      ))}
                    </div>
                  </div>

                  {/* Testar ESTE aviso, com o texto que está na tela agora.
                      A pergunta que se faz ao escrever uma mensagem é "como
                      ela vai chegar no celular?", e o cartão de exemplo ao
                      lado responde só metade: ele mostra o layout, não o
                      aviso do sistema operacional. */}
                  <button onClick={() => testarAviso(metrica, true)} disabled={!!testando}
                    className="mf-btn mf-btn--secondary"
                    style={{ marginTop: 'var(--mf-4)', width: '100%',
                             opacity: testando ? .6 : 1,
                             cursor: testando ? 'wait' : 'pointer' }}>
                    {testando === metrica
                      ? 'Enviando…'
                      : `Testar este aviso no aparelho`}
                  </button>

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
                    {Object.entries(variaveis).map(([nome, desc]) => (
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

                {/* Marcos existem para métricas que SOBEM. "Proxy fora do ar"
                    não tem marco de 1.000, e um campo vazio ali seria um
                    convite a preencher algo que nada leria. O painel some, e
                    no lugar entra o que decide o disparo de verdade. */}
                {ehDoSistema(metrica)
                  ? painel('Quando este aviso dispara', (
                    <div style={{ fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)', lineHeight: 1.7 }}>
                      {GATILHO[metrica]}
                      <div style={{ marginTop: 'var(--mf-2)', color: 'var(--mf-text-3)' }}>
                        Avisa uma vez ao começar, repete só depois de 6 h se continuar,
                        e avisa uma vez ao voltar ao normal.
                      </div>
                    </div>
                  ))
                  : ehDePublicacao(metrica)
                  ? painel('Quando este aviso dispara', (
                    <div style={{ fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)', lineHeight: 1.7 }}>
                      {metrica === 'postPublicado'
                        ? 'A cada publicação que sai com sucesso — story, reel, carrossel ou imagem, em qualquer conta.'
                        : 'A cada tentativa de publicação que falha, com o motivo do erro.'}
                      <div style={{ marginTop: 'var(--mf-2)', color: 'var(--mf-text-3)' }}>
                        Um aviso por publicação. Sem marco e sem teto — duas contas publicando
                        o mesmo conteúdo geram dois avisos, porque são duas publicações.
                      </div>
                    </div>
                  ))
                  : painel('Marcos', <>
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
                  {[...METRICAS, ...PUBLICACAO].map(m => (
                    <label key={m.id} style={{
                      display: 'flex', alignItems: 'center', gap: 9, padding: '8px 0',
                      borderBottom: '1px solid var(--mf-border-subtle)', cursor: 'pointer',
                    }}>
                      <input type="checkbox" checked={!!cfg.ativos[m.id]}
                        onChange={e => setCfg(c => ({ ...c, ativos: { ...c.ativos, [m.id]: e.target.checked } }))} />
                      <span style={{ fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-2)' }}>
                        Avisar sobre {m.rotulo.toLowerCase()}
                      </span>
                    </label>
                  ))}

                  <label style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 0',
                    borderBottom: '1px solid var(--mf-border-subtle)', cursor: 'pointer' }}>
                    <input type="checkbox" checked={!!cfg.ativos.global}
                      onChange={e => setCfg(c => ({ ...c, ativos: { ...c.ativos, global: e.target.checked } }))} />
                    <span style={{ fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-2)' }}>
                      Resumo de todas as contas
                    </span>
                  </label>

                  {/* Notificação do navegador: a permissão só é pedida ao ligar
                      este interruptor. Ver o comentário em SmartActivity.jsx. */}
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '8px 0',
                    cursor: diagnostico.pode ? 'pointer' : 'not-allowed',
                    opacity: diagnostico.pode ? 1 : .55 }}>
                    <input type="checkbox" checked={navegadorLigado}
                      disabled={!diagnostico.pode}
                      style={{ marginTop: 2 }}
                      onChange={async e => {
                        if (!e.target.checked) {
                          await notificacaoDoNavegador.desligar();
                          setNavegadorLigado(false);
                          aviso('info', 'Desligado', 'Este aparelho não recebe mais avisos do sistema.');
                          return;
                        }
                        const r = await notificacaoDoNavegador.ligar();
                        setNavegadorLigado(r.ok);
                        aviso(r.ok ? 'success' : 'warning',
                          r.ok ? 'Aparelho inscrito' : 'Não foi possível ativar',
                          r.ok ? 'O celular passa a avisar mesmo com o app fechado.' : r.texto);
                      }} />
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-2)' }}>
                        Avisar no aparelho, mesmo com o app fechado
                      </span>
                      {/* A inscrição é por APARELHO: ligar no computador não
                          liga no celular, e vice-versa. Dizer isso evita a
                          conclusão errada de que "não funciona". */}
                      <span style={{ display: 'block', fontSize: 'var(--mf-t-nano)',
                        color: diagnostico.pode ? 'var(--mf-text-3)' : 'var(--mf-warning-500)',
                        marginTop: 3, lineHeight: 1.55 }}>
                        {diagnostico.pode
                          ? 'Vale só para este aparelho — ative também no celular.'
                          : diagnostico.texto}
                      </span>
                    </span>
                  </label>

                  {/* Sem isto, a única forma de saber se o aviso chega é
                      esperar um marco real — horas, e sem relação aparente
                      com o que foi feito aqui. O teste usa a SUA mensagem
                      configurada, então responde duas perguntas de uma vez:
                      "chega no aparelho?" e "o texto que editei está certo?" */}
                  <div style={{ marginTop: 'var(--mf-3)', display: 'grid', gap: 6 }}>
                    {/* Um por aviso, e não um "testar" genérico. Com três
                        mensagens para calibrar, saber QUAL chegou é metade da
                        informação — e um teste só de Stories nunca revelaria
                        um erro no de Alcance. */}
                    {[...METRICAS, ...PUBLICACAO].map(m => (
                      <button key={m.id} onClick={() => testarAviso(m.id, false)} disabled={!!testando}
                        className="mf-btn mf-btn--ghost"
                        style={{ width: '100%', justifyContent: 'space-between',
                                 opacity: testando && testando !== m.id ? .5 : 1,
                                 cursor: testando ? 'wait' : 'pointer' }}>
                        <span>Testar aviso de {m.rotulo}</span>
                        <span style={{ fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)' }}>
                          {testando === m.id ? 'enviando…' : 'enviar'}
                        </span>
                      </button>
                    ))}
                    <button onClick={testarTodos} disabled={!!testando}
                      className="mf-btn mf-btn--ghost"
                      style={{ width: '100%', opacity: testando ? .6 : 1,
                               cursor: testando ? 'wait' : 'pointer' }}>
                      {testando ? 'Enviando…' : 'Testar os três, um a um'}
                    </button>
                  </div>

                  <div style={{ marginTop: 'var(--mf-4)' }}>
                    {rotulo('SOME DEPOIS DE')}
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                      {[4000, 6000, 9000, 0].map(ms => (
                        <button key={ms}
                          onClick={() => setCfg(c => ({ ...c, exibicao: { ...c.exibicao, duracaoMs: ms } }))}
                          style={{
                            fontSize: 'var(--mf-t-nano)', fontWeight: 700, padding: '4px 12px',
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
