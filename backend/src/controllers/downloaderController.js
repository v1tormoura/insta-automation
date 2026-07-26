'use strict';

const Account = require('../models/Account');
const { createClient } = require('../services/instagramPrivateService');

function mapProfile(info) {
  return {
    id: String(info.pk),
    username: info.username,
    full_name: info.full_name || '',
    biography: info.biography || '',
    profile_pic_url: info.profile_pic_url || info.hd_profile_pic_url_info?.url || '',
    follower_count: info.follower_count || 0,
    following_count: info.following_count || 0,
    media_count: info.media_count || 0,
    is_private: !!info.is_private,
    is_verified: !!info.is_verified,
  };
}

function best(arr, key = 'width') {
  if (!arr?.length) return null;
  return arr.reduce((a, b) => ((b[key] || 0) > (a[key] || 0) ? b : a));
}

function mapItem(item) {
  const mt = item.media_type; // 1=image 2=video 8=carousel
  const base = {
    id: item.id,
    pk: String(item.pk),
    type: mt === 2 ? 'video' : mt === 8 ? 'carousel' : 'image',
    taken_at: item.taken_at,
    like_count: item.like_count || 0,
    comment_count: item.comment_count || 0,
    caption: item.caption?.text || '',
  };

  if (base.type === 'image') {
    const cands = item.image_versions2?.candidates || [];
    const hi = best(cands);
    const lo = cands[cands.length - 1] || hi;
    base.url   = hi?.url || '';
    base.thumb = lo?.url || hi?.url || '';
  } else if (base.type === 'video') {
    const vv = item.video_versions || [];
    const iv = item.image_versions2?.candidates || [];
    base.url      = best(vv)?.url || '';
    base.thumb    = best(iv)?.url || '';
    base.duration = item.video_duration || 0;
  } else if (base.type === 'carousel') {
    base.items = (item.carousel_media || []).map(cm => {
      if (cm.media_type === 2) {
        const vv = cm.video_versions || [];
        const iv = cm.image_versions2?.candidates || [];
        return { type: 'video', url: best(vv)?.url || '', thumb: best(iv)?.url || '' };
      }
      const iv = cm.image_versions2?.candidates || [];
      const u = best(iv)?.url || '';
      return { type: 'image', url: u, thumb: u };
    });
    const first = item.carousel_media?.[0];
    base.thumb = best(first?.image_versions2?.candidates)?.url || '';
    base.url   = base.items[0]?.url || '';
    base.count = base.items.length;
  }

  return base;
}

exports.searchProfile = async (req, res) => {
  try {
    const { username, accountId, cursor } = req.query;
    if (!username || !accountId) {
      return res.status(400).json({ error: 'username e accountId são obrigatórios' });
    }

    const account = await Account.findById(accountId);
    if (!account) return res.status(404).json({ error: 'Conta não encontrada' });

    const ig = await createClient(account);

    const clean = username.replace('@', '').trim();
    const targetId = await ig.user.getIdByUsername(clean);
    const userInfo = await ig.user.info(targetId);

    if (userInfo.is_private) {
      return res.status(403).json({ error: 'Perfil privado — não é possível acessar as mídias' });
    }

    const feed = ig.feed.user(targetId);
    if (cursor) feed.cursor = cursor;

    const page = await feed.items();
    const media = page.map(mapItem).filter(m => m.url);

    return res.json({
      profile: mapProfile(userInfo),
      media,
      has_more: feed.isMoreAvailable(),
      next_cursor: feed.cursor || null,
    });
  } catch (err) {
    console.error('[Downloader] searchProfile:', err.message);
    const msg = err.message || 'Erro desconhecido';
    if (msg.includes('user_not_found') || err.name === 'IgNotFoundError') {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }
    res.status(500).json({ error: msg });
  }
};

exports.proxyFile = async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'URL obrigatória' });

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Instagram 361.0.0.39.109 Android (33/13; 420dpi; 1080x2203; OnePlus; Nord)',
        'Accept': '*/*',
      },
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) return res.status(response.status).send('Arquivo não disponível');

    const ct = response.headers.get('content-type') || 'application/octet-stream';
    const isVideo = ct.includes('video') || url.includes('.mp4');
    const ext  = isVideo ? 'mp4' : 'jpg';
    const name = `mouraflow_${Date.now()}.${ext}`;

    res.set('Content-Type', ct);
    res.set('Content-Disposition', `attachment; filename="${name}"`);
    res.set('Cache-Control', 'no-cache');

    const cl = response.headers.get('content-length');
    if (cl) res.set('Content-Length', cl);

    const buf = await response.arrayBuffer();
    res.send(Buffer.from(buf));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
