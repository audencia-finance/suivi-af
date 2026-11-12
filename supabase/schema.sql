-- =====================================================================
-- Suivi AF — base de données Supabase
-- À exécuter une seule fois dans Supabase : SQL Editor > New query > Run
-- (le script peut être relancé sans risque : il ne supprime aucune donnée)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. TABLES
-- ---------------------------------------------------------------------

-- Réglages de l'association (une seule ligne)
create table if not exists public.parametres (
  id            int primary key default 1 check (id = 1),
  nom_asso      text  not null default 'Audencia Finance',
  poles         jsonb not null default '["Marchés financiers","Corporate finance","Bureau"]',
  sous_poles    jsonb not null default '["Expertise","Event","Merch","Communication"]',
  types_mission jsonb not null default '["Étude / analyse","Événement","Partenariat","Communication","Merch","Formation","Organisation interne","Autre"]',
  tolerance     int   not null default 10 check (tolerance between 0 and 50),   -- écart toléré (points de %) autour du rythme attendu
  jours_alerte  int   not null default 7  check (jours_alerte between 1 and 60), -- alerte « échéance proche »
  jours_inactif int   not null default 7  check (jours_inactif between 1 and 60),-- alerte « pas de mise à jour »
  agenda_token  text  not null default replace(gen_random_uuid()::text, '-', '')
);
insert into public.parametres (id) values (1) on conflict (id) do nothing;

-- Un profil par compte (créé automatiquement à l'inscription)
create table if not exists public.profils (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text not null unique,
  prenom     text not null,
  nom        text not null default '',
  pole       text,          -- vide = tous les pôles (bureau)
  sous_pole  text,          -- vide = tout le pôle
  poste      text,          -- intitulé libre : Président, VP, Responsable Event, Membre…
  role       text not null default 'membre' check (role in ('admin', 'responsable', 'membre')),
  actif      boolean not null default true,
  created_at timestamptz not null default now()
);

-- Liste des personnes autorisées à créer un compte (les 30 membres)
create table if not exists public.invitations (
  email       text primary key check (email = lower(trim(email)) and position('@' in email) > 1),
  prenom      text not null,
  nom         text not null default '',
  pole        text,
  sous_pole   text,
  poste       text,
  role        text not null default 'membre' check (role in ('admin', 'responsable', 'membre')),
  code        text not null default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  utilisee_le timestamptz,
  created_at  timestamptz not null default now()
);

create table if not exists public.missions (
  id            uuid primary key default gen_random_uuid(),
  titre         text not null check (length(trim(titre)) > 0),
  description   text,
  type          text not null default 'Autre',
  pole          text not null,
  sous_pole     text,
  debut         date not null,
  fin           date not null,
  progression   int  not null default 0 check (progression between 0 and 100),
  statut        text not null default 'en_cours' check (statut in ('en_cours', 'a_valider', 'validee')),
  lien_livrable text,
  cree_par      uuid references public.profils (id) on delete set null,
  soumise_le    timestamptz,   -- date à laquelle la mission a été déclarée terminée
  valide_par    uuid references public.profils (id) on delete set null,
  valide_le     timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint missions_dates check (fin >= debut)
);

-- Qui travaille sur quelle mission (une ou plusieurs personnes)
create table if not exists public.mission_membres (
  mission_id uuid not null references public.missions (id) on delete cascade,
  profil_id  uuid not null references public.profils (id) on delete cascade,
  primary key (mission_id, profil_id)
);

-- Historique : chaque mise à jour, soumission, validation, renvoi, commentaire
create table if not exists public.journal (
  id          bigint generated always as identity primary key,
  mission_id  uuid not null references public.missions (id) on delete cascade,
  auteur      uuid references public.profils (id) on delete set null,
  type        text not null check (type in ('creation', 'progression', 'soumission', 'validation', 'renvoi', 'modification', 'commentaire')),
  progression int,
  message     text,
  created_at  timestamptz not null default now()
);

create index if not exists missions_fin_idx on public.missions (fin);
create index if not exists mission_membres_profil_idx on public.mission_membres (profil_id);
create index if not exists journal_mission_idx on public.journal (mission_id, created_at desc);
create index if not exists journal_date_idx on public.journal (created_at desc);

-- ---------------------------------------------------------------------
-- 2. FONCTIONS DE DROITS
-- ---------------------------------------------------------------------

create or replace function public.est_actif() returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from profils where id = auth.uid() and actif) $$;

create or replace function public.est_admin() returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from profils where id = auth.uid() and actif and role = 'admin') $$;

