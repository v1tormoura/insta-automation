import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ListOrdered, Grid3x3 } from 'lucide-react';

import api from '../services/api';
import { useServerEvents } from '../services/useServerEvents';
import PageShell from '../components/PageShell';
import Toast from '../components/Toast';
import { Skeleton } from '../components/ui/skeleton';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '../components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';

import CampaignHeader, { CampaignActions } from '../components/campaign/detail/CampaignHeader';
import { STATUS_CAMPANHA } from '../components/campaign/detail/shared';
import CampaignMetrics from '../components/campaign/detail/CampaignMetrics';
import NextUp from '../components/campaign/detail/NextUp';
import DistributionMatrix from '../components/campaign/detail/DistributionMatrix';
import PublicationDrawer from '../components/campaign/detail/PublicationDrawer';
import {
  TimelineView, ByAccountView, ByContentView, PublicationsView, EventosView,
  CommentsView, ProblemsView, PlanoCompleto, resumoContas,
} from '../components/campaign/detail/views';

/**
 * Painel de controle de uma campanha.
 *
 * Fonte única: a API. Contagens vêm das agregações do backend
 * (`statistics`/`commentStatistics`), o plano vem de `/publications`, e a próxima
 * publicação vem de `nextPublication` — resolvida no banco, porque a listagem é
 * paginada e deduzi-la de uma página daria resposta errada em campanha grande.
 *
 * Nada é estimado no frontend: em particular, o total NUNCA é contas × conteúdos.
 * Com o limite diário ligado o planner gera menos publicações que esse produto.
 *
 * As visões por conta, por conteúdo e a matriz precisam do grid completo, então a
 * página percorre TODAS as páginas de `/publications` (limite de 200 por
 * requisição) antes de considerar os dados completos — com dados parciais, a
 * matriz mostraria células vazias como "não planejado".
 */

const LIMITE_PAGINA = 200;

const ABAS = [
  ['timeline',    'Timeline'],
  ['contas',      'Por conta'],
  ['conteudos',   'Por conteúdo'],
  ['publicacoes', 'Publicações'],
  ['comentarios', 'Comentários'],
  ['problemas',   'Problemas'],
  /* "Problemas" mostra o ESTADO de cada publicação; esta mostra o CAMINHO.
     São perguntas diferentes: uma responde "o que está errado agora", a outra
     "o que aconteceu para chegar aqui" — e a segunda é a que faltava quando
     uma campanha inteira falhava sem explicação. */
  ['eventos',     'Eventos'],
];

