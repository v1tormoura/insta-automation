'use strict';

/**
 * Configuração do Jest.
 *
 * `setupFiles` roda em cada worker antes dos testes e é onde o fuso é fixado
 * (ver tests/setup.env.js). Janela de horário, dias da semana e cálculo do
 * próximo horário do planner são feitos em horário local — sem fixar o fuso, os
 * testes de agendamento passariam na máquina do desenvolvedor e falhariam num
 * CI rodando em UTC.
 */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  setupFiles: ['<rootDir>/tests/setup.env.js'],
};
