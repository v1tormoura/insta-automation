const path = require('path');
const { convertToReelFormat } = require('./videoProcessor');

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function isVideo(media) {
  const file = media.toLowerCase();
  return file.endsWith('.mp4') || file.endsWith('.mov') || file.endsWith('.webm');
}

// Click any button/div whose visible text matches one of the provided strings (case-insensitive).
// Uses EXACT trimmed match to avoid false positives (e.g. 'ok' inside 'facebook').
async function clickButton(page, texts) {
  const buttons = await page.$$('button, div[role="button"]');

  for (const btn of buttons) {
    try {
      const txt = await page.evaluate((el) => (el.innerText || '').trim(), btn);
      if (!txt) continue;

      const txtLow = txt.toLowerCase();
      for (const t of texts) {
        const tLow = t.toLowerCase();
        // Exact match only — no substring — prevents 'ok' matching 'facebook'
        if (txtLow === tLow) {
          const box = await btn.boundingBox();
          if (box) {
            await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          } else {
            await page.evaluate((el) => el.click(), btn);
          }
          console.log('✅ CLICADO:', txt);
          await delay(2500);
          return true;
        }
      }
    } catch {}
  }

  return false;
}

// Click the "Next/Avançar/Próximo/Continue" button — multiple retries.
// Prefers buttons in the modal header (top of screen, y < 120px) to avoid
// accidentally clicking feed carousel arrows or other background elements.
async function clickExactNext(page) {
  const nextTexts = ['next', 'avançar', 'avancar', 'próximo', 'proximo', 'continuar', 'continue', 'seguinte'];

  for (let i = 0; i < 20; i++) {
    const result = await page.evaluate((texts) => {
      function isVisible(el) {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      }

      function textMatch(el) {
        const txt = (el.innerText || '').trim().toLowerCase();
        const aria = (el.getAttribute('aria-label') || '').toLowerCase();
        const title = (el.getAttribute('title') || '').toLowerCase();
        return texts.some((t) =>
          txt === t || aria === t || title === t || aria.includes(t) || title.includes(t)
        );
      }

      // Only look at real interactive elements (not divs/spans — too broad)
      const elements = [
        ...document.querySelectorAll('button, [role="button"], a[href]'),
      ].filter(isVisible);

      // Priority 1: button inside a modal/dialog
      const inModal = elements.find((el) => {
        if (!textMatch(el)) return false;
        let p = el.parentElement;
        while (p && p !== document.body) {
          const role = p.getAttribute?.('role');
          const dm = p.getAttribute?.('aria-modal');
          if (role === 'dialog' || dm === 'true' || p.tagName === 'DIALOG') return true;
          p = p.parentElement;
        }
        return false;
      });
      if (inModal) { inModal.click(); return { clicked: true, via: 'modal' }; }

      // Priority 2: button in the header area (y < 120px) — modal header "Avançar"
      const inHeader = elements.find((el) => {
        if (!textMatch(el)) return false;
        const r = el.getBoundingClientRect();
        return r.y < 120;
      });
      if (inHeader) { inHeader.click(); return { clicked: true, via: 'header' }; }

      // Priority 3: any visible matching button (fallback)
      const any = elements.find(textMatch);
      if (any) { any.click(); return { clicked: true, via: 'any' }; }

      // Debug: return what buttons are visible
      const debugBtns = [...document.querySelectorAll('button, [role="button"]')]
        .filter(isVisible)
        .map(el => ({
          tag: el.tagName,
          txt: (el.innerText || '').trim().slice(0, 40),
          aria: el.getAttribute('aria-label'),
          y: Math.round(el.getBoundingClientRect().y),
        }))
        .slice(0, 15);

      return { clicked: false, debug: debugBtns };
    }, nextTexts);

    if (result.clicked) {
      console.log(`✅ NEXT CLICADO [${result.via}]`);
      await delay(2000);
      return true;
    }

    // Log what's on screen once per 5 attempts
    if (i % 5 === 0 && result.debug) {
      console.log(`🔍 [Next ${i}] Botões visíveis:`, JSON.stringify(result.debug));
    }

    await delay(1000);
  }

  return false;
}

async function closePopups(page) {
  await clickButton(page, ['OK', 'Got it', 'Entendi', 'Not now', 'Agora não']);
}

