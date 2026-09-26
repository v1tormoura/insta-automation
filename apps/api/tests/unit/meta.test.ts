import { describe, expect, it } from 'vitest';
import { MetaApiError, MetaNetworkError, classifyMetaError } from '../../src/integrations/meta/errors.js';
import { parseUsage } from '../../src/integrations/meta/graphClient.js';
import { buildAuthorizeUrl, cleanAuthCode, parseShortLivedResponse } from '../../src/integrations/meta/instagramOAuth.js';
import { PermanentJobError, RetryableJobError, decideFailure, needsRequeue, MAX_ATTEMPTS } from '../../src/modules/publishing/publishExecutor.js';
import { deriveCampaignStatus, derivePostStatus } from '../../src/modules/publishing/aggregate.js';

describe('OAuth do Instagram', () => {
  it('monta a URL com escopos, state e force_reauth', () => {
    const url = new URL(
      buildAuthorizeUrl({ appId: '1', appSecret: 's', redirectUri: 'https://api/cb', forceReauth: true }, 'st4te'),
    );
    expect(url.origin + url.pathname).toBe('https://www.instagram.com/oauth/authorize');
    expect(url.searchParams.get('scope')).toBe(
      'instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights',
    );
    expect(url.searchParams.get('state')).toBe('st4te');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('force_reauth')).toBe('true');
  });

  it('limpa o sufixo #_ do code', () => {
    expect(cleanAuthCode('AQBabc#_')).toBe('AQBabc');
  });

  it('preserva user_id maior que 2^53 (não passa por JSON.parse)', () => {
    const text = '{"data":[{"access_token":"IGAAx","user_id":17841400000000001234,"permissions":"instagram_business_basic,instagram_business_content_publish"}]}';
    const parsed = parseShortLivedResponse(text);
    expect(parsed.userId).toBe('17841400000000001234');
    expect(parsed.permissions).toEqual(['instagram_business_basic', 'instagram_business_content_publish']);
  });

  it('aceita o formato plano da resposta', () => {
    const parsed = parseShortLivedResponse('{"access_token":"IGAAy","user_id":"42","permissions":["a","b"]}');
    expect(parsed).toEqual({ accessToken: 'IGAAy', userId: '42', permissions: ['a', 'b'] });
  });
});

describe('classifyMetaError', () => {
  it('token inválido não é retentável', () => {
    expect(classifyMetaError(400, { code: 190, error_subcode: 463 })).toMatchObject({ category: 'auth', retryable: false });
  });

  it('rate limit é retentável com espera', () => {
    const c = classifyMetaError(400, { code: 80002 }, 120_000);
    expect(c).toMatchObject({ category: 'rate_limit', retryable: true, retryAfterMs: 120_000 });
  });

  it('subcódigos de publicação têm mensagem própria', () => {
    expect(classifyMetaError(400, { code: 9, error_subcode: 2207042 })).toMatchObject({ category: 'publish_limit', retryable: true });
    expect(classifyMetaError(400, { code: 36003, error_subcode: 2207026 })).toMatchObject({ category: 'media', retryable: false });
    expect(classifyMetaError(400, { code: 9007, error_subcode: 2207027 }).category).toBe('not_ready');
  });

  it('5xx e is_transient são transitórios', () => {
    expect(classifyMetaError(500, undefined)).toMatchObject({ category: 'transient', retryable: true });
    expect(classifyMetaError(400, { code: 2, is_transient: true }).retryable).toBe(true);
  });

  it('permissão ausente', () => {
    expect(classifyMetaError(403, { code: 10 }).category).toBe('permission');
  });
});

describe('parseUsage', () => {
  it('lê o maior percentual e o tempo para recuperar acesso', () => {
    const headers = new Headers({
      'x-app-usage': '{"call_count":40,"total_time":10,"total_cputime":5}',
      'x-business-use-case-usage': '{"123":[{"type":"instagram","call_count":96,"estimated_time_to_regain_access":7}]}',
    });
    expect(parseUsage(headers)).toEqual({ maxPercent: 96, regainAccessMinutes: 7 });
  });
});

