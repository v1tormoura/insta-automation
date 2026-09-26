import { describe, expect, it } from 'vitest';
import { getAccountTotals, getMediaInsights } from '../../src/integrations/meta/insights.js';
import { FakeMeta, metaError } from '../helpers/fakeMeta.js';

const since = new Date('2026-09-01T00:00:00Z');
const until = new Date('2026-09-30T00:00:00Z');

describe('insights resilientes', () => {
  it('uma métrica depreciada não derruba as outras', async () => {
    const meta = new FakeMeta().on('GET', /\/insights$/, (call) => {
      const metrics = call.params.metric!.split(',');
      if (metrics.includes('profile_links_taps')) return { status: 400, body: metaError(100, undefined, 'metric not supported') };
      return { body: { data: metrics.map((name) => ({ name, total_value: { value: 10 } })) } };
    });
    const r = await getAccountTotals(meta.client(), 't', '1', since, until);
    expect(r.values.reach).toBe(10);
    expect(r.unavailable.map((u) => u.key)).toEqual(['profile_links_taps']);
  });

  it('erro que não é de métrica (token, rede) sobe em vez de marcar tudo indisponível', async () => {
    const meta = new FakeMeta().reply('GET', /\/insights$/, metaError(190), 400);
    await expect(getAccountTotals(meta.client(), 't', '1', since, until)).rejects.toMatchObject({ category: 'auth' });
    const proxy = new FakeMeta().reply('GET', /\/insights$/, { message: 'Host not in allowlist' }, 403);
    await expect(getMediaInsights(proxy.client(), 't', 'm', 'FEED')).rejects.toMatchObject({ category: 'transient' });
  });

  it('se todas as métricas falham individualmente, é erro — não "tudo indisponível"', async () => {
    const meta = new FakeMeta().reply('GET', /\/insights$/, metaError(100, undefined, 'invalid'), 400);
    await expect(getMediaInsights(meta.client(), 't', 'm', 'STORY')).rejects.toMatchObject({ category: 'invalid_request' });
  });

  it('follows_and_unfollows vira saldo líquido', async () => {
    const meta = new FakeMeta().on('GET', /\/insights$/, (call) => ({
      body: {
        data: call.params.metric!.split(',').map((name) =>
          name === 'follows_and_unfollows'
            ? { name, total_value: { value: 0, breakdowns: [{ results: [{ dimension_values: ['FOLLOWER'], value: 30 }, { dimension_values: ['NON_FOLLOWER'], value: 12 }] }] } }
            : { name, total_value: { value: 1 } },
        ),
      },
    }));
    const r = await getAccountTotals(meta.client(), 't', '1', since, until);
    expect(r.values.follows_and_unfollows).toBe(18);
  });
});