// Kept for backward compat — delegates to isCreateModalOpen
async function isUploadModalOpen(page) {
  return isCreateModalOpen(page);
}

// Check if the create-post upload modal is open (strict — text-only, no file input check)
async function isCreateModalOpen(page) {
  return page.evaluate(() => {
    const t = (document.body.innerText || '').toLowerCase();
    return (
      t.includes('selecionar do computador') ||
      t.includes('select from computer') ||
      t.includes('criar nova publicação') ||
      t.includes('create new post') ||
      t.includes('arraste fotos') ||
      t.includes('drag photos')
    );
  });
}

// Open the Instagram create post dialog via the sidebar "Create/+" button.
async function openCreate(page) {
  console.log('➕ Abrindo modal de criação...');

  // Skip navigation if already on Instagram — avoids unnecessary page reload
  const currentUrl = page.url();
  const alreadyOnInstagram = currentUrl.includes('instagram.com') && !currentUrl.includes('/login');

  if (!alreadyOnInstagram) {
    console.log('📍 Navegando para instagram.com...');
    await page.goto('https://www.instagram.com/', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    await delay(5000);
  } else {
    console.log('📍 Já no Instagram — sem reload');
    await delay(1000);
  }
  await closePopups(page);

  // ── Strategy 1: SVG aria-label (most specific) ──────────────────────────
  let modalOpen = await page.evaluate(() => {
    const svgs = [...document.querySelectorAll('svg[aria-label]')];
    const svg = svgs.find(s => {
      const l = (s.getAttribute('aria-label') || '').toLowerCase();
      return l.includes('criar') || l.includes('create') || l.includes('nova') || l.includes('new post');
    });
    if (!svg) return false;
    let el = svg;
    while (el) {
      if (el.tagName === 'A' || el.tagName === 'BUTTON' || el.getAttribute?.('role') === 'button') { el.click(); return true; }
      el = el.parentElement;
    }
    svg.parentElement?.click(); return true;
  });

  // ── Strategy 2: text / aria-label / href match ───────────────────────────
  if (!modalOpen) {
    modalOpen = await page.evaluate(() => {
      const all = [...document.querySelectorAll('a, button, [role="button"], div, span')];
      const target = all.find(el => {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return false;
        const text = (el.innerText || '').trim().toLowerCase();
        const aria = (el.getAttribute('aria-label') || '').toLowerCase();
        const href = el.getAttribute('href') || '';
        return text === 'criar' || text === 'create' || text === '+' ||
               aria.includes('criar') || aria.includes('create') || aria.includes('nova publicação') ||
               href === '/create/' || href.startsWith('/create');
      });
      if (!target) return false;
      target.click(); return true;
    });
  }

  // ── Strategy 3: click-sweep all href="#" sidebar buttons ─────────────────
  // The Instagram "+ Create" button has no text/aria — just href="#"
  // We try each one and stop when the modal text appears.
  if (!modalOpen) {
    console.log('🔄 Click sweep nos botões da sidebar...');

    const candidates = await page.evaluate(() => {
      return [...document.querySelectorAll('a[href="#"], a:not([href]), button')]
        .filter(el => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && r.x < 100;
        })
        .map(el => {
          const r = el.getBoundingClientRect();
          return { cx: Math.round(r.x + r.width / 2), cy: Math.round(r.y + r.height / 2) };
        });
    });

    console.log(`🔍 Candidatos sidebar: ${candidates.length}`, JSON.stringify(candidates));

    for (const { cx, cy } of candidates) {
      await page.mouse.click(cx, cy);
      await delay(1200);

      // Quick close of any side-panel that opened (e.g. Notifications)
      const isNotif = await page.evaluate(() => {
        const t = (document.body.innerText || '').toLowerCase();
        return t.includes('notificaç') || t.includes('notification') || t.includes('atividade');
      });
      if (isNotif) {
        await page.keyboard.press('Escape');
        await delay(600);
      }

      if (await isCreateModalOpen(page)) {
        console.log(`✅ Modal aberto clicando em (${cx}, ${cy})`);
        modalOpen = true;
        break;
      }

      await page.keyboard.press('Escape');
      await delay(600);
    }
  }

  if (!modalOpen) {
    console.log('⚠️ Modal de criação não encontrado após todas as estratégias');
  }

  await delay(2000);
  await closePopups(page);

  // Click sub-menu "Post/Publicação" if a create-type submenu appeared
  await page.evaluate(() => {
    const post = [...document.querySelectorAll('a, button, [role="button"], li, div, span')].find(el => {
      const t = (el.innerText || '').trim().toLowerCase();
      return t === 'publicação' || t === 'post' || t === 'nova publicação' || t === 'new post';
    });
    if (post) post.click();
  });

  await delay(2000);
  console.log('✅ openCreate concluído');
}

