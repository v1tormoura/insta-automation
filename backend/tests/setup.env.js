'use strict';

/**
 * Fixa o fuso ANTES de qualquer teste rodar, em cada worker do Jest.
 *
 * Definir isto só no jest.config.js não basta: os workers são processos
 * separados e a atribuição no config não os alcança de forma confiável. Como
 * janela de horário e dias da semana do planner são calculados em horário
 * local, sem isto os testes de agendamento passariam localmente e falhariam num
 * CI em UTC.
 */
process.env.TZ = 'America/Sao_Paulo';

/* O cliente do Postgres só conecta na primeira consulta: os testes de lógica
   pura carregam os módulos sem banco. Os que consultam usam este banco de
   teste (TEST_DATABASE_URL para apontar outro). */
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:54329/insta_test';
process.env.JEST = '1';
