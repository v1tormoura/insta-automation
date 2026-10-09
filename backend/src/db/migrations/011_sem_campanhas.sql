-- A função Campanha saiu do produto: as tabelas e o gatilho de dono vão junto.
drop table if exists campaign_events;
drop table if exists campaign_publications;
drop table if exists campaigns;
drop function if exists dono_pela_campanha();