// Click "Select from computer" button — returns true if found and clicked
async function clickSelectFromComputer(page) {
  return page.evaluate(() => {
    const texts = [
      'select from computer', 'selecionar do computador',
      'selecionar no computador', 'escolher do computador',
      'choose from computer', 'selecionar do dispositivo',
      'select from device',
    ];
    const all = [...document.querySelectorAll('button, div[role="button"], a, span, div')];
    const btn = all.find(el => {
      const t = (el.innerText || '').trim().toLowerCase();
      return texts.some(x => t.includes(x));
    });
    if (btn) { btn.click(); return true; }
    return false;
  });
}

// Score an input: higher = more likely to be the main post upload input
async function scoreInput(input) {
  return input.evaluate((el) => {
    const accept = (el.getAttribute('accept') || '').toLowerCase();
    const multiple = el.hasAttribute('multiple');
    let score = 0;
    if (accept.includes('video')) score += 10;
    if (accept.includes('mp4')) score += 5;
    if (accept === '') score += 3;          // no restriction = permissive
    if (multiple) score += 8;              // main upload usually allows multiple
    if (accept === 'image/jpeg') score -= 5; // cover/profile photo inputs
    return score;
  });
}

async function waitForUploadInput(page) {
  // Puppeteer's uploadFile() works directly on hidden file inputs —
  // no need to click "Selecionar do computador" first.
  // The modal's upload input (accept includes video/mp4) scores ~23.
  // Return it immediately when found.
  for (let i = 0; i < 15; i++) {
    const all = await page.$$('input[type="file"]');

    if (all.length > 0) {
      const scored = [];
      for (const input of all) {
        const score = await scoreInput(input);
        const accept = await input.evaluate(el => el.getAttribute('accept') || '');
        scored.push({ input, score, accept });
      }
      scored.sort((a, b) => b.score - a.score);
      const best = scored[0];

      // Use immediately if good score, or after 3s if only poor inputs exist
      if (best.score > 0 || i >= 3) {
        console.log(`✅ Input (score ${best.score}):`, best.accept || 'sem accept');
        return best.input;
      }
    }

    console.log(`⏳ [${i}] Aguardando input... total: ${all.length}`);
    await delay(1000);
  }

  return null;
}

// Helper: find and click the 9:16 text option in the currently visible DOM
async function tryClick916(page) {
  return page.evaluate(() => {
    const all = [...document.querySelectorAll('button, div[role="button"], span, div, li, a')];
    const target = all.find(el => {
      const t = (el.innerText || '').trim();
      return t === '9:16';
    });
    if (!target) return false;
    target.click();
    return true;
  });
}