-- Un responsable contrôle son périmètre : tout son pôle (sous-pôle vide)
-- ou seulement son sous-pôle. Un admin contrôle tout.
create or replace function public.peut_controler(p_pole text, p_sous_pole text) returns boolean
language sql stable security definer set search_path = public as
$$
  select exists (
    select 1 from profils p
    where p.id = auth.uid() and p.actif
      and (
        p.role = 'admin'
        or (p.role = 'responsable'
            and (p.pole is null or p.pole = p_pole)
            and (p.sous_pole is null or p.sous_pole = p_sous_pole))
      )
  )
$$;

-- ---------------------------------------------------------------------
-- 3. INSCRIPTION : un compte ne se crée que sur invitation
--    (le tout premier compte créé devient administrateur)
-- ---------------------------------------------------------------------

create or replace function public.nouveau_compte() returns trigger
language plpgsql security definer set search_path = public as
$$
declare
  inv     public.invitations;
  v_email text := lower(trim(new.email));
  v_code  text := upper(trim(coalesce(new.raw_user_meta_data ->> 'code', '')));
begin
  if not exists (select 1 from profils) then
    insert into profils (id, email, prenom, nom, poste, role)
    values (new.id, v_email,
            coalesce(nullif(trim(new.raw_user_meta_data ->> 'prenom'), ''), 'Admin'),
            coalesce(trim(new.raw_user_meta_data ->> 'nom'), ''),
            'Administrateur du suivi', 'admin');
    return new;
  end if;

  select * into inv from invitations where email = v_email;
  if not found then
    raise exception 'Adresse e-mail non invitée';
  end if;
  if inv.code <> v_code then
    raise exception 'Code d''invitation incorrect';
  end if;

  insert into profils (id, email, prenom, nom, pole, sous_pole, poste, role)
  values (new.id, v_email, inv.prenom, inv.nom, inv.pole, inv.sous_pole, inv.poste, inv.role);
  update invitations set utilisee_le = now() where email = v_email;
  return new;
end
$$;

drop trigger if exists suivi_af_nouveau_compte on auth.users;
create trigger suivi_af_nouveau_compte
  after insert on auth.users
  for each row execute function public.nouveau_compte();

-- Vérification avant inscription, pour afficher un message clair
-- Retourne : 'premier' (aucun compte encore), 'ok', 'deja' (compte déjà créé) ou 'refus'
create or replace function public.verifier_invitation(p_email text, p_code text) returns text
language plpgsql stable security definer set search_path = public as
$$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
begin
  if not exists (select 1 from profils) then return 'premier'; end if;
  if exists (select 1 from profils where email = v_email) then return 'deja'; end if;
  if exists (select 1 from invitations
             where email = v_email and code = upper(trim(coalesce(p_code, '')))) then
    return 'ok';
  end if;
  return 'refus';
end
$$;

-- ---------------------------------------------------------------------
-- 4. RÈGLES MÉTIER SUR LES MISSIONS
--    - un membre met à jour l'avancement de SES missions, rien d'autre
--    - à 100 %, la mission passe « à valider »
--    - seul un responsable du périmètre (ou un admin) valide, renvoie,
--      modifie les dates ou supprime
--    - un responsable ne valide pas une mission qui lui est assignée
-- ---------------------------------------------------------------------

create or replace function public.missions_avant_insertion() returns trigger
language plpgsql security definer set search_path = public as
$$
begin
  if auth.uid() is not null then
    new.cree_par   := auth.uid();
    new.valide_par := null;
    new.valide_le  := null;
    new.statut     := case when new.progression >= 100 then 'a_valider' else 'en_cours' end;
    new.soumise_le := case when new.progression >= 100 then now() else null end;
    new.created_at := now();
  end if;
  new.updated_at := now();
  return new;
end
$$;

create or replace function public.missions_avant_maj() returns trigger
language plpgsql security definer set search_path = public as
$$
declare
  v_uid      uuid := auth.uid();
  v_controle boolean;
  v_assigne  boolean;
