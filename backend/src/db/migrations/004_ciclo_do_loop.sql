-- A volta do Loop entra na chave do post da rodada.
--
-- A chave era (envio, mídia, rodada). No Loop a rodada recomeça em 0 a cada
-- volta, então a segunda volta achava o post da primeira — com as contas já
-- marcadas como publicadas — e não publicava nada, sem erro nenhum.
alter table jobs  add column if not exists ciclo     integer not null default 0;
alter table posts add column if not exists job_ciclo integer not null default 0;

drop index if exists posts_rodada_key;
create unique index posts_rodada_key on posts (job_id, job_ciclo, media, job_round) where job_id is not null;