// Helper: open the aspect-ratio selector (the small icon at bottom of the crop video area)
async function openCropRatioMenu(page) {
  // Strategy 1: SVG with crop/aspect/ratio/proporção in aria-label
  const viaSvg = await page.evaluate(() => {
    const keywords = ['crop', 'cortar', 'aspect', 'proporção', 'ratio', 'tamanho', 'formato', 'select crop', 'selecionar'];
    const svgs = [...document.querySelectorAll('svg')];
    const found = svgs.find(s => {
      const l = (s.getAttribute('aria-label') || '').toLowerCase();
      return keywords.some(k => l.includes(k));
    });
    if (!found) return false;
    let el = found;
    while (el && el !== document.body) {
      const tag = el.tagName;
      const role = el.getAttribute?.('role');
      if (tag === 'BUTTON' || tag === 'A' || role === 'button') { el.click(); return true; }
      el = el.parentElement;
    }
    found.parentElement?.click();
    return true;
  });
  if (viaSvg) { console.log('📐 Menu de proporção aberto via SVG'); return true; }

  // Strategy 2: small icon buttons (no text, ≤48px) in the lower half of the viewport
  const viaSmall = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button, div[role="button"]')];
    const small = btns.find(el => {
      const r = el.getBoundingClientRect();
      const noText = !(el.innerText || '').trim();
      return noText && r.width > 0 && r.width <= 60 && r.height <= 60 && r.y > window.innerHeight * 0.35;
    });
    if (!small) return false;
    small.click();
    return true;
  });
  if (viaSmall) { console.log('📐 Menu de proporção aberto via small-btn'); return true; }

  // Strategy 3: click at the position of the first SVG inside the video-area overlay
  const viaPos = await page.evaluate(() => {
    // Find a video or canvas element (the video preview), then click near bottom-left
    const video = document.querySelector('video, canvas');
    if (!video) return false;
    const r = video.getBoundingClientRect();
    // Bottom-left area, offset slightly inward
    const x = r.x + 28;
    const y = r.y + r.height - 28;
    const el = document.elementFromPoint(x, y);
    if (el && el !== document.body) { el.click(); return true; }
    return false;
  });
  if (viaPos) { console.log('📐 Menu de proporção aberto via posição'); return true; }

  return false;
}

async function adjustVideoCrop916(page) {
  console.log('🎬 Ajustando crop 9:16 e avançando...');

  // Step 1: try clicking 9:16 if it's already visible
  let selected = await tryClick916(page);

  if (selected) {
    console.log('✅ Crop 9:16 selecionado (direto)');
    await delay(800);
  } else {
    // Step 2: open the aspect ratio selector, then click 9:16
    console.log('⚠️ 9:16 não visível — abrindo seletor de proporção...');
    const opened = await openCropRatioMenu(page);

    if (opened) {
      await delay(1000);
      selected = await tryClick916(page);
      if (selected) {
        console.log('✅ Crop 9:16 selecionado (após abrir menu)');
        await delay(800);
      } else {
        console.log('⚠️ 9:16 ainda não encontrado após abrir menu — continuando sem selecionar');
      }
    } else {
      console.log('⚠️ Seletor de proporção não encontrado — continuando sem selecionar 9:16');
    }
  }

  // Click Next/Avançar
  // Wait for Avançar to be enabled (video might still be processing)
  console.log('⏳ Aguardando Avançar ficar disponível...');
  for (let w = 0; w < 20; w++) {
    const ready = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button, div[role="button"], a, div, span')];
      const next = btns.find(el => {
        const t = (el.innerText || '').trim().toLowerCase();
        return t === 'avançar' || t === 'next';
      });
      if (!next) return false;
      const disabled = next.getAttribute('disabled') !== null ||
                       next.getAttribute('aria-disabled') === 'true';
      return !disabled;
    });
    if (ready) { console.log('✅ Avançar disponível'); break; }
    await delay(1000);
  }

  const nextCrop = await clickExactNext(page);
  if (nextCrop) {
    console.log('➡️ Next da tela de crop clicado');
    await delay(3000);
  } else {
    console.log('⚠️ Next não encontrado no crop — continuando...');
  }
}

async function waitForCoverScreen(page) {
  for (let i = 0; i < 12; i++) {  // max 12s — don't stall creation flow
    const found = await page.evaluate(() => {
      const text = (document.body.innerText || '').toLowerCase();
      return (
        text.includes('foto de capa') ||
        text.includes('foto da capa') ||
        text.includes('cover photo') ||
        text.includes('add a cover') ||
        text.includes('adicionar capa') ||
        text.includes('editar capa') ||
        text.includes('edit cover') ||
        text.includes('capa do reel') ||
        text.includes('reel cover') ||
        text.includes('escolha a capa') ||
        text.includes('selecionar capa') ||
        text.includes('selecione a capa') ||
        text.includes('frame de capa') ||
        text.includes('cover frame') ||
        text.includes('select from computer') ||
        text.includes('selecionar do computador') ||
        text.includes('selecione no computador') ||
        text.includes('choose from computer') ||
        text.includes('escolher do computador')
      );
    });

    if (found) {
      console.log('✅ Tela de capa detectada');
      return true;
    }

    await delay(1000);
  }

  return false;
}

