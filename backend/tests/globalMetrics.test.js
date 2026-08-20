'use strict';

const mongoose = require('mongoose');
const { getGlobalMetrics } = require('../src/controllers/analyticsController');
const Account = require('../src/models/Account');
const Insight = require('../src/models/Insight');

describe('Métricas Globais — Contas Atualmente Logadas', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('Retorna zeros elegantes quando não há contas conectadas', async () => {
    jest.spyOn(Account, 'find').mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      }),
    });

    const req = { query: { period: '30d', force: 'true' } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

    await getGlobalMetrics(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        connectedAccountsCount: 0,
        totalFollowers: 0,
        totalReach: 0,
        totalStoryViews: 0,
        bestPost: null,
        bestPostByAccount: [],
      })
    );
  });

  test('Soma seguidores apenas das contas ativas e calcula métricas do período', async () => {
    const acc1 = { _id: new mongoose.Types.ObjectId(), username: 'conta1', followers: 50000, healthStatus: 'ativa' };
    const acc2 = { _id: new mongoose.Types.ObjectId(), username: 'conta2', followers: 30000, healthStatus: 'ativa' };

    jest.spyOn(Account, 'find').mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([acc1, acc2]),
      }),
    });

    jest.spyOn(Insight, 'aggregate').mockImplementation((pipeline) => {
      if (pipeline[0]?.$match?.mediaType === 'STORY') {
        return Promise.resolve([{ totalViews: 15000 }]);
      }
      if (pipeline[1]?.$group?.bestPostId) {
        return Promise.resolve([
          {
            _id: acc1._id,
            username: 'conta1',
            videoViews: 120000,
            reach: 90000,
            igMediaId: 'media_123',
            thumbnailUrl: '/thumb1.jpg',
          },
        ]);
      }
      return Promise.resolve([{
        totalReach: 250000,
        totalViews: 300000,
        totalLikes: 12000,
        totalComments: 1400,
      }]);
    });

    jest.spyOn(Insight, 'find').mockReturnValue({
      sort: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([
            {
              accountId: acc1._id,
              username: 'conta1',
              igMediaId: 'media_123',
              mediaType: 'VIDEO',
              videoViews: 120000,
              reach: 90000,
              thumbnailUrl: '/thumb1.jpg',
              permalink: 'https://instagram.com/p/123',
            },
          ]),
        }),
      }),
    });

    const req = { query: { period: '30d', force: 'true' } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

    await getGlobalMetrics(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        connectedAccountsCount: 2,
        totalFollowers: 80000,
        totalReach: 250000,
        totalViews: 300000,
        totalStoryViews: 15000,
        bestPost: expect.objectContaining({
          username: 'conta1',
          videoViews: 120000,
        }),
      })
    );
  });
});
