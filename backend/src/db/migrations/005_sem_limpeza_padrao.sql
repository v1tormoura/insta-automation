-- O padrão do modo de processamento passa a ser o arquivo original
-- (`sem_limpeza`). Só vale para linhas novas sem modo; o que cada envio já
-- escolheu continua como está.
alter table jobs  alter column process_mode set default 'sem_limpeza';
alter table posts alter column process_mode set default 'sem_limpeza';

-- Envios ainda ativos com o padrão antigo (`limpeza_leve`) passam ao original.
-- Esse padrão nunca foi aplicado de verdade: o servidor trocava por
-- `humanizador` em silêncio. Quem escolheu ultra_clean/humanizador fica como está.
update jobs set process_mode = 'sem_limpeza'
 where process_mode = 'limpeza_leve'
   and status in ('queued', 'running', 'waiting_interval', 'paused');
update posts set process_mode = 'sem_limpeza'
 where process_mode = 'limpeza_leve'
   and status in ('pendente', 'agendado', 'processando');
