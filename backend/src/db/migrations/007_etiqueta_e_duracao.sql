-- Comparativo de conteúdo: cada envio ganha uma etiqueta ("Original",
-- "Repost", um tema...) e o painel compara alcance e retenção por etiqueta.
alter table jobs  add column if not exists rotulo text not null default '';
-- Duração do vídeo publicado: a retenção em % (tempo médio assistido ÷ duração)
-- precisa dela, e a Graph não devolve a duração da mídia.
alter table posts add column if not exists duracao_ms integer;
