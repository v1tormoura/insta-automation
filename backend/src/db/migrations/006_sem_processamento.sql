-- Saem as três funções de processamento do painel: modo de processamento
-- (limpeza/humanizador), variação de edição por conta e trilha de áudio.
-- O vídeo passa a ir como foi enviado (convertido só se o formato não servir).
alter table jobs  drop column if exists process_mode;
alter table jobs  drop column if exists variacao_edicao;
alter table jobs  drop column if exists trilha;
alter table posts drop column if exists process_mode;
alter table posts drop column if exists variacao_edicao;
alter table posts drop column if exists trilha;
drop table if exists trilhas;
