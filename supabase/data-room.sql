-- ---------------------------------------------------------------------
-- 9. DATA ROOM : fichiers et liens partagés avec tous les membres
--    - tout membre actif consulte et télécharge
--    - les responsables et les admins déposent, remplacent, retirent
-- ---------------------------------------------------------------------

create table if not exists public.documents (
  id          uuid primary key default gen_random_uuid(),
  titre       text not null check (length(trim(titre)) > 0),
  description text,
  genre       text not null check (genre in ('fichier', 'lien')),
  url         text,          -- lien vers un document en ligne (Excel Online, Google Sheets…)
  chemin      text,          -- emplacement du fichier dans le stockage Supabase
  nom_fichier text,
  taille      bigint,
  ajoute_par  uuid references public.profils (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint documents_contenu check (
    (genre = 'lien'    and url ~* '^https?://' and chemin is null)
    or (genre = 'fichier' and chemin is not null and nom_fichier is not null and url is null))
);

create or replace function public.peut_deposer() returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from profils where id = auth.uid() and actif and role in ('admin', 'responsable')) $$;

create or replace function public.documents_avant() returns trigger
language plpgsql security definer set search_path = public as
$$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.ajoute_par := auth.uid();
      new.created_at := now();
    end if;
  else
    new.id         := old.id;
    new.created_at := old.created_at;
    new.genre      := old.genre;
  end if;
  new.updated_at := now();
  return new;
end
$$;

drop trigger if exists documents_avant on public.documents;
create trigger documents_avant before insert or update on public.documents
  for each row execute function public.documents_avant();

alter table public.documents enable row level security;

drop policy if exists documents_lecture on public.documents;
create policy documents_lecture on public.documents for select to authenticated
  using (est_actif());
drop policy if exists documents_ajout on public.documents;
create policy documents_ajout on public.documents for insert to authenticated
  with check (peut_deposer());
drop policy if exists documents_maj on public.documents;
create policy documents_maj on public.documents for update to authenticated
  using (peut_deposer()) with check (peut_deposer());
drop policy if exists documents_retrait on public.documents;
create policy documents_retrait on public.documents for delete to authenticated
  using (peut_deposer());

revoke all on public.documents from anon;
grant select, insert, update, delete on public.documents to authenticated;
revoke execute on function public.documents_avant() from public, anon, authenticated;
revoke execute on function public.peut_deposer() from public, anon;
grant execute on function public.peut_deposer() to authenticated;

-- Stockage des fichiers : espace privé « data-room » (50 Mo par fichier)
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('data-room', 'data-room', false, 52428800)
    on conflict (id) do nothing;

    execute 'drop policy if exists data_room_lecture on storage.objects';
    execute 'create policy data_room_lecture on storage.objects for select to authenticated
             using (bucket_id = ''data-room'' and public.est_actif())';
    execute 'drop policy if exists data_room_depot on storage.objects';
    execute 'create policy data_room_depot on storage.objects for insert to authenticated
             with check (bucket_id = ''data-room'' and public.peut_deposer())';
    execute 'drop policy if exists data_room_retrait on storage.objects';
    execute 'create policy data_room_retrait on storage.objects for delete to authenticated
             using (bucket_id = ''data-room'' and public.peut_deposer())';
  end if;

  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'documents') then
    alter publication supabase_realtime add table public.documents;
  end if;
end $$;

notify pgrst, 'reload schema';
