-- Multiusuário: cadastro com aprovação do admin e dados isolados por usuário.
--
--   * `usuarios` deixa de ter uma linha só. A linha `chave = 'principal'` é o
--     admin (entra com AUTH_USERNAME/AUTH_PASSWORD); as demais nascem do
--     cadastro, como 'pendente', e só entram depois de aprovadas.
--   * Toda tabela com dado de alguém ganha `usuario_id`. O que já existia vai
--     para o admin.
--   * Tabelas-filhas herdam o dono do pai por gatilho (insights da conta,
--     publicação da campanha…): quem grava pelo worker não precisa saber de
--     usuário, e não existe linha sem dono (`not null`).
--   * Globais, geridos pelo admin: meta_apps, settings, queue_jobs.
--   * convites_de_acesso: o @ que pede para virar testador do app. Quem pediu
--     fica registrado (usuario_id); o admin vê todos e convida na Meta.

-- ── Usuários ────────────────────────────────────────────────────────────────
alter table usuarios alter column chave drop not null;
alter table usuarios alter column chave drop default;
alter table usuarios
  add column papel        text not null default 'usuario' check (papel in ('admin', 'usuario')),
  add column status       text not null default 'pendente' check (status in ('pendente', 'ativo', 'bloqueado', 'recusado')),
  add column aprovado_em  timestamptz,
  add column ultimo_login timestamptz;

insert into usuarios (chave, nome) values ('principal', 'Administrador') on conflict (chave) do nothing;
update usuarios set papel = 'admin', status = 'ativo', aprovado_em = coalesce(aprovado_em, now()) where chave = 'principal';

create unique index usuarios_email_key on usuarios (lower(email)) where email <> '';
create index usuarios_status_idx on usuarios (status, created_at desc);

-- ── Dono em cada tabela ─────────────────────────────────────────────────────
do $$
declare
  t text;
  admin uuid := (select id from usuarios where chave = 'principal');
begin
  foreach t in array array[
    'accounts', 'media', 'legends', 'trilhas', 'jobs', 'posts', 'campaigns',
    'campaign_publications', 'campaign_events', 'insights', 'seguidores_do_dia',
    'milestones', 'notificacoes', 'push_subscriptions'
  ] loop
    execute format('alter table %I add column usuario_id uuid references usuarios(id) on delete cascade', t);
    execute format('update %I set usuario_id = $1', t) using admin;
    execute format('alter table %I alter column usuario_id set not null', t);
    execute format('create index %I on %I (usuario_id)', t || '_usuario_idx', t);
  end loop;
end $$;

alter table convites_de_acesso add column usuario_id uuid references usuarios(id) on delete cascade;
update convites_de_acesso set usuario_id = (select id from usuarios where chave = 'principal');

-- ── Herança do dono ─────────────────────────────────────────────────────────
create or replace function dono_pela_conta() returns trigger as $$
begin
  if new.usuario_id is null and new.account_id is not null then
    select usuario_id into new.usuario_id from accounts where id = new.account_id;
  end if;
  return new;
end;
$$ language plpgsql;

create or replace function dono_pela_campanha() returns trigger as $$
begin
  if new.usuario_id is null then
    select usuario_id into new.usuario_id from campaigns where id = new.campaign_id;
  end if;
  return new;
end;
$$ language plpgsql;

-- Post de envio herda do envio; post avulso (campanha, story), da conta.
create or replace function dono_do_post() returns trigger as $$
begin
  if new.usuario_id is null and new.job_id is not null then
    select usuario_id into new.usuario_id from jobs where id = new.job_id;
  end if;
  if new.usuario_id is null and cardinality(new.account_ids) > 0 then
    select usuario_id into new.usuario_id from accounts where id = new.account_ids[1];
  end if;
  return new;
end;
$$ language plpgsql;

create trigger insights_dono           before insert on insights              for each row execute function dono_pela_conta();
create trigger seguidores_do_dia_dono  before insert on seguidores_do_dia     for each row execute function dono_pela_conta();
create trigger milestones_dono         before insert on milestones            for each row execute function dono_pela_conta();
create trigger notificacoes_dono       before insert on notificacoes          for each row execute function dono_pela_conta();
create trigger campaign_publications_dono before insert on campaign_publications for each row execute function dono_pela_campanha();
create trigger campaign_events_dono    before insert on campaign_events       for each row execute function dono_pela_campanha();
create trigger posts_dono              before insert on posts                 for each row execute function dono_do_post();
