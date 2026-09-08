const Post    = require('../models/Post');
const Job     = require('../models/Job');
const Media   = require('../models/Media');
const postQueue = require('../queue/postQueue');
const { broadcast } = require('../events/broadcaster');
const { ordenar, naOrdemDosIds, ORDENS, ORDEM_PADRAO } = require('../services/ordemDasMidias');
const { lerDoCorpo: lerMarcaDagua } = require('../services/marcaDagua');
const { aplicarNasContas: aplicarTetoDiario } = require('../services/tetoDiario');
const fs   = require('fs');
const path = require('path');

function getMediaType(filename) {
  const file = filename.toLowerCase();

  if (file.endsWith('.mp4') || file.endsWith('.mov') || file.endsWith('.webm')) {
    return 'video';
  }

  return 'image';
}


exports.createPost = async (req, res) => {
  try {
    const allFiles  = req.files || [];
    const mediaFiles = allFiles.filter(f => f.fieldname === 'media');
    const coverFile  = allFiles.find(f => f.fieldname === 'cover') || null;

    /* ── Mídias da biblioteca, na ordem em que foram escolhidas ────────────

       `Media.find({ _id: { $in: ids } })` NÃO devolve na ordem dos ids — o
       Mongo devolve na ordem que quiser. Quem subia 400 vídeos e escolhia
       quarenta numa ordem específica via a fila sair em outra, e não havia nada
       na tela que explicasse. `naOrdemDosIds` restaura a escolha.

       `createdAt` vem junto porque é o que permite ordenar por mais antigo ou
       mais recente. Upload direto não tem — e não deve ter: arquivo que subiu
       agora é, de fato, o mais recente. */
    const mediaIds = JSON.parse(req.body.mediaIds || '[]');
    let libraryFiles = [];
    if (mediaIds.length) {
      const docs = await Media.find({ _id: { $in: mediaIds } });
      libraryFiles = naOrdemDosIds(docs, mediaIds)
        .map(d => ({ filename: d.filename, fieldname: 'media', fromLibrary: true, quando: d.createdAt }));
    }

    const allMedia = [...mediaFiles, ...libraryFiles];
    if (!allMedia.length) return res.status(400).json({ error: 'Nenhuma mídia enviada' });

    const accounts = JSON.parse(req.body.accounts || '[]');
    if (!accounts.length) return res.status(400).json({ error: 'Nenhuma conta selecionada' });

    // Piso de 1 minuto, igual ao Loop. Com 0 as rodadas emendavam uma na outra
    // sem pausa nenhuma — o padrão mais robotizado que o Postar produzia.
    const intervalMinutes    = Number(req.body.intervalMinutes || 0);
    if (!intervalMinutes || intervalMinutes < 1) {
      return res.status(400).json({ error: 'Intervalo mínimo entre rodadas: 1 minuto' });
    }
    const simultaneousLimit  = Math.max(1, Number(req.body.simultaneousLimit) || 1);
    const requestedPostType  = req.body.postType || 'reel';

    // Normaliza tipo (auto → reel ou post dependendo da mídia do primeiro arquivo)
    let postType = requestedPostType;
    if (!postType || postType === 'auto') {
      const firstIsVideo = /\.(mp4|mov|webm|avi|mkv)$/i.test(allMedia[0]?.filename || '');
      postType = firstIsVideo ? 'reel' : 'post';
    }
    if (!['post', 'reel', 'story'].includes(postType)) postType = 'reel';

    /* ── A ordem da fila ──────────────────────────────────────────────────

       Decidida aqui, uma vez, e gravada em `mediaFiles`: o worker só caminha
       pelo array. Ordenar na hora de publicar obrigaria cada rodada a refazer a
       conta, e a ordem aleatória mudaria a cada rodada.

       A semente é sorteada agora e guardada. Sem guardá-la, a ordem aleatória
       seria irreproduzível e "em que ordem isso foi postado" não teria
       resposta depois. */
    const sementeDaOrdem = req.body.sementeDaOrdem || require('crypto').randomBytes(8).toString('hex');
    const midiasAleatorias = req.body.midiasAleatorias === 'true' || req.body.midiasAleatorias === true;
    const ordemPedida = ORDENS.includes(req.body.ordemDasMidias) ? req.body.ordemDasMidias : ORDEM_PADRAO;

    const mediaFilenames = ordenar(allMedia, {
      ordem: ordemPedida,
      aleatoria: midiasAleatorias,
      semente: sementeDaOrdem,
    }).map(f => f.filename);

    /* ── Modo loop infinito ───────────────────────────────────────────────

       Não é engine nova: `type: 'loop'` é o que o worker já usa para voltar ao
       índice 0 quando as mídias acabam, em vez de concluir o job. A tela só
       passa a poder escolher isso no Postar, sem ir à página de Loop. */
    const loopInfinito = req.body.loopInfinito === 'true' || req.body.loopInfinito === true;

    const marcaDagua = lerMarcaDagua(req.body.marcaDagua);

    /* ── Publicações por conta em 24h ─────────────────────────────────────

       Escrito em `Account.dailyPostLimit`, que é o campo que o
       `publicationPlanner` e o `checkDailyLimit` já obedecem. Um segundo
       número no job criaria duas respostas para "quantas esta conta pode
       hoje".

       O efeito colateral é real — muda a configuração DAS CONTAS, não só deste
       envio — e por isso está escrito na tela, ao lado do campo.

       Antes de criar o job: se o teto vale para esta rodada, tem de estar
       gravado quando a primeira rodada consultar. */
    const tetoAplicado = await aplicarTetoDiario(accounts, req.body.postsPor24h);

    const totalRounds    = Math.ceil(mediaFilenames.length / simultaneousLimit);

    const job = await Job.create({
      name:              req.body.name || `Post ${new Date().toLocaleString('pt-BR')}`,
      type:              loopInfinito ? 'loop' : 'post',
      status:            'queued',
      accounts,
      mediaFiles:        mediaFilenames,
      ordemDasMidias:    ordemPedida,
      midiasAleatorias:  midiasAleatorias,
      sementeDaOrdem:    sementeDaOrdem,
      ...(marcaDagua ? { marcaDagua } : {}),
      postType,
      caption:           req.body.caption       || '',
      cover:             coverFile ? coverFile.filename : (req.body.coverFilename || ''),
      ctaComment:        req.body.ctaComment     || '',
      engageComment:     req.body.engageComment  || '',
      processMode:       req.body.processMode    || 'limpeza_leve',
      location:          req.body.location       || '',
      intervalMinutes,
      simultaneousLimit,
      currentRound:      0,
      totalRounds,
      /* Loop infinito não tem total: o worker volta ao índice 0 quando as
         mídias acabam, então qualquer número aqui seria uma meta falsa na
         barra de progresso. É o mesmo 0 que o loopController já grava. */
      postsTotal:        loopInfinito ? 0 : totalRounds * accounts.length,
    });

    // Enfileira primeira rodada imediatamente (ou no scheduledAt solicitado)
    const scheduledDelay = req.body.scheduledAt
      ? Math.max(new Date(req.body.scheduledAt).getTime() - Date.now(), 0)
      : 0;

    const bullJob = await postQueue.add('job_round', { jobId: String(job._id) }, { delay: scheduledDelay });
    await Job.findByIdAndUpdate(job._id, { bullMqJobId: String(bullJob.id) });

    broadcast('posts', { action: 'created' });
    res.json({ success: true, job, tetoAplicado });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

exports.getPosts = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const skip = (page - 1) * limit;

    const [posts, total] = await Promise.all([
      Post.find().populate('accounts').sort({ updatedAt: -1 }).skip(skip).limit(limit),
      Post.countDocuments(),
    ]);

    res.json({
      posts,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * A fila de postagens, com filtros e paginação.
 *
 * Separada de `getPosts` de propósito: aquela é a lista simples que a tela do
 * Postar já usava, e mudá-la mexeria numa tela que funciona. Esta traz o que a
 * fila precisa e a outra não tem — nome do envio, views e o motivo do erro na
 * própria linha.
 *
 * As decisões de consulta moram em `filaDePostagens.js`, com testes: é ali que
 * estão os casos de borda (filtro inventado, id que não é ObjectId, página
 * além do fim), e aqui fica só a montagem da resposta.
 */
exports.filaDePostagens = async (req, res) => {
  try {
    const fila = require('../services/filaDePostagens');
    const Insight = require('../models/Insight');

    const consulta = fila.montarConsulta(req.query);
    const { pagina, porPagina, pular } = fila.montarPaginacao(req.query);

    const [posts, total] = await Promise.all([
      Post.find(consulta)
        .populate('accounts', 'username avatar')
        /* Mais recentes primeiro: quem abre a fila quer ver o que acabou de
           acontecer, não o que aconteceu na semana passada. */
        .sort({ scheduledAt: -1, createdAt: -1 })
        .skip(pular).limit(porPagina)
        .lean(),
      Post.countDocuments(consulta),
    ]);

    /* Uma consulta de views para o lote, não uma por linha. */
    const views = await fila.viewsPorMidia(posts, Insight);

    /* Os envios que existem na fila, para o filtro oferecer só o que dá
       resultado. Um seletor com opção que devolve zero linhas é pior que um
       seletor menor. */
    const enviosCrus = await Post.aggregate([
      { $match: { jobId: { $ne: null } } },
      { $group: { _id: '$jobId', nome: { $first: '$jobName' }, quando: { $max: '$createdAt' } } },
      { $sort: { quando: -1 } },
      { $limit: 50 },
    ]).catch(() => []);

    res.json({
      itens: posts.map(p => fila.montarLinha(p, views)),
      paginacao: {
        pagina, porPagina, total,
        paginas: Math.max(1, Math.ceil(total / porPagina)),
        de: total === 0 ? 0 : pular + 1,
        ate: Math.min(pular + porPagina, total),
      },
      envios: enviosCrus.map(e => ({ id: String(e._id), nome: e.nome || 'Sem nome' })),
      status: fila.STATUS,
      formatos: fila.FORMATOS,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * Apaga as publicações interrompidas e canceladas.
 *
 * `parcial` NÃO entra: parcial é publicação que saiu em algumas contas e
 * falhou em outras, e apagá-la perderia o registro do que foi publicado.
 *
 * Não toca em nada que ainda pode acontecer — pendente e processando ficam.
 * Limpar a fila não pode significar cancelar o que está em andamento.
 */
exports.limparFila = async (req, res) => {
  try {
    const { LIMPAVEIS } = require('../services/filaDePostagens');
    const r = await Post.deleteMany({ status: { $in: LIMPAVEIS } });
    const quantas = r?.deletedCount || 0;
    console.log(`🧹 [Fila] ${quantas} publicação(ões) interrompida(s)/cancelada(s) removida(s)`);
    res.json({ ok: true, removidas: quantas });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.deletePost = async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);

    if (!post) {
      return res.status(404).json({ error: 'Post não encontrado' });
    }

    // Bloqueia exclusão se a mídia está em uso por Job ativo
    const activeJob = await Job.findOne({
      mediaFiles: post.media,
      status: { $in: ['queued', 'running', 'waiting_interval'] },
    });
    if (activeJob) {
      return res.status(400).json({
        error: `Mídia em uso pelo job "${activeJob.name}" — cancele o job antes de deletar`,
      });
    }

    const mediaPath = path.resolve(__dirname, '../../uploads', post.media);

    if (fs.existsSync(mediaPath)) {
      fs.unlinkSync(mediaPath);
    }

    if (post.cover) {
      const coverPath = path.resolve(__dirname, '../../uploads', post.cover);

      if (fs.existsSync(coverPath)) {
        fs.unlinkSync(coverPath);
      }
    }

    await Post.findByIdAndDelete(req.params.id);

    broadcast('posts', { action: 'deleted' });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.cancelPost = async (req, res) => {
  try {
    const post = await Post.findByIdAndUpdate(
      req.params.id,
      { status: 'cancelado' },
      { new: true }
    );

    res.json(post);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.retryPost = async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);

    if (!post) {
      return res.status(404).json({ error: 'Post não encontrado' });
    }

    if (!['erro', 'parcial', 'cancelado'].includes(post.status)) {
      return res.status(400).json({ error: 'Só é possível reprocessar posts com erro, parcial ou cancelado' });
    }

    post.status = 'pendente';
    post.error = '';
    await post.save();

    await postQueue.add('newPost', { postId: post._id }, { delay: 0 });

    res.json({ success: true, post });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.retryAllErrors = async (req, res) => {
  try {
    const errorPosts = await Post.find({ status: { $in: ['erro', 'parcial'] } });

    if (!errorPosts.length) {
      return res.json({ success: true, total: 0, message: 'Nenhum post com erro encontrado' });
    }

    for (const post of errorPosts) {
      post.status = 'pendente';
      post.error = '';
      await post.save();

      await postQueue.add('newPost', { postId: post._id }, { delay: 0 });
    }

    res.json({ success: true, total: errorPosts.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
