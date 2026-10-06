'use strict';

/** Rota de backups: lista só os arquivos do ./backup.sh e lê o status. */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bkp-'));
process.env.BACKUP_DIR = dir;
const { router } = require('../src/routes/backupsRoutes');

let srv, base;
beforeAll(() => {
  fs.writeFileSync(path.join(dir, 'banco-2026-10-06_0315.sql.gz'), 'x');
  fs.writeFileSync(path.join(dir, 'midias-2026-10-06_0315.tgz'), 'yy');
  fs.writeFileSync(path.join(dir, '.env'), 'segredo');
  fs.writeFileSync(path.join(dir, 'ultimo.json'), JSON.stringify({ quando: '2026-10-06T03:15:00Z', ok: true, manter: 7 }));
  const app = require('express')(); app.use(router);
  srv = http.createServer(app).listen(0); base = `http://127.0.0.1:${srv.address().port}`;
});
afterAll(() => { srv.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('lista os backups e o último status', async () => {
  const r = await (await fetch(`${base}/`)).json();
  expect(r.ultimo).toMatchObject({ ok: true, manter: 7 });
  expect(r.arquivos.map(a => a.tipo).sort()).toEqual(['banco', 'midias']);
});

test('baixa só arquivo de backup — nada fora do padrão', async () => {
  expect((await fetch(`${base}/banco-2026-10-06_0315.sql.gz`)).status).toBe(200);
  expect((await fetch(`${base}/.env`)).status).toBe(400);
  expect((await fetch(`${base}/..%2F..%2Fetc%2Fpasswd`)).status).toBe(400);
});
