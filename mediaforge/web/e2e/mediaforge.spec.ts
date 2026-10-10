import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { fx } from '../../server/tests/helpers/fixtures';

const sha256 = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

async function freshSession(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('dropzone')).toBeVisible();
  // Cada teste começa numa sessão nova e vazia.
  await page.getByTestId('new-session').click();
  await page.getByTestId('confirm-new-session').click();
  await expect(page.getByText('Nenhum arquivo importado')).toBeVisible();
}

async function importFiles(page: Page, files: string[], expectedItems: number) {
  await page.getByTestId('file-input').setInputFiles(files);
  await expect(page.getByTestId('asset-item')).toHaveCount(expectedItems, { timeout: 90_000 });
}

test.describe('MediaForge — fluxos completos pela interface', () => {
  test('importa, recusa inválido, limpa metadados (modo rápido), baixa e confere integridade', async ({ page }) => {
    await freshSession(page);
    await importFiles(page, [fx('iphone.mov'), fx('photo.jpg'), fx('fake.mp4')], 3);

    const fake = page.locator('[data-asset-name="fake.mp4"]');
    await expect(fake.getByText('Inválido')).toBeVisible();
    await expect(page.locator('[data-asset-name="iphone.mov"]').getByText('GPS')).toBeVisible();

    // Detalhes: metadados sensíveis ficam ocultos até revelar
    await page.locator('[data-asset-name="iphone.mov"]').getByRole('button', { name: 'Detalhes e metadados' }).click();
    const detail = page.getByTestId('asset-detail');
    await expect(detail.getByText('GPS e localização').first()).toBeVisible();
    await expect(detail.getByText('iPhone 14 Pro')).toHaveCount(0);
    await detail.getByRole('button', { name: 'Revelar valores' }).click();
    await expect(detail.getByText('iPhone 14 Pro').first()).toBeVisible();
    await page.keyboard.press('Escape');

    await expect(page.getByTestId('output-count')).toContainText('= 2 saída(s)');
    await page.getByTestId('process-btn').click();
    await expect(page.getByTestId('result-card')).toHaveCount(2, { timeout: 120_000 });

    // Download individual: o arquivo baixado tem o SHA-256 registrado pelo servidor
    const card = page.locator('[data-testid="result-card"][data-name$=".mov"]');
    const [download] = await Promise.all([page.waitForEvent('download'), card.getByTestId('download-btn').click()]);
    const file = await download.path();
    const jobs = await (await page.request.get('/api/jobs')).json();
    const mov = jobs.find((j: { output?: { name: string } }) => j.output?.name.endsWith('.mov'));
    expect(download.suggestedFilename()).toBe(mov.output.name);
    expect(sha256(file!)).toBe(mov.output.sha256);
    // E não contém mais o modelo do aparelho nem o GPS
    const bytes = fs.readFileSync(file!).toString('latin1');
    expect(bytes).not.toContain('iPhone 14 Pro');
    expect(bytes).not.toContain('+37.7749-122.4194');

    // Relatório: remoção comprovada, cópia de fluxos e nota de integridade
    await card.getByTestId('report-btn').click();
    const report = page.getByTestId('report-drawer');
    await expect(report.getByText('Remoção comprovada')).toBeVisible();
    await expect(report.getByText('Cópia de fluxos (sem recodificar)')).toBeVisible();
    await report.getByRole('radio', { name: 'Integridade' }).click();
    await expect(report.getByText('Integridade técnica ≠ similaridade de conteúdo.')).toBeVisible();
    await page.keyboard.press('Escape');

    // Histórico registra importação, recusa e conclusão
    const history = page.getByTestId('history');
    await expect(history.getByText(/Arquivo recusado: fake\.mp4/)).toBeVisible();
    await expect(history.getByText(/Concluída: iphone\.mov/)).toBeVisible();
  });

  test('modo personalizado: valida o plano, pré-visualiza e gera 9:16 em 720 p', async ({ page }) => {
    await freshSession(page);
    await importFiles(page, [fx('plain.mp4')], 1);
    await page.getByTestId('mode-custom').click();
    await page.getByTestId('tab-enquadramento').click();
    await page.getByTestId('aspect').getByRole('radio', { name: '9:16' }).click();
    await page.getByTestId('resolution').selectOption('720');

    await page.getByTestId('validate-btn').click();
    const plan = page.getByTestId('plan-dialog');
    await expect(plan.getByTestId('plan-job')).toContainText('720×1280');
    await expect(plan.getByText('Reenquadramento')).toBeVisible();
    await page.keyboard.press('Escape');

    await page.getByTestId('preview-btn').click();
    const preview = page.getByTestId('preview-dialog');
    const media = preview.getByTestId('preview-media');
    await expect(media).toBeVisible({ timeout: 60_000 });
    await expect.poll(async () => media.evaluate((v: HTMLVideoElement) => (v.videoWidth ? `${v.videoWidth}x${v.videoHeight}` : '')), { timeout: 30_000 }).toBe('360x640');
    await page.keyboard.press('Escape');

    await page.getByTestId('process-btn').click();
    const card = page.getByTestId('result-card');
    await expect(card).toHaveCount(1, { timeout: 120_000 });
    await expect(card).toContainText('720×1280');
  });

  test('modo editorial com texto próprio e exportação ZIP com relatórios', async ({ page }) => {
    await freshSession(page);
    await importFiles(page, [fx('plain.mp4'), fx('logo.png')], 2);
    // Processa só o vídeo; o logotipo é recurso
    await page.locator('[data-asset-name="logo.png"]').getByTestId('asset-select').uncheck();
    await page.getByTestId('mode-editorial').click();
    await page.getByTestId('tab-editorial').click();
    await page.getByTestId('add-text').click();
    await page.getByTestId('text-0').fill('Versão editorial: 100% própria');
    await page.getByRole('button', { name: 'Adicionar elemento' }).click();
    await page.getByRole('combobox').filter({ hasText: 'Selecione um arquivo' }).first().selectOption({ label: 'logo.png (imagem)' });

    await page.getByTestId('process-btn').click();
    await expect(page.getByTestId('result-card')).toHaveCount(1, { timeout: 120_000 });

    await page.getByTestId('report-btn').click();
    const report = page.getByTestId('report-drawer');
    await report.getByRole('radio', { name: 'Transformações' }).click();
    await expect(report.getByText('Texto sobreposto')).toBeVisible();
    await expect(report.getByText('Elemento gráfico')).toBeVisible();
    await page.keyboard.press('Escape');

    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-all').click()]);
    expect(download.suggestedFilename()).toMatch(/^mediaforge-.*\.zip$/);
    const zip = fs.readFileSync((await download.path())!);
    expect(zip.subarray(0, 2).toString()).toBe('PK');
    const listing = zip.toString('latin1');
    for (const name of ['RELATORIO.txt', 'relatorio.json', 'SHA256SUMS.txt', '/videos/', '/relatorios/']) expect(listing).toContain(name);
  });

  test('fila: concorrência ajustável e cancelamento de tarefa em execução', async ({ page }) => {
    await freshSession(page);
    await importFiles(page, [fx('long.mp4')], 1);
    // Concorrência 1
    while ((await page.getByTestId('concurrency').textContent()) !== '1') await page.getByRole('button', { name: 'Diminuir' }).click();
    await page.getByTestId('mode-custom').click();
    await page.getByTestId('tab-saida').click();
    await page.getByTestId('video-codec').selectOption('hevc');
    await page.getByTestId('process-btn').click();

    const row = page.getByTestId('job-row').first();
    await expect(row).toHaveAttribute('data-status', 'running', { timeout: 30_000 });
    await row.getByTestId('job-cancel').click();
    await expect(row).toHaveAttribute('data-status', 'canceled', { timeout: 30_000 });
    await expect(page.getByTestId('result-card')).toHaveCount(0);

    // Repetir funciona e conclui
    await row.getByTestId('job-retry').click();
    await expect(row).toHaveAttribute('data-status', /running|queued/);
    await row.getByTestId('job-cancel').click();
    await expect(row).toHaveAttribute('data-status', 'canceled', { timeout: 30_000 });
  });

  test('sessões isoladas: outro navegador não vê arquivos nem resultados', async ({ page, browser }) => {
    await freshSession(page);
    await importFiles(page, [fx('photo.jpg')], 1);
    const other = await browser.newContext();
    const p2 = await other.newPage();
    await p2.goto('/');
    await expect(p2.getByText('Nenhum arquivo importado')).toBeVisible();
    const assets = await (await page.request.get('/api/assets')).json();
    const res = await p2.request.get(`/api/assets/${assets[0].id}/file`);
    expect(res.status()).toBe(404);
    await other.close();
  });

  test('layout responsivo sem rolagem horizontal no celular', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.getByTestId('dropzone')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