begin
  new.updated_at := now();
  if v_uid is null then
    return new;   -- SQL Editor / maintenance : pas de restriction
  end if;

  new.id         := old.id;
  new.cree_par   := old.cree_par;
  new.created_at := old.created_at;

  v_controle := peut_controler(old.pole, old.sous_pole);
  v_assigne  := exists (select 1 from mission_membres
                        where mission_id = old.id and profil_id = v_uid);

  if not v_controle then
    -- Membre : seulement ses missions, seulement l'avancement
    if not (v_assigne or old.cree_par = v_uid) then
      raise exception 'Vous ne participez pas à cette mission.' using errcode = '42501';
    end if;
    if old.statut = 'validee' then
      raise exception 'Mission validée : seul un responsable peut la rouvrir.' using errcode = '42501';
    end if;
    if (new.titre, new.type, new.pole, new.sous_pole, new.debut, new.fin)
       is distinct from (old.titre, old.type, old.pole, old.sous_pole, old.debut, old.fin) then
      raise exception 'Seul un responsable peut modifier le titre, le pôle ou les dates.' using errcode = '42501';
    end if;
    new.valide_par := null;
    new.valide_le  := null;
    new.statut     := case when new.progression >= 100 then 'a_valider' else 'en_cours' end;
  else
    -- Responsable du périmètre ou admin
    if (new.pole, new.sous_pole) is distinct from (old.pole, old.sous_pole)
       and not peut_controler(new.pole, new.sous_pole) then
      raise exception 'Vous ne pouvez pas déplacer la mission hors de votre périmètre.' using errcode = '42501';
    end if;
    if new.statut = 'validee' and (old.statut <> 'validee' or new.progression >= 100) then
      if old.statut <> 'validee' then
        if v_assigne and not est_admin() then
          raise exception 'Vous ne pouvez pas valider une mission qui vous est assignée.' using errcode = '42501';
        end if;
        new.valide_par := v_uid;
        new.valide_le  := now();
      else
        new.valide_par := old.valide_par;
        new.valide_le  := old.valide_le;
      end if;
      new.progression := 100;
    else
      new.valide_par := null;
      new.valide_le  := null;
      new.statut     := case when new.progression >= 100 then 'a_valider' else 'en_cours' end;
    end if;
  end if;

  -- Date de soumission : posée quand la mission atteint 100 %, effacée si elle est rouverte
  if new.progression >= 100 then
    new.soumise_le := coalesce(old.soumise_le, now());
  else
    new.soumise_le := null;
  end if;
  return new;
end
$$;

-- Historique automatique (infalsifiable côté navigateur)
create or replace function public.missions_journal() returns trigger
language plpgsql security definer set search_path = public as
$$
declare
  v_type text;
begin
  if tg_op = 'INSERT' then
    insert into journal (mission_id, auteur, type, progression)
    values (new.id, auth.uid(), 'creation', new.progression);
    return new;
  end if;

  if new.statut = 'validee' and old.statut <> 'validee' then
    v_type := 'validation';
  elsif old.statut in ('a_valider', 'validee') and new.statut = 'en_cours' then
    v_type := 'renvoi';
  elsif new.statut = 'a_valider' and old.statut <> 'a_valider' then
    v_type := 'soumission';
  elsif new.progression <> old.progression then
    v_type := 'progression';
  elsif (new.titre, new.description, new.type, new.pole, new.sous_pole, new.debut, new.fin, new.lien_livrable)
        is distinct from
        (old.titre, old.description, old.type, old.pole, old.sous_pole, old.debut, old.fin, old.lien_livrable) then
    v_type := 'modification';
  end if;

  if v_type is not null then
    insert into journal (mission_id, auteur, type, progression, message)
    values (new.id, auth.uid(), v_type, new.progression,
            case when v_type = 'modification' and (new.debut, new.fin) is distinct from (old.debut, old.fin)
                 then 'Dates : ' || to_char(new.debut, 'DD/MM/YYYY') || ' → ' || to_char(new.fin, 'DD/MM/YYYY')
            end);
  end if;
  return new;
end
$$;

drop trigger if exists missions_avant_insertion on public.missions;
create trigger missions_avant_insertion before insert on public.missions
  for each row execute function public.missions_avant_insertion();

drop trigger if exists missions_avant_maj on public.missions;
create trigger missions_avant_maj before update on public.missions
  for each row execute function public.missions_avant_maj();

drop trigger if exists missions_journal on public.missions;
create trigger missions_journal after insert or update on public.missions
  for each row execute function public.missions_journal();

-- Profils : l'e-mail et l'identifiant ne changent pas ; il reste toujours un admin
create or replace function public.profils_garde() returns trigger
language plpgsql security definer set search_path = public as
$$
begin
  if tg_op = 'UPDATE' then
    if new.id <> old.id or new.email <> old.email then
      raise exception 'L''identifiant et l''e-mail d''un compte ne se modifient pas.';
    end if;
  end if;
  if exists (select 1 from profils)
     and not exists (select 1 from profils where role = 'admin' and actif) then
    raise exception 'Il doit rester au moins un administrateur actif.';
  end if;
  return null;
end
$$;

