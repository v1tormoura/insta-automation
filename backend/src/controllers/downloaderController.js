'use strict';

const { exec } = require('child_process');
const { promisify } = require('util');
const { Readable } = require('stream');
const execAsync = promisify(exec);

async function ytdlp(args, timeout = 60_000) {
  const { stdout } = await execAsync(`yt-dlp --no-warnings ${args}`, {
    timeout,
    maxBuffer: 20 * 1024 * 1024,
  });
  return stdout;
}

exports.searchProfile = async (req, res) => {
  const { username, cursor } = req.query;
  if (!username) return res.status(400).json({ error: 'Username obrigatório' });

  const clean = username.replace('@', '').trim().toLowerCase();
  const profileUrl = `https://www.instagram.com/${clean}/`;
  const start = cursor ? parseInt(cursor) + 1 : 1;
  const end = start + 19;

  try {
    const out = await ytdlp(
      `-J --flat-playlist --playlist-start ${start} --playlist-end ${end} "${profileUrl}"`,
      90_000
    );
    const data = JSON.parse(out);
    const entries = data.entries || [];

    const media = entries.map(e => ({
      id: e.id,
      pk: e.id,
      type: (e.duration > 0) ? 'video' : 'image',
      url: e.url || `https://www.instagram.com/p/${e.id}/`,
      thumb: e.thumbnail || null,
    }));

    res.json({
      profile: {
        username: data.uploader_id || clean,
        full_name: data.uploader || data.channel || clean,
        profile_pic_url: null,
        follower_count: 0,
        following_count: 0,
        media_count: data.playlist_count || 0,
        is_verified: false,
      },
      media,
      has_more: entries.length >= 20,
      next_cursor: String(start + entries.length - 1),
    });
  } catch (e) {
    const msg = (e.stderr || e.message || '').toLowerCase();
    if (msg.includes('private') || msg.includes('login required'))
      return res.status(403).json({ error: 'Perfil privado ou requer autenticação' });
    if (msg.includes('not found') || msg.includes('does not exist') || msg.includes('404'))
      return res.status(404).json({ error: 'Perfil não encontrado' });
    console.error('[Downloader] searchProfile:', e.message);
    res.status(500).json({ error: 'Erro ao buscar perfil' });
  }
};

exports.proxyFile = async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'URL obrigatória' });

  const isIgPage = url.includes('instagram.com/p/') || url.includes('instagram.com/reel/');

  try {
    let mediaUrl = url;

    if (isIgPage) {
      const out = await ytdlp(`--no-playlist --get-url -f "best[ext=mp4]/best" "${url}"`, 30_000);
      mediaUrl = out.trim().split('\n')[0];
    }

    const response = await fetch(mediaUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15',
        'Referer': 'https://www.instagram.com/',
      },
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const ct = response.headers.get('content-type') || 'application/octet-stream';
    const ext = (ct.includes('video') || mediaUrl.includes('.mp4')) ? 'mp4' : 'jpg';
    const cl = response.headers.get('content-length');

    res.set('Content-Type', ct);
    res.set('Content-Disposition', `attachment; filename="mouraflow_${Date.now()}.${ext}"`);
    res.set('Cache-Control', 'no-cache');
    if (cl) res.set('Content-Length', cl);

    Readable.fromWeb(response.body).pipe(res);
  } catch (e) {
    console.error('[Downloader] proxyFile:', e.message);
    if (!res.headersSent) res.status(500).json({ error: 'Erro ao baixar arquivo' });
  }
};
