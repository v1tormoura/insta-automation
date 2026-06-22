function normalizeText(text = '') {
  return String(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function parseInstagramNumber(value = '') {
  let text = normalizeText(value).replace(/\u00a0/g, ' ');

  if (!text) return 0;

  text = text
    .replace('followers', '')
    .replace('follower', '')
    .replace('seguidores', '')
    .replace('seguidor', '')
    .replace('following', '')
    .replace('seguindo', '')
    .replace('posts', '')
    .replace('postagens', '')
    .replace('publicacoes', '')
    .replace('publicacao', '')
    .trim();

  const match = text.match(
    /(\d[\d\s.,]*)\s*(bilhoes|bilhao|billion|milhoes|milhao|million|thousand|mil|mi|k|b|m)?/i
  );

  if (!match) return 0;

  let raw = match[1].replace(/\s/g, '');
  const suffix = match[2] || '';

  const hasComma = raw.includes(',');
  const hasDot = raw.includes('.');

  if (hasComma && hasDot) {
    const lastComma = raw.lastIndexOf(',');
    const lastDot = raw.lastIndexOf('.');
    const decimal = lastComma > lastDot ? ',' : '.';
    const thousand = decimal === ',' ? '.' : ',';

    raw = raw.replace(new RegExp(`\\${thousand}`, 'g'), '').replace(decimal, '.');
  } else if (hasComma || hasDot) {
    const sep = hasComma ? ',' : '.';
    const parts = raw.split(sep);
    const last = parts[parts.length - 1];

    if (!suffix && last.length === 3) {
      raw = parts.join('');
    } else {
      raw = raw.replace(sep, '.');
    }
  }

  const number = Number.parseFloat(raw.replace(/[^0-9.]/g, ''));

  if (!Number.isFinite(number)) return 0;

  if (/^(b|billion|bilhao|bilhoes)$/.test(suffix)) {
    return Math.round(number * 1000000000);
  }

  if (/^(m|mi|million|milhao|milhoes)$/.test(suffix)) {
    return Math.round(number * 1000000);
  }

  if (/^(k|mil|thousand)$/.test(suffix)) {
    return Math.round(number * 1000);
  }

  return Math.round(number);
}

function extractFromDescription(description = '') {
  const text = normalizeText(description);

  const result = {
    followers: null,
    following: null,
    postsCount: null,
  };

  const followersMatch = text.match(
    /([\d\s.,]+(?:k|m|mi|mil|million|milhao|milhoes)?)\s+(followers|seguidores)/i
  );

  const followingMatch = text.match(
    /([\d\s.,]+(?:k|m|mi|mil|million|milhao|milhoes)?)\s+(following|seguindo)/i
  );

  const postsMatch = text.match(
    /([\d\s.,]+(?:k|m|mi|mil|million|milhao|milhoes)?)\s+(posts|postagens|publicacoes|publicacao)/i
  );

  if (followersMatch) {
    result.followers = parseInstagramNumber(followersMatch[1]);
  }

  if (followingMatch) {
    result.following = parseInstagramNumber(followingMatch[1]);
  }

  if (postsMatch) {
    result.postsCount = parseInstagramNumber(postsMatch[1]);
  }

  return result;
}

function extractFromStats(stats = []) {
  const lines = Array.isArray(stats)
    ? stats.map((s) => String(s || '').trim()).filter(Boolean)
    : [];

  const result = {
    followers: null,
    following: null,
    postsCount: null,
  };

  for (const line of lines) {
    const text = normalizeText(line);

    if (result.followers === null && (text.includes('followers') || text.includes('seguidores'))) {
      result.followers = parseInstagramNumber(line);
    }

    if (result.following === null && (text.includes('following') || text.includes('seguindo'))) {
      result.following = parseInstagramNumber(line);
    }

    if (
      result.postsCount === null &&
      (text.includes('posts') ||
        text.includes('postagens') ||
        text.includes('publicacoes') ||
        text.includes('publicacao'))
    ) {
      result.postsCount = parseInstagramNumber(line);
    }
  }

  if (lines.length >= 3) {
    result.postsCount ??= parseInstagramNumber(lines[0]);
    result.followers ??= parseInstagramNumber(lines[1]);
    result.following ??= parseInstagramNumber(lines[2]);
  }

  return result;
}

function extractFromBody(bodyText = '') {
  const lines = String(bodyText || '')
    .split('\n')
    .map((t) => t.trim())
    .filter(Boolean);

  const result = {
    followers: null,
    following: null,
    postsCount: null,
  };

  for (let i = 0; i < lines.length; i++) {
    const text = normalizeText(lines[i]);
    const prev = lines[i - 1] || '';
    const current = lines[i] || '';

    if (result.followers === null && (text === 'followers' || text === 'seguidores')) {
      result.followers = parseInstagramNumber(prev || current);
    }

    if (result.following === null && (text === 'following' || text === 'seguindo')) {
      result.following = parseInstagramNumber(prev || current);
    }

    if (
      result.postsCount === null &&
      (text === 'posts' || text === 'postagens' || text === 'publicacoes')
    ) {
      result.postsCount = parseInstagramNumber(prev || current);
    }
  }

  return result;
}

function extractInstagramProfileStats({ description = '', stats = [], bodyText = '' } = {}) {
  const fromDescription = extractFromDescription(description);
  const fromStats = extractFromStats(stats);
  const fromBody = extractFromBody(bodyText);

  return {
    followers: fromStats.followers ?? fromDescription.followers ?? fromBody.followers ?? 0,

    following: fromStats.following ?? fromDescription.following ?? fromBody.following ?? 0,

    postsCount: fromStats.postsCount ?? fromDescription.postsCount ?? fromBody.postsCount ?? 0,
  };
}

module.exports = {
  parseInstagramNumber,
  extractInstagramProfileStats,
};