drop trigger if exists profils_garde on public.profils;
create trigger profils_garde after update or delete on public.profils
  for each row execute function public.profils_garde();

-- ---------------------------------------------------------------------
-- 5. SÉCURITÉ (Row Level Security)
-- ---------------------------------------------------------------------

alter table public.parametres      enable row level security;
alter table public.profils         enable row level security;
alter table public.invitations     enable row level security;
alter table public.missions        enable row level security;
alter table public.mission_membres enable row level security;
alter table public.journal         enable row level security;

-- Paramètres : lecture par les membres, modification par les admins
drop policy if exists parametres_lecture on public.parametres;
create policy parametres_lecture on public.parametres for select to authenticated
  using (est_actif());
drop policy if exists parametres_maj on public.parametres;
create policy parametres_maj on public.parametres for update to authenticated
  using (est_admin()) with check (est_admin());

-- Profils : tout le monde voit l'équipe ; seuls les admins modifient rôles et postes
drop policy if exists profils_lecture on public.profils;
create policy profils_lecture on public.profils for select to authenticated
  using (id = auth.uid() or est_actif());
drop policy if exists profils_maj on public.profils;
create policy profils_maj on public.profils for update to authenticated
  using (est_admin()) with check (est_admin());

-- Invitations : réservées aux admins
drop policy if exists invitations_admin on public.invitations;
create policy invitations_admin on public.invitations for all to authenticated
  using (est_admin()) with check (est_admin());

-- Missions : visibles par tous les membres ; les règles fines sont dans les triggers
drop policy if exists missions_lecture on public.missions;
create policy missions_lecture on public.missions for select to authenticated
  using (est_actif());
drop policy if exists missions_creation on public.missions;
create policy missions_creation on public.missions for insert to authenticated
  with check (est_actif());
drop policy if exists missions_maj on public.missions;
create policy missions_maj on public.missions for update to authenticated
  using (est_actif() and (
           peut_controler(pole, sous_pole)
           or cree_par = auth.uid()
           or exists (select 1 from public.mission_membres mm
                      where mm.mission_id = missions.id and mm.profil_id = auth.uid())))
  with check (est_actif());
drop policy if exists missions_suppression on public.missions;
create policy missions_suppression on public.missions for delete to authenticated
  using (peut_controler(pole, sous_pole));

-- Assignations : gérées par le responsable du périmètre ou le créateur de la mission
drop policy if exists mission_membres_lecture on public.mission_membres;
create policy mission_membres_lecture on public.mission_membres for select to authenticated
  using (est_actif());
drop policy if exists mission_membres_ajout on public.mission_membres;
create policy mission_membres_ajout on public.mission_membres for insert to authenticated
  with check (exists (select 1 from public.missions m
                      where m.id = mission_id
                        and (peut_controler(m.pole, m.sous_pole)
                             or (m.cree_par = auth.uid() and m.statut <> 'validee'))));
drop policy if exists mission_membres_retrait on public.mission_membres;
create policy mission_membres_retrait on public.mission_membres for delete to authenticated
  using (exists (select 1 from public.missions m
                 where m.id = mission_id
                   and (peut_controler(m.pole, m.sous_pole)
                        or (m.cree_par = auth.uid() and m.statut <> 'validee'))));

-- Journal : lecture par tous ; on ne peut écrire que ses propres commentaires
drop policy if exists journal_lecture on public.journal;
create policy journal_lecture on public.journal for select to authenticated
  using (est_actif());
drop policy if exists journal_commentaire on public.journal;
create policy journal_commentaire on public.journal for insert to authenticated
  with check (est_actif() and type = 'commentaire' and auteur = auth.uid()
              and length(trim(coalesce(message, ''))) > 0);

-- ---------------------------------------------------------------------
-- 6. AGENDA : flux iCalendar (.ics) auquel Google Agenda peut s'abonner
--    URL : https://<projet>.supabase.co/rest/v1/rpc/agenda_ics?token=<agenda_token>&apikey=<clé publique>
-- ---------------------------------------------------------------------

do $$ begin
  create domain "*/*" as bytea;
exception when duplicate_object then null;
end $$;

