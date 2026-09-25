'use strict';

/* Fecha a conexão com o banco no fim de cada arquivo de teste — sem isso o
   Jest espera o pool ficar ocioso para encerrar. */
afterAll(async () => {
  await require('../src/db').sql.end({ timeout: 1 });
});