describe('decideFailure', () => {
  it('auth expira a conta e falha sem retry', () => {
    const d = decideFailure(new MetaApiError(400, { code: 190 }, '/x'), 1, 0);
    expect(d).toMatchObject({ action: 'fail', accountStatus: { status: 'EXPIRED' } });
  });

  it('rate limit espera sem gastar tentativa, até um teto', () => {
    const err = new MetaApiError(400, { code: 4 }, '/x', 60_000);
    expect(decideFailure(err, 1, 0).action).toBe('wait');
    expect(decideFailure(err, 1, 40).action).toBe('fail');
  });

  it('transitório tenta de novo com backoff crescente e desiste no limite', () => {
    const err = new MetaNetworkError('/x', new Error('ECONNRESET'));
    const d1 = decideFailure(err, 1, 0);
    const d3 = decideFailure(err, 3, 0);
    expect(d1.action).toBe('retry');
    expect(d3.action === 'retry' && d1.action === 'retry' && d3.delayMs > d1.delayMs).toBe(true);
    expect(decideFailure(err, MAX_ATTEMPTS, 0).action).toBe('fail');
  });

  it('erros próprios: permanente falha, retentável tenta', () => {
    expect(decideFailure(new PermanentJobError('X', 'x'), 1, 0).action).toBe('fail');
    expect(decideFailure(new RetryableJobError('Y', 'y'), 1, 0).action).toBe('retry');
  });

  it('mídia recusada não é retentada', () => {
    expect(decideFailure(new MetaApiError(400, { code: 36003, error_subcode: 2207026 }, '/x'), 1, 0).action).toBe('fail');
  });
});

describe('needsRequeue', () => {
  it('volta para a fila quando não há container para retomar', () => {
    expect(needsRequeue({ status: 'CREATING', containerId: null, childContainerIds: [] })).toBe(true);
    expect(needsRequeue({ status: 'PROCESSING', containerId: null, childContainerIds: [] })).toBe(true);
    expect(needsRequeue({ status: 'PROCESSING', containerId: 'c1', childContainerIds: [] })).toBe(false);
    expect(needsRequeue({ status: 'PUBLISHING', containerId: 'c1', childContainerIds: [] })).toBe(false);
  });
});

describe('status agregado', () => {
  const counts = (o: Partial<Record<'total' | 'published' | 'failed' | 'pending' | 'canceled', number>>) => ({
    total: 0, published: 0, failed: 0, pending: 0, canceled: 0, ...o,
  });

  it('post', () => {
    expect(derivePostStatus(counts({ total: 2, pending: 2 }), 0, false)).toBe('SCHEDULED');
    expect(derivePostStatus(counts({ total: 2, pending: 1, published: 1 }), 0, false)).toBe('PUBLISHING');
    expect(derivePostStatus(counts({ total: 2, published: 2 }), 0, false)).toBe('PUBLISHED');
    expect(derivePostStatus(counts({ total: 2, published: 1, failed: 1 }), 0, false)).toBe('PARTIAL');
    expect(derivePostStatus(counts({ total: 2, failed: 2 }), 0, false)).toBe('FAILED');
    expect(derivePostStatus(counts({ total: 3, published: 2, canceled: 1 }), 0, false)).toBe('PUBLISHED');
    expect(derivePostStatus(counts({}), 0, true)).toBe('DRAFT');
  });

  it('fila', () => {
    expect(deriveCampaignStatus(counts({ total: 4, pending: 2, published: 2 }), true)).toBe('PAUSED');
    expect(deriveCampaignStatus(counts({ total: 4, published: 4 }), false)).toBe('COMPLETED');
    expect(deriveCampaignStatus(counts({ total: 4, canceled: 4 }), false)).toBe('CANCELED');
  });
});

describe('respostas que não vieram da Graph API', () => {
  it('403 de proxy/firewall vira problema de conectividade retentável', () => {
    const c = classifyMetaError(403, { message: 'Host not in allowlist' });
    expect(c).toMatchObject({ category: 'transient', retryable: true });
    expect(c.message).toMatch(/HTTP 403/);
  });
});
