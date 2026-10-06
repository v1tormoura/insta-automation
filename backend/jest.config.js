'use strict';

/**
 * Configuração do Jest.
 *
 * `setupFiles` roda em cada worker antes dos testes e é onde o fuso é fixado
 * (ver tests/setup.env.js). Janela de horário, dias da semana e cálculo do
 * próximo horário do planner são feitos em horário local — sem fixar o fuso, os
 * testes de agendamento passariam na máquina do desenvolvedor e falhariam num
 * CI rodando em UTC.
 *
 * O fuso também é fixado AQUI, no processo principal: dentro da caixa do Jest
 * o `process.env` é uma cópia, e mudar o TZ nela não avisa o Node — as datas
 * continuavam no fuso da máquina. Com --runInBand os testes rodam neste
 * processo, então esta linha é a que vale.
 */
process.env.TZ = 'America/Sao_Paulo';

module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  setupFiles: ['<rootDir>/tests/setup.env.js'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.after.js'],
  globalSetup: '<rootDir>/tests/globalSetup.js',
  // Os testes de banco compartilham o mesmo Postgres: um arquivo por vez.
  maxWorkers: 1,
};