// Resilient cover upload — multiple fallback strategies
async function uploadReelCover(page, post) {
  if (!post.cover) {
    console.log('⚠️ Reel sem capa personalizada');
    return false;
  }

  const coverPath = path.resolve(__dirname, '../../uploads', post.cover);

  const foundCoverScreen = await waitForCoverScreen(page);

  if (!foundCoverScreen) {
    console.log('⚠️ Tela de capa não apareceu');
    return false;
  }

  console.log('🖼️ Enviando capa personalizada...');

  // Do NOT click "Selecionar" — that opens the native OS file picker which we don't need.
  // uploadFile() sets the input value directly, bypassing the file dialog.
  await delay(800);

  // Strategy 1: prefer an image-only file input (cover = image, not video)
  const inputs = await page.$$('input[type="file"]');
  let coverInput = null;

  for (const inp of inputs) {
    const accept = await inp.evaluate((el) => (el.getAttribute('accept') || '').toLowerCase());
    if (accept.includes('image') && !accept.includes('video')) {
      coverInput = inp;
      console.log('✅ Input de capa (image-only) encontrado:', accept);
      break;
    }
  }

  // Strategy 3: fall back to last input on page
  if (!coverInput && inputs.length) {
    coverInput = inputs[inputs.length - 1];
    console.log('⚠️ Usando último input disponível como fallback de capa');
  }

  // Strategy 3b: retry after brief wait (input might not be in DOM yet)
  if (!coverInput) {
    console.log('⚠️ Aguardando input de capa aparecer...');
    await delay(2000);
    const inputsRetry = await page.$$('input[type="file"]');
    for (const inp of inputsRetry) {
      const accept = await inp.evaluate((el) => (el.getAttribute('accept') || '').toLowerCase());
      if (accept.includes('image') && !accept.includes('video')) {
        coverInput = inp;
        console.log('✅ Input de capa encontrado após retry:', accept);
        break;
      }
    }
    if (!coverInput && inputsRetry.length) {
      coverInput = inputsRetry[inputsRetry.length - 1];
    }
    if (!coverInput) {
      console.log('⚠️ Nenhum input encontrado — pulando capa');
      return false;
    }
  }

  await coverInput.uploadFile(coverPath);
  console.log('✅ CAPA ENVIADA');
  await delay(7000);
  return true;
}

async function goToFinalScreen(page) {
  for (let i = 0; i < 6; i++) {
    await closePopups(page);

    const state = await page.evaluate(() => {
      const text = document.body.innerText || '';
      const tl = text.toLowerCase();

      const hasShare = [...document.querySelectorAll('button, div[role="button"]')].some(el => {
        const txt = (el.innerText || '').toLowerCase();
        return txt === 'share' || txt === 'compartilhar' || txt === 'publicar';
      });

      const hasCaption =
        tl.includes('write a caption') ||
        tl.includes('escreva uma legenda') ||
        tl.includes('legenda') ||
        !!document.querySelector('div[role="textbox"], textarea');

      return {
        hasFinal: hasShare || hasCaption,
        snippet: text.slice(0, 200),
      };
    });

    console.log(`🔍 goToFinalScreen [${i}]: final=${state.hasFinal} | "${state.snippet.replace(/\n/g,' ').slice(0,100)}"`);

    if (state.hasFinal) {
      console.log('✅ Tela final detectada');
      return true;
    }

    const next = await clickExactNext(page);
    if (next) {
      console.log('➡️ Next clicado para avançar');
    } else {
      console.log('⏳ Next ainda não apareceu');
    }

    await delay(3000);
  }

  return false;
}

async function insertCaption(page, caption) {
  if (!caption) return;

  console.log('📝 INSERINDO LEGENDA');

  await delay(4000);

  const selectors = [
    'div[aria-label="Write a caption..."]',
    'div[aria-label="Escreva uma legenda..."]',
    'div[contenteditable="true"][role="textbox"]',
    'div[role="textbox"]',
    'textarea',
  ];

  let captionBox = null;

  for (const selector of selectors) {
    captionBox = await page.$(selector);

    if (captionBox) {
      console.log('✅ Campo legenda encontrado:', selector);
      break;
    }
  }

  if (!captionBox) {
    console.log('⚠️ Campo legenda não encontrado');
    return;
  }

  await captionBox.click();

  await delay(1000);

  await page.keyboard.down('Control');
  await page.keyboard.press('A');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');

  await delay(500);

  await page.keyboard.type(caption, {
    delay: 80,
  });

  await delay(2000);

  console.log('✅ LEGENDA INSERIDA');
}

