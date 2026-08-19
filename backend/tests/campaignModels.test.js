'use strict';

/**
 * Testes dos models da Fase 2 — Campaign e CampaignPublication.
 *
 * Rodam offline: o Mongoose valida schema, defaults e enums sem conexão, via
 * validateSync(). Isso mantém o padrão dos testes já existentes no projeto, que
 * não tocam banco real.
 */

const mongoose = require('mongoose');

const Campaign            = require('../src/models/Campaign');
const CampaignPublication = require('../src/models/CampaignPublication');

const oid = () => new mongoose.Types.ObjectId();

describe('Campaign — criação e defaults', () => {
  test('cria com o mínimo (apenas nome) e é válida', () => {
    const c = new Campaign({ name: 'Campanha Reels Agosto' });
    expect(c.validateSync()).toBeUndefined();
    expect(c.name).toBe('Campanha Reels Agosto');
  });

  test('nome é obrigatório', () => {
    const erro = new Campaign({}).validateSync();
    expect(erro).toBeDefined();
    expect(erro.errors.name).toBeDefined();
  });

  test('defaults de status e modos', () => {
    const c = new Campaign({ name: 'X' });
    expect(c.status).toBe('draft');
    expect(c.captionMode).toBe('global');
    expect(c.commentMode).toBe('disabled');
  });

  test('defaults de estratégia e cobertura', () => {
    const c = new Campaign({ name: 'X' });
    expect(c.strategy.mode).toBe('interleaved_random');
    expect(c.settings.coverage.mode).toBe('all_accounts_all_contents');
    expect(c.settings.respectDailyLimit).toBe(true);
  });

  test('defaults de intervalo — 12 a 28 min, sem intervalo fixo', () => {
    const c = new Campaign({ name: 'X' });
    expect(c.schedule.intervalMinMinutes).toBe(12);
    expect(c.schedule.intervalMaxMinutes).toBe(28);
    expect(c.schedule.useFixedInterval).toBe(false);
  });

  test('contadores começam zerados', () => {
    const c = new Campaign({ name: 'X' });
    expect(c.totalPublications).toBe(0);
    expect(c.pendingPublications).toBe(0);
    expect(c.publishedPublications).toBe(0);
    expect(c.failedPublications).toBe(0);
  });
});

describe('Campaign — enums', () => {
  test('aceita todos os status previstos', () => {
    const validos = ['draft', 'planning', 'scheduled', 'running', 'paused',
                     'completed', 'partial', 'failed', 'cancelled'];
    for (const status of validos) {
      expect(new Campaign({ name: 'X', status }).validateSync()).toBeUndefined();
    }
  });

  test('rejeita status inexistente', () => {
    const erro = new Campaign({ name: 'X', status: 'voando' }).validateSync();
    expect(erro?.errors?.status).toBeDefined();
  });

  test('aceita os quatro modos de legenda', () => {
    for (const captionMode of ['global', 'per_account', 'per_content', 'per_account_content']) {
      expect(new Campaign({ name: 'X', captionMode }).validateSync()).toBeUndefined();
    }
  });

  test('aceita os quatro modos de comentário, incluindo desativado', () => {
    for (const commentMode of ['disabled', 'global', 'per_account', 'per_publication']) {
      expect(new Campaign({ name: 'X', commentMode }).validateSync()).toBeUndefined();
    }
  });

  test('aceita os modos implementados no planner', () => {
    for (const mode of ['interleaved_random', 'sequential', 'round_robin', 'account_first', 'manual']) {
      expect(new Campaign({ name: 'X', strategy: { mode } }).validateSync()).toBeUndefined();
    }
  });

  test('rejeita estratégia inexistente', () => {
    const erro = new Campaign({ name: 'X', strategy: { mode: 'caotico' } }).validateSync();
    expect(erro).toBeDefined();
  });

  test('cobertura prevê os modos futuros sem implementá-los', () => {
    for (const mode of ['all_accounts_all_contents', 'max_per_account', 'custom', 'manual']) {
      const c = new Campaign({ name: 'X', settings: { coverage: { mode } } });
      expect(c.validateSync()).toBeUndefined();
    }
  });
});

describe('Campaign — legendas e comentários por chave', () => {
  test('guarda template por conta sem resolver variáveis', () => {
    const accountId = oid().toString();
    const c = new Campaign({
      name: 'X',
      captionMode: 'per_account',
      captions: { byAccount: { [accountId]: 'Confira @{username}' } },
    });
    expect(c.validateSync()).toBeUndefined();
    // O texto permanece BRUTO — a resolução é responsabilidade da execução.
    expect(c.captions.byAccount.get(accountId)).toBe('Confira @{username}');
  });

  test('chave composta conta__conteúdo é aceita', () => {
    const chave = `${oid()}__${oid()}`;
    const c = new Campaign({
      name: 'X',
      captionMode: 'per_account_content',
      captions: { byAccountContent: { [chave]: 'legenda específica' } },
    });
    expect(c.validateSync()).toBeUndefined();
    expect(c.captions.byAccountContent.get(chave)).toBe('legenda específica');
  });

  test('comentário guarda atraso, e o padrão não é zero', () => {
    const c = new Campaign({ name: 'X' });
    expect(c.comments.delayMinutes).toBe(2);
  });
});