create or replace function public.ics_echap(t text) returns text
language sql immutable set search_path = public as
$$ select replace(replace(replace(replace(replace(coalesce(t, ''), '\', '\\'), ';', '\;'), ',', '\,'), E'\r', ''), E'\n', '\n') $$;

-- (le paramètre apikey est ignoré : il est seulement toléré dans l'URL)
create or replace function public.agenda_ics(token text, apikey text default null) returns "*/*"
language plpgsql stable security definer set search_path = public as
$$
declare
  nl  constant text := E'\r\n';
  v   text;
  r   record;
  nom text;
begin
  if token is null or not exists (select 1 from parametres p where p.agenda_token = token) then
    raise sqlstate 'PT403' using message = 'Lien agenda invalide';
  end if;
  select nom_asso into nom from parametres where id = 1;

  perform set_config('response.headers',
    '[{"Content-Type": "text/calendar; charset=utf-8"}, {"Cache-Control": "no-cache"}]', true);

  v := 'BEGIN:VCALENDAR' || nl || 'VERSION:2.0' || nl || 'PRODID:-//Suivi AF//FR' || nl
    || 'CALSCALE:GREGORIAN' || nl || 'METHOD:PUBLISH' || nl
    || 'X-WR-CALNAME:' || ics_echap(nom || ' – Échéances') || nl
    || 'X-WR-TIMEZONE:Europe/Paris' || nl;

  for r in
    select m.*,
           (select string_agg(trim(p.prenom || ' ' || p.nom), ', ' order by p.nom, p.prenom)
              from mission_membres mm join profils p on p.id = mm.profil_id
             where mm.mission_id = m.id) as equipe
      from missions m
     order by m.fin, m.titre
  loop
    v := v || 'BEGIN:VEVENT' || nl
      || 'UID:' || r.id || '@suivi-af' || nl
      || 'DTSTAMP:' || to_char(r.updated_at at time zone 'UTC', 'YYYYMMDD"T"HH24MISS"Z"') || nl
      || 'DTSTART;VALUE=DATE:' || to_char(r.fin, 'YYYYMMDD') || nl
      || 'DTEND;VALUE=DATE:' || to_char(r.fin + 1, 'YYYYMMDD') || nl
      || 'SUMMARY:' || ics_echap(
           case when r.statut = 'validee' then '✅ ' else '' end
           || 'Échéance – ' || r.titre || ' (' || r.pole || ')') || nl
      || 'DESCRIPTION:' || ics_echap(
           'Type : ' || r.type
           || E'\nPôle : ' || r.pole || coalesce(' / ' || r.sous_pole, '')
           || E'\nÉquipe : ' || coalesce(r.equipe, 'non assignée')
           || E'\nAvancement : ' || r.progression || ' %'
           || E'\nStatut : ' || case r.statut when 'validee' then 'validée'
                                              when 'a_valider' then 'à valider'
                                              else 'en cours' end) || nl
      || 'TRANSP:TRANSPARENT' || nl
      || 'END:VEVENT' || nl;
  end loop;

  v := v || 'END:VCALENDAR' || nl;
  return convert_to(v, 'UTF8');
end
$$;

-- ---------------------------------------------------------------------
-- 7. DROITS D'ACCÈS À L'API
-- ---------------------------------------------------------------------

grant usage on schema public to anon, authenticated;

revoke all on public.parametres, public.profils, public.invitations,
              public.missions, public.mission_membres, public.journal from anon;

grant select, update                 on public.parametres      to authenticated;
grant select, update                 on public.profils         to authenticated;
grant select, insert, update, delete on public.invitations     to authenticated;
grant select, insert, update, delete on public.missions        to authenticated;
grant select, insert, delete         on public.mission_membres to authenticated;
grant select, insert                 on public.journal         to authenticated;

revoke execute on function public.nouveau_compte()            from public, anon, authenticated;
revoke execute on function public.missions_avant_insertion()  from public, anon, authenticated;
revoke execute on function public.missions_avant_maj()        from public, anon, authenticated;
revoke execute on function public.missions_journal()          from public, anon, authenticated;
revoke execute on function public.profils_garde()             from public, anon, authenticated;

revoke execute on function public.est_actif()                     from public, anon;
revoke execute on function public.est_admin()                     from public, anon;
revoke execute on function public.peut_controler(text, text)      from public, anon;
grant execute on function public.est_actif()                       to authenticated;
grant execute on function public.est_admin()                       to authenticated;
grant execute on function public.peut_controler(text, text)        to authenticated;
grant execute on function public.verifier_invitation(text, text)   to anon, authenticated;
grant execute on function public.agenda_ics(text, text)            to anon, authenticated;
grant execute on function public.ics_echap(text)                   to anon, authenticated;

-- ---------------------------------------------------------------------
-- 8. TEMPS RÉEL : les changements sont poussés aux navigateurs ouverts
-- ---------------------------------------------------------------------

do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['missions', 'mission_membres', 'journal', 'profils', 'parametres'] loop
      if not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- Recharge le cache de l'API
notify pgrst, 'reload schema';