export default function CampaignDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [resumo, setResumo] = useState(null);      // GET /campaigns/:id
  const [pubs, setPubs]     = useState([]);        // GET /campaigns/:id/publications
  const [carregando, setCarregando] = useState(true);
  const [erroCarga, setErroCarga]   = useState(null);
  const [agindo, setAgindo] = useState(false);
  const [aba, setAba]       = useState('timeline');
  const [selecionada, setSelecionada] = useState(null);
  const [planoAberto, setPlanoAberto] = useState(false);
  const [matrizAberta, setMatrizAberta] = useState(false);
  const [toast, setToast]   = useState(null);

  const aviso = (type, title, message) => {
    setToast({ type, title, message });
    setTimeout(() => setToast(null), 4000);
  };

  // Ignora respostas de cargas antigas: um evento SSE durante uma carga em
  // andamento dispararia outra, e a mais lenta sobrescreveria a mais nova.
  const cargaRef = useRef(0);

  /* ── Carga ─────────────────────────────────────────────────────────────── */

  const carregar = useCallback(async () => {
    const minha = ++cargaRef.current;
    try {
      const { data: cab } = await api.get(`/campaigns/${id}`);
      if (cargaRef.current !== minha) return;
      setResumo(cab);

      // Primeira página; o total diz se há mais.
      const primeira = await api.get(`/campaigns/${id}/publications?limit=${LIMITE_PAGINA}&page=1`);
      if (cargaRef.current !== minha) return;

      let todas = primeira.data.publications || [];
      const paginas = primeira.data.pagination?.pages || 1;

      // Sequencial de propósito: uma campanha grande com paralelismo total
      // abriria dezenas de requisições ao mesmo tempo.
      for (let p = 2; p <= paginas; p++) {
        const { data } = await api.get(`/campaigns/${id}/publications?limit=${LIMITE_PAGINA}&page=${p}`);
        if (cargaRef.current !== minha) return;
        todas = todas.concat(data.publications || []);
      }

      setPubs(todas);
      setErroCarga(null);
    } catch (err) {
      if (cargaRef.current !== minha) return;
      setErroCarga(err?.response?.data?.message || 'Não foi possível carregar a campanha.');
    } finally {
      if (cargaRef.current === minha) setCarregando(false);
    }
  }, [id]);

  useEffect(() => { carregar(); }, [carregar]);

  // Tempo real pelo SSE que o projeto já tem, no canal 'campaigns' que o
  // executor emite. O evento carrega apenas ids, então a tela recarrega do banco
  // em vez de aplicar um patch local — o que aparece é sempre o estado
  // persistido, nunca uma projeção otimista que pode divergir.
  useServerEvents(['campaigns'], dados => {
    if (!dados?.campaignId || String(dados.campaignId) === String(id)) carregar();
  });

  /* ── Ações ─────────────────────────────────────────────────────────────── */

  const ACOES = {
    start:       { caminho: '/start',        rotulo: 'Iniciar' },
    pause:       { caminho: '/pause',        rotulo: 'Pausar' },
    resume:      { caminho: '/resume',       rotulo: 'Retomar' },
    cancel:      { caminho: '/cancel',       rotulo: 'Cancelar' },
    retryFailed: { caminho: '/retry-failed', rotulo: 'Reexecutar falhas' },
  };

  async function executarAcao(acao) {
    if (acao === 'edit')      return navigate(`/campaigns/nova?duplicar=${id}`);
    if (acao === 'duplicate') return navigate(`/campaigns/nova?duplicar=${id}`);

    const cfg = ACOES[acao];
    if (!cfg) return;

    setAgindo(true);
    try {
      const { data } = await api.post(`/campaigns/${id}${cfg.caminho}`);
      await carregar();

      /* O agendamento deu certo — mas o ambiente pode não estar pronto, e aí
         as publicações vão falhar uma a uma. Dizer isso AGORA evita a espera
         que termina em dezesseis erros sem explicação. */
      if (data?.ambiente && !data.ambiente.pronto) {
        aviso('warning', 'Agendada, mas atenção', data.ambiente.veredito);
      } else {
        aviso('success', cfg.rotulo, 'Feito.');
      }
    } catch (err) {
      aviso('error', cfg.rotulo, err?.response?.data?.message || 'Não foi possível concluir.');
    } finally {
      setAgindo(false);
    }
  }

  async function reprocessar(pubId) {
    setAgindo(true);
    try {
      await api.post(`/campaigns/${id}/publications/${pubId}/retry`);
      await carregar();
      setSelecionada(null);
      aviso('success', 'Reprocessar', 'Publicação reenfileirada.');
    } catch (err) {
      aviso('error', 'Reprocessar', err?.response?.data?.message || 'Não foi possível reprocessar.');
    } finally {
      setAgindo(false);
    }
  }

  async function reprocessarComentario(pubId) {
    setAgindo(true);
    try {
      await api.post(`/campaigns/${id}/publications/${pubId}/retry-comment`);
      await carregar();
      setSelecionada(null);
      aviso('success', 'Reprocessar comentário', 'Comentário reenfileirado.');
    } catch (err) {
      aviso('error', 'Reprocessar comentário', err?.response?.data?.message || 'Não foi possível reprocessar.');
    } finally {
      setAgindo(false);
    }
  }

  /* ── Derivados ─────────────────────────────────────────────────────────── */

  const estatisticas = resumo?.statistics || {};
  const comentarios  = resumo?.commentStatistics || {};
  const contas       = useMemo(() => resumoContas(pubs), [pubs]);

  const contagemProblemas = useMemo(
    () => pubs.filter(p => p.status === 'failed' || p.commentStatus === 'failed').length,
    [pubs],
  );
  const contagemComentarios = useMemo(
    () => pubs.filter(p => p.commentStatus && p.commentStatus !== 'none').length,
    [pubs],
  );

  /* Linha do tempo persistida. Antes os eventos iam só para o `console.log`
     do servidor: serviam a quem estivesse no terminal no instante exato, e a
     mais ninguém — nem ao mesmo alguém no dia seguinte. */
  const [eventos, setEventos] = useState(null);
  useEffect(() => {
    if (aba !== 'eventos' || !id) return undefined;
    let vivo = true;
    api.get(`/campaigns/${id}/eventos`, { params: { limit: 150 } })
      .then(({ data }) => { if (vivo) setEventos(data); })
      .catch(() => { if (vivo) setEventos({ itens: [], erros: [], total: 0 }); });
    return () => { vivo = false; };
  }, [aba, id]);

  const contagemAba = {
    timeline:    pubs.length,
    contas:      contas.total,
    conteudos:   new Set(pubs.map(p => String(p.content?._id ?? p.content))).size,
    publicacoes: pubs.length,
    comentarios: contagemComentarios,
    problemas:   contagemProblemas,
    eventos:     eventos?.total ?? 0,
  };

  /* ── Estados de carga ──────────────────────────────────────────────────── */

  if (carregando) {
    return (
      <PageShell title="Campanha" subtitle="Carregando…" accent="cyan">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-[190px] rounded-[var(--mf-r-lg)]" />
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(240px, 100%), 1fr))' }}>
            {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-[150px] rounded-[var(--mf-r-lg)]" />)}
          </div>
          <Skeleton className="h-[230px] rounded-[var(--mf-r-lg)]" />
        </div>
      </PageShell>
    );
  }

  if (erroCarga || !resumo?.campaign) {
    return (
      <PageShell title="Campanha" subtitle="Não foi possível carregar" accent="cyan">
        <div className="rounded-[var(--mf-r-lg)] border border-[color-mix(in_oklch,_var(--mf-danger-500)_26%,_transparent)] bg-[color-mix(in_oklch,_var(--mf-danger-500)_5%,_transparent)] p-5 text-center">
          <p className="text-[12.5px] font-semibold text-[var(--mf-danger-500)]">
            {erroCarga || 'Campanha não encontrada.'}
          </p>
          <div className="mt-3 flex justify-center gap-2">
            <Button variant="outline" size="sm" onClick={carregar}>Tentar novamente</Button>
            <Button variant="ghost" size="sm" onClick={() => navigate('/campaigns')}>Voltar</Button>
          </div>
        </div>
      </PageShell>
    );
  }

  const campanha = resumo.campaign;

  return (
    <PageShell
      title={campanha.name}
      subtitle="Painel da campanha"
      accent="cyan"
      /* As ações da campanha sobem para cá.

         Elas viviam dentro do cartão de cabeçalho, ao lado de um segundo
         título com o nome da campanha — o mesmo nome que já estava aqui em
         cima. Duas identidades a 60px uma da outra é o que fazia a tela
         parecer montada em pedaços. Aqui em cima elas ficam onde a pessoa
         procura por ações, e o cartão passa a responder uma pergunta só. */
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={(STATUS_CAMPANHA[campanha.status] || STATUS_CAMPANHA.draft).badge}>
            {(STATUS_CAMPANHA[campanha.status] || STATUS_CAMPANHA.draft).rotulo}
          </Badge>
          <CampaignActions
            status={campanha.status}
            falhas={estatisticas.failed || 0}
            agindo={agindo}
            onAcao={executarAcao}
          />
          <span className="mx-0.5 hidden h-5 w-px bg-[var(--border)] sm:block" aria-hidden />
          <Button variant="outline" size="sm" onClick={() => setMatrizAberta(true)}>
            <Grid3x3 size={13} />
            Matriz
          </Button>
          <Button variant="outline" size="sm" onClick={() => setPlanoAberto(true)}>
            <ListOrdered size={13} />
            Plano completo
          </Button>
        </div>
      }
    >
      {/* ── Workspace: o que se opera, e ao lado o que se consulta ────────

          Era uma pilha de cinco faixas de largura cheia, todas com o mesmo
          peso: configuração, métricas, próxima ação, matriz, e só então as
          abas. Para chegar ao que se OPERA — a linha do tempo, os problemas —
          era preciso rolar por quatro blocos de resumo. E numa tela larga cada
          faixa esticava até 1400px, com linhas de texto longas demais para
          serem lidas de relance.

          Agora são duas colunas com papéis diferentes: à esquerda o trabalho,
          que ocupa o espaço e rola; à direita o contexto, fixo, sempre à
          vista. É a diferença entre empilhar tudo que existe e decidir o que
          fica na frente.

          A ordem no DOM é trabalho-primeiro, e o trilho sobe para o topo no
          celular via `order` — leitura por teclado e leitor de tela seguem a
          importância, e o olho no celular recebe o resumo antes da lista. */}
      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">

        {/* ── Coluna principal: a lista, as abas, o que se clica ───────────

            `row-span-2` em lg: a coluna da direita tem duas células (resumo e
            configuração) e esta ocupa as duas linhas ao lado delas. É o que
            permite a configuração descer para depois da lista no celular sem
            sair do trilho no desktop. */}
        <div className="order-2 min-w-0 lg:order-none lg:col-start-1 lg:row-span-2 lg:row-start-1">
          <Tabs value={aba} onValueChange={setAba}>
            <TabsList label="Visões da campanha">
              {ABAS.map(([valor, rotulo]) => (
                <TabsTrigger key={valor} value={valor} count={contagemAba[valor]}>
                  {rotulo}
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value="timeline">
              <TimelineView publicacoes={pubs} onAbrir={setSelecionada} />
            </TabsContent>
            <TabsContent value="contas">
              <ByAccountView publicacoes={pubs} onAbrir={setSelecionada} />
            </TabsContent>
            <TabsContent value="conteudos">
              <ByContentView publicacoes={pubs} onAbrir={setSelecionada} />
            </TabsContent>
            <TabsContent value="publicacoes">
              <PublicationsView publicacoes={pubs} onAbrir={setSelecionada} contagem={estatisticas} />
            </TabsContent>
            <TabsContent value="eventos">
              <EventosView dados={eventos} />
            </TabsContent>
            <TabsContent value="comentarios">
              <CommentsView
                publicacoes={pubs}
                comentarios={comentarios}
                onAbrir={setSelecionada}
                onReprocessar={reprocessarComentario}
                agindo={agindo}
              />
            </TabsContent>
            <TabsContent value="problemas">
              <ProblemsView
                publicacoes={pubs}
                onAbrir={setSelecionada}
                onReprocessar={reprocessar}
                onReprocessarComentario={reprocessarComentario}
                agindo={agindo}
              />
            </TabsContent>
          </Tabs>
        </div>

        {/* ── Trilho de contexto ──────────────────────────────────────────

            `sticky` a partir de lg: numa campanha de trinta publicações a
            lista é longa, e o progresso ter rolado para fora da tela é
            justamente quando se quer olhar para ele. Abaixo de lg ele é
            estático — trilho fixo num celular ocuparia metade da altura. */}
        <aside className="order-1 flex min-w-0 flex-col gap-3 lg:col-start-2 lg:row-start-1 lg:sticky lg:top-3">
          <NextUp
            campanha={campanha}
            estatisticas={estatisticas}
            comentarios={comentarios}
            proxima={resumo.nextPublication}
            onAbrir={setSelecionada}
          />

          <CampaignMetrics
            estatisticas={estatisticas}
            comentarios={comentarios}
            contas={contas}
            progresso={resumo.progress}
          />
        </aside>

        {/* ── Configuração ─────────────────────────────────────────────────

            Separada do resumo por causa do celular. Ali tudo vira uma coluna
            só, e com ela junto eram cinco cartões de leitura antes de chegar
            à lista — que é o que a pessoa abriu a campanha para ver.

            Configuração é material de CONSULTA: ninguém abre uma campanha para
            reler o intervalo. Ela desce para depois da lista no celular, e no
            desktop continua no trilho, logo abaixo do resumo. */}
        <div className="order-3 min-w-0 lg:col-start-2 lg:row-start-2">
          <CampaignHeader
            campanha={campanha}
            schedule={resumo.schedule}
            estatisticas={estatisticas}
          />
        </div>
      </div>

      {/* Drawer de detalhe */}
      <PublicationDrawer
        pub={selecionada}
        aberto={!!selecionada}
        onFechar={() => setSelecionada(null)}
        onReprocessar={reprocessar}
        onReprocessarComentario={reprocessarComentario}
        agindo={agindo}
      />

      {/* Plano completo */}
      <Dialog open={planoAberto} onOpenChange={setPlanoAberto}>
        <DialogContent className="max-w-[680px]">
          <DialogHeader>
            <DialogTitle>Plano completo</DialogTitle>
          </DialogHeader>
          <div className="max-h-[62vh] overflow-y-auto">
            <PlanoCompleto
              publicacoes={pubs}
              onAbrir={p => { setPlanoAberto(false); setSelecionada(p); }}
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* Matriz — no celular vem por aqui */}
      <Dialog open={matrizAberta} onOpenChange={setMatrizAberta}>
        <DialogContent className="max-w-[900px]">
          <DialogHeader>
            <DialogTitle>Matriz de distribuição</DialogTitle>
          </DialogHeader>
          <DistributionMatrix
            publicacoes={pubs}
            onAbrir={p => { setMatrizAberta(false); setSelecionada(p); }}
          />
        </DialogContent>
      </Dialog>

      <Toast toast={toast} onClose={() => setToast(null)} />
    </PageShell>
  );
}