describe('Campaign — referências', () => {
  test('guarda apenas IDs de contas e conteúdos', () => {
    const contas    = [oid(), oid()];
    const conteudos = [oid(), oid(), oid()];
    const c = new Campaign({ name: 'X', accountIds: contas, contentIds: conteudos });

    expect(c.validateSync()).toBeUndefined();
    expect(c.accountIds).toHaveLength(2);
    expect(c.contentIds).toHaveLength(3);
    // Referências, não cópias: nenhum dado de Account/Media embutido.
    expect(c.accountIds[0]).toBeInstanceOf(mongoose.Types.ObjectId);
  });

  test('referencia os models corretos', () => {
    // Em array de ObjectId, o Mongoose desta versão guarda o ref no options.type
    const refDe = campo => Campaign.schema.path(campo).options.type[0].ref;
    expect(refDe('accountIds')).toBe('Account');
    expect(refDe('contentIds')).toBe('Media');
  });
});

describe('CampaignPublication — criação e obrigatórios', () => {
  const base = () => ({
    campaignId:  oid(),
    accountId:   oid(),
    contentId:   oid(),
    scheduledAt: new Date(),
  });

  test('cria com os campos obrigatórios', () => {
    const p = new CampaignPublication(base());
    expect(p.validateSync()).toBeUndefined();
  });

  test.each(['campaignId', 'accountId', 'contentId', 'scheduledAt'])(
    'exige %s', (campo) => {
      const dados = base();
      delete dados[campo];
      const erro = new CampaignPublication(dados).validateSync();
      expect(erro?.errors?.[campo]).toBeDefined();
    }
  );

  test('defaults de status, tentativas e vínculos', () => {
    const p = new CampaignPublication(base());
    expect(p.status).toBe('pending');
    expect(p.attempts).toBe(0);
    expect(p.postId).toBeNull();
    expect(p.jobId).toBeNull();
    expect(p.bullMqJobId).toBe('');
    expect(p.publishedAt).toBeNull();
  });

  test('aceita todos os status previstos', () => {
    for (const status of ['pending', 'scheduled', 'processing', 'published', 'failed', 'cancelled']) {
      expect(new CampaignPublication({ ...base(), status }).validateSync()).toBeUndefined();
    }
  });

  test('rejeita status inexistente', () => {
    const erro = new CampaignPublication({ ...base(), status: 'quase' }).validateSync();
    expect(erro?.errors?.status).toBeDefined();
  });

  test('template fica bruto e o resolvido nasce vazio', () => {
    const p = new CampaignPublication({
      ...base(),
      captionTemplate: 'Novo conteúdo de {account_username}',
      commentTemplate: 'Veja também 👀',
    });
    expect(p.captionTemplate).toBe('Novo conteúdo de {account_username}');
    expect(p.resolvedCaption).toBe('');   // preenchido só na execução
    expect(p.resolvedComment).toBe('');
  });

  test('referencia Campaign, Account, Media, Post e Job', () => {
    const paths = CampaignPublication.schema.paths;
    expect(paths.campaignId.options.ref).toBe('Campaign');
    expect(paths.accountId.options.ref).toBe('Account');
    expect(paths.contentId.options.ref).toBe('Media');
    expect(paths.postId.options.ref).toBe('Post');
    expect(paths.jobId.options.ref).toBe('Job');
  });
});

describe('CampaignPublication — índices', () => {
  const indices = CampaignPublication.schema.indexes();

  test('índice único impede conta+conteúdo repetidos na mesma campanha', () => {
    const unico = indices.find(([campos, opts]) =>
      opts?.unique &&
      campos.campaignId === 1 && campos.accountId === 1 && campos.contentId === 1
    );
    expect(unico).toBeDefined();
  });

  test('tem índices para execução e painel', () => {
    const chaves = indices.map(([campos]) => Object.keys(campos).join('+'));
    expect(chaves).toEqual(expect.arrayContaining([
      'campaignId+status',
      'campaignId+scheduledAt',
      'accountId+scheduledAt',
      'status+scheduledAt',
    ]));
  });
});

describe('Compatibilidade — Fase 2 não toca no que existe', () => {
  test('Job e Post seguem carregáveis e intactos', () => {
    const Job  = require('../src/models/Job');
    const Post = require('../src/models/Post');

    // Job continua com os tipos originais — campanha não adicionou nada aqui.
    expect(Job.schema.path('type').enumValues).toEqual(['post', 'loop']);
    // Post segue exigindo mídia, como o fluxo atual espera.
    expect(Post.schema.path('media').isRequired).toBe(true);
  });

  test('models de campanha não colidem com os existentes', () => {
    expect(Campaign.modelName).toBe('Campaign');
    expect(CampaignPublication.modelName).toBe('CampaignPublication');
  });
});