// Tag a location on the caption/details screen.
// Non-fatal — if Instagram's UI changes this step is skipped, not thrown.
async function addLocation(page, location) {
  if (!location) return false;

  console.log('📍 Adicionando localização:', location);

  // Click the "Add location" row/button
  const clicked = await page.evaluate(() => {
    const candidates = [
      ...document.querySelectorAll('button, div[role="button"], a, span, div, p'),
    ];

    const target = candidates.find((el) => {
      const text = (el.innerText || '').trim().toLowerCase();
      const aria = (el.getAttribute('aria-label') || '').toLowerCase();
      const placeholder = (el.getAttribute('placeholder') || '').toLowerCase();

      return (
        text === 'add location' ||
        text === 'adicionar localização' ||
        text === 'localização' ||
        text === 'location' ||
        text.includes('add location') ||
        text.includes('adicionar localização') ||
        aria.includes('location') ||
        aria.includes('localização') ||
        placeholder.includes('location') ||
        placeholder.includes('localização')
      );
    });

    if (!target) return false;

    let el = target;
    for (let i = 0; i < 6; i++) {
      if (!el) break;
      const role = el.getAttribute?.('role');
      const tag = el.tagName;
      if (role === 'button' || tag === 'BUTTON' || tag === 'A' || tag === 'DIV') {
        el.click();
        return true;
      }
      el = el.parentElement;
    }

    target.click();
    return true;
  });

  if (!clicked) {
    console.log('⚠️ Botão de localização não encontrado — pulando');
    return false;
  }

  await delay(3000);

  // Find the location search input
  let searchInput = null;

  const inputSelectors = [
    'input[placeholder*="ocation" i]',
    'input[placeholder*="calização" i]',
    'input[placeholder*="Search" i]',
    'input[placeholder*="Buscar" i]',
    'input[placeholder*="usca" i]',
    'input[name*="location" i]',
    'input[type="search"]',
    'input[type="text"]',
  ];

  for (const sel of inputSelectors) {
    try {
      searchInput = await page.$(sel);
      if (searchInput) {
        console.log('✅ Campo de busca de localização encontrado:', sel);
        break;
      }
    } catch {}
  }

  if (!searchInput) {
    console.log('⚠️ Input de busca de localização não encontrado — pulando');
    return false;
  }

  await searchInput.click();
  await delay(500);
  await page.keyboard.type(location, { delay: 100 });
  await delay(4000); // wait for Instagram to return suggestions

  // Click first visible suggestion
  const picked = await page.evaluate(() => {
    const itemSelectors = [
      'li',
      'div[role="option"]',
      'div[role="listitem"]',
      'div[role="menuitem"]',
      'button[role="option"]',
    ];

    for (const sel of itemSelectors) {
      const items = [...document.querySelectorAll(sel)];
      const visible = items.find((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && (el.innerText || '').trim().length > 0;
      });
      if (visible) {
        visible.click();
        return (visible.innerText || '').trim();
      }
    }

    return false;
  });

  if (picked) {
    console.log('✅ Localização selecionada:', picked);
    await delay(2000);
    return true;
  }

  console.log('⚠️ Nenhum resultado de localização encontrado — pulando');
  return false;
}

