const path = require('path');

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function clickByText(page, texts) {
  const clicked = await page.evaluate((texts) => {
    const normalizedTexts = texts.map((t) => t.toLowerCase());

    const elements = [...document.querySelectorAll('button, div[role="button"], a, span, div')];

    for (const el of elements) {
      const text = (el.innerText || '').trim().toLowerCase();

      if (!text) continue;

      const found = normalizedTexts.some((t) => text.includes(t));

      if (found) {
        let target = el;

        while (target) {
          const role = target.getAttribute?.('role');
          const tag = target.tagName;

          if (role === 'button' || tag === 'BUTTON' || tag === 'A' || tag === 'DIV') {
            target.click();
            return true;
          }

          target = target.parentElement;
        }

        el.click();
        return true;
      }
    }

    return false;
  }, texts);

  if (clicked) {
    console.log('✅ Clicado:', texts.join(' / '));
    await delay(2500);
    return true;
  }

  return false;
}

async function closeInssistIntro(page) {
  await delay(3000);

  await clickByText(page, [
    "ok, let's explore",
    'lets explore',
    'explore',
    'not interested',
    'não tenho interesse',
    'agora não',
  ]);
}

async function clickPublishStories(page) {
  console.log('🔍 Procurando Publish stories da INSSIST...');

  for (let i = 0; i < 15; i++) {
    const clicked = await clickByText(page, [
      'publish stories',
      'publish story',
      'publicar stories',
      'publicar story',
    ]);

    if (clicked) {
      console.log('✅ Publish stories clicado');
      return true;
    }

    console.log('⏳ Aguardando botão Publish stories...');
    await delay(1000);
  }

  return false;
}

async function waitForUploadInput(page) {
  for (let i = 0; i < 40; i++) {
    const inputs = await page.$$('input[type="file"]');

    if (inputs.length) {
      console.log(`✅ Inputs encontrados: ${inputs.length}`);
      return inputs[inputs.length - 1];
    }

    console.log('⏳ Aguardando input da INSSIST...');
    await delay(1000);
  }

  return null;
}

async function tryAddStoryLink(page, post) {
  const link = post.storyLink || '';
  const linkText = post.storyLinkText || '';

  if (!link) {
    return;
  }

  console.log('🔗 Tentando adicionar link ao Story...');

  const openedLink = await clickByText(page, [
    'link',
    'add link',
    'url',
    'sticker',
    'link sticker',
    'adicionar link',
  ]);

  if (!openedLink) {
    console.log('⚠️ Não encontrei opção de link na INSSIST');
    return;
  }

  await delay(2000);

  const inputs = await page.$$('input, textarea');

  if (!inputs.length) {
    console.log('⚠️ Campo para link não encontrado');
    return;
  }

  await inputs[0].click();
  await page.keyboard.type(link, { delay: 50 });

  if (linkText && inputs[1]) {
    await inputs[1].click();
    await page.keyboard.type(linkText, { delay: 50 });
  }

  await delay(1000);

  await clickByText(page, ['done', 'save', 'add', 'concluir', 'salvar', 'adicionar']);

  console.log('✅ Link preenchido');
}

async function postStoryToInstagram(page, post) {
  console.log('📱 PUBLICANDO STORY VIA INSSIST');

  const mediaPath = path.resolve(__dirname, '../../uploads', post.media);

  await page.goto('https://www.instagram.com/', {
    waitUntil: 'networkidle2',
  });

  await delay(8000);

  await closeInssistIntro(page);

  const openedPublisher = await clickPublishStories(page);

  if (!openedPublisher) {
    const bodyText = await page.evaluate(() => document.body.innerText);
    console.log('TELA INSSIST:', bodyText.slice(0, 1500));
    throw new Error('Botão Publish stories da INSSIST não encontrado');
  }

  await delay(5000);

  const input = await waitForUploadInput(page);

  if (!input) {
    const bodyText = await page.evaluate(() => document.body.innerText);
    console.log('TELA UPLOAD INSSIST:', bodyText.slice(0, 1500));
    throw new Error('Input de upload da INSSIST não encontrado');
  }

  await input.uploadFile(mediaPath);

  console.log('📤 Mídia enviada para Story');

  await delay(8000);

  await tryAddStoryLink(page, post);

  await delay(3000);

  const published = await clickByText(page, [
    'publish',
    'publish story',
    'publish stories',
    'post story',
    'share',
    'send',
    'publicar',
    'publicar story',
    'compartilhar',
    'enviar',
  ]);

  if (!published) {
    const bodyText = await page.evaluate(() => document.body.innerText);
    console.log('TELA PUBLICAR INSSIST:', bodyText.slice(0, 1500));
    throw new Error('Botão publicar Story da INSSIST não encontrado');
  }

  console.log('🚀 STORY PUBLICADO VIA INSSIST');

  await delay(30000);
}

module.exports = postStoryToInstagram;