// Upload the media file by intercepting the native file chooser dialog via CDP.
// page.setInterceptFileChooserDialog() was removed in Puppeteer v22+,
// so we send the CDP command directly then listen to the page 'filechooser' event.
async function uploadViaFileChooser(page, mediaPath) {
  let client = null;
  try {
    client = await page.createCDPSession();
    // Enable file chooser interception at the CDP level
    await client.send('Page.setInterceptFileChooserDialog', { enabled: true });

    const chooserPromise = new Promise((resolve) => {
      page.once('filechooser', (chooser) => resolve(chooser));
    });

    // Click "Select from computer" — triggers the native file dialog
    const clicked = await clickSelectFromComputer(page);
    if (!clicked) {
      await page.evaluate(() => {
        const all = [...document.querySelectorAll('button, div[role="button"]')];
        const btn = all.find(el => {
          const t = (el.innerText || '').trim().toLowerCase();
          return t.includes('select') || t.includes('selecionar') || t.includes('escolher') || t.includes('choose');
        });
        if (btn) btn.click();
      });
    }

    // Wait for the file chooser event (up to 15 seconds)
    const fileChooser = await Promise.race([
      chooserPromise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('File chooser timeout após 15s')), 15000)
      ),
    ]);

    await fileChooser.accept([mediaPath]);
    console.log('✅ Arquivo enviado via file chooser (CDP)');
    return true;
  } catch (err) {
    console.log('⚠️ File chooser falhou:', err.message);
    return false;
  } finally {
    if (client) {
      try { await client.send('Page.setInterceptFileChooserDialog', { enabled: false }); } catch {}
      try { await client.detach(); } catch {}
    }
  }
}

async function postToInstagram(page, post) {
  console.log('📤 Iniciando postagem...');
  console.log('TIPO:', post.postType);
  console.log('📝 LEGENDA:', post.caption);
  if (post.location) console.log('📍 LOCALIZAÇÃO:', post.location);

  let mediaPath = path.resolve(__dirname, '../../uploads', post.media);

  const video = isVideo(post.media);

  if (video) {
    console.log('🎬 Convertendo vídeo para formato Reel 1080x1920...');
    mediaPath = await convertToReelFormat(mediaPath);
  }

  await openCreate(page);

  // Find the file input and upload directly
  // (Puppeteer's uploadFile bypasses the accept attribute — works for video even on image/jpeg inputs)
  const input = await waitForUploadInput(page);
  if (!input) throw new Error('Input de upload não encontrado');
  await input.uploadFile(mediaPath);
  console.log(video ? '🎬 Vídeo enviado' : '🖼️ Imagem enviada');

  if (video) {
    // Give Instagram at least 5s to start the upload before checking for crop screen.
    // This avoids false positives from feed text containing "original", "cortar", etc.
    await delay(5000);
    console.log('⏳ Aguardando tela de crop aparecer...');
    let cropReady = false;
    for (let i = 0; i < 25; i++) {
      const state = await page.evaluate(() => {
        const t = (document.body.innerText || '').toLowerCase();
        // Require BOTH "cortar"/"crop" AND "avançar" — both are in the crop modal header.
        // "original" or "9:16" alone can appear in the feed and give false positives.
        const hasCrop =
          (t.includes('cortar') || t.includes('crop')) &&
          (t.includes('avançar') || t.includes('avancar'));
        return hasCrop;
      });
      if (state) {
        console.log(`✅ Tela de crop detectada em ${i + 5}s`);
        cropReady = true;
        await delay(800);
        break;
      }
      await delay(1000);
    }
    if (!cropReady) {
      console.log('⚠️ Tela de crop não detectada, continuando mesmo assim...');
      await delay(2000);
    }
  } else {
    await delay(3000); // images load fast
  }

  await closePopups(page);

  if (video) {
    await adjustVideoCrop916(page);

    if (post.cover) {
      const uploaded = await uploadReelCover(page, post);

      if (uploaded) {
        console.log('➡️ Avançando após capa enviada...');
        await clickExactNext(page);
        await delay(6000);
      }
    }
  }

  const finalReady = await goToFinalScreen(page);

  if (!finalReady) {
    throw new Error('Tela final não encontrada');
  }

  await insertCaption(page, post.caption || '');

  // Add location — defaults to "Brasil" when not specified
  const locationToUse = post.location || 'Brasil';
  try {
    await addLocation(page, locationToUse);
  } catch (err) {
    console.log('⚠️ Erro ao adicionar localização (não fatal):', err.message);
  }

  await closePopups(page);

  const shared = await clickButton(page, ['Share', 'Compartilhar', 'Publish', 'Publicar']);

  if (!shared) {
    throw new Error('Publicar não encontrado');
  }

  console.log(video ? '🚀 PUBLICANDO REEL' : '🚀 PUBLICANDO POST');

  await delay(video ? 60000 : 25000);

  console.log('✅ PUBLICADO');
}

module.exports = postToInstagram;
