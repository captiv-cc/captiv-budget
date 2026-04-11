-- ============================================================
-- CAPTIV BUDGET — Schéma Supabase
-- Coller dans : Supabase → SQL Editor → New query → Run
-- ============================================================

-- Extensions
create extension if not exists "uuid-ossp";

-- ── Organisations ─────────────────────────────────────────
create table if not exists organisations (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  siret       text,
  tva_number  text,
  address     text,
  email       text,
  phone       text,
  logo_url    text,
  created_at  timestamptz default now()
);

-- ── Profiles (étend auth.users) ───────────────────────────
create table if not exists profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  org_id      uuid references organisations(id),
  full_name   text,
  role        text default 'editor' check (role in ('admin','editor','viewer')),
  created_at  timestamptz default now()
);

-- Auto-create profile on signup
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into profiles (id, full_name)
  values (new.id, new.raw_user_meta_data->>'full_name');
  return new;
end;
$$ language plpgsql security definer;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- ── Clients ───────────────────────────────────────────────
create table if not exists clients (
  id            uuid primary key default uuid_generate_v4(),
  org_id        uuid references organisations(id) not null,
  name          text not null,
  contact_name  text,
  email         text,
  phone         text,
  address       text,
  siret         text,
  tva_number    text,
  notes         text,
  created_at    timestamptz default now()
);

-- ── Projets ───────────────────────────────────────────────
create table if not exists projects (
  id          uuid primary key default uuid_generate_v4(),
  org_id      uuid references organisations(id) not null,
  client_id   uuid references clients(id) on delete set null,
  title       text not null,
  description text,
  status      text default 'en_cours' check (status in ('prospect','en_cours','termine','annule')),
  date_debut  date,
  date_fin    date,
  created_by  uuid references profiles(id) on delete set null,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- ── Devis ─────────────────────────────────────────────────
create table if not exists devis (
  id             uuid primary key default uuid_generate_v4(),
  project_id     uuid references projects(id) on delete cascade not null,
  version_number integer not null default 1,
  title          text,
  status         text default 'brouillon' check (status in ('brouillon','envoye','accepte','refuse')),
  tva_rate       numeric default 20,
  acompte_pct    numeric default 30,
  notes          text,
  public_token   uuid default uuid_generate_v4() unique,
  created_by     uuid references profiles(id) on delete set null,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now(),
  unique(project_id, version_number)
);

-- ── Catégories de devis ───────────────────────────────────
create table if not exists devis_categories (
  id         uuid primary key default uuid_generate_v4(),
  devis_id   uuid references devis(id) on delete cascade not null,
  name       text not null,
  sort_order integer default 0
);

-- ── Lignes de devis ───────────────────────────────────────
create table if not exists devis_lines (
  id               uuid primary key default uuid_generate_v4(),
  devis_id         uuid references devis(id) on delete cascade not null,
  category_id      uuid references devis_categories(id) on delete set null,
  ref              text,
  produit          text,
  description      text,
  regime           text default 'Prestation facturée'
                   check (regime in (
                     'Intermittent Technicien','Intermittent Artiste',
                     'Salarié CDD','Auto-entrepreneur','Prestation facturée'
                   )),
  use_line         boolean default true,
  interne          boolean default false,
  cout_egal_vente  boolean default false,
  dans_marge       boolean default true,
  quantite         numeric default 1,
  unite            text default 'F',
  tarif_ht         numeric default 0,
  remise_pct       numeric default 0,
  sort_order       integer default 0
);

-- ── Budget réel ───────────────────────────────────────────
create table if not exists budget_reel (
  id              uuid primary key default uuid_generate_v4(),
  project_id      uuid references projects(id) on delete cascade not null,
  devis_line_id   uuid references devis_lines(id) on delete set null,
  date            date default current_date,
  fournisseur     text,
  description     text not null,
  montant_ht      numeric not null default 0,
  regime          text,
  facture_ref     text,
  categorie       text,
  created_at      timestamptz default now()
);

-- ── Base de données produits ──────────────────────────────
create table if not exists produits_bdd (
  id            uuid primary key default uuid_generate_v4(),
  org_id        uuid references organisations(id) not null,
  ref           text,
  categorie     text,
  produit       text not null,
  description   text,
  regime        text default 'Prestation facturée',
  unite         text default 'F',
  tarif_defaut  numeric,
  grille_cc_j   numeric,
  notes         text,
  actif         boolean default true,
  created_at    timestamptz default now()
);

-- ── Grille CC Audiovisuelle (lecture seule) ───────────────
create table if not exists grille_cc (
  id            uuid primary key default uuid_generate_v4(),
  intitule      text not null,
  filiere       text,
  niveau        text,
  type_contrat  text,
  journee_min   numeric,
  semaine_min   numeric,
  mois_min      numeric
);

-- ── Config taux cotisations ───────────────────────────────
create table if not exists cotisation_config (
  id      uuid primary key default uuid_generate_v4(),
  org_id  uuid references organisations(id) not null,
  key     text not null,
  value   numeric not null,
  label   text,
  unique(org_id, key)
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table organisations    enable row level security;
alter table profiles         enable row level security;
alter table clients          enable row level security;
alter table projects         enable row level security;
alter table devis            enable row level security;
alter table devis_categories enable row level security;
alter table devis_lines      enable row level security;
alter table budget_reel      enable row level security;
alter table produits_bdd     enable row level security;
alter table cotisation_config enable row level security;
alter table grille_cc        enable row level security;

-- Helper: récupère l'org_id de l'utilisateur courant
create or replace function get_user_org_id()
returns uuid as $$
  select org_id from profiles where id = auth.uid()
$$ language sql security definer stable;

-- Profiles
create policy "profile_own" on profiles for all using (id = auth.uid());

-- Organisations
create policy "org_own" on organisations for all
  using (id = get_user_org_id());

-- Clients
create policy "clients_org" on clients for all using (org_id = get_user_org_id());

-- Projects
create policy "projects_org" on projects for all using (org_id = get_user_org_id());

-- Devis (auth + lien public par token)
create policy "devis_org" on devis for all
  using (project_id in (select id from projects where org_id = get_user_org_id()));

create policy "devis_public_token" on devis for select
  using (true);  -- token filter done in app; UUID is unguessable

-- Devis categories
create policy "devis_cat_org" on devis_categories for all
  using (devis_id in (
    select d.id from devis d
    join projects p on d.project_id = p.id
    where p.org_id = get_user_org_id()
  ));

-- Devis lines
create policy "devis_lines_org" on devis_lines for all
  using (devis_id in (
    select d.id from devis d
    join projects p on d.project_id = p.id
    where p.org_id = get_user_org_id()
  ));

-- Budget réel
create policy "budget_reel_org" on budget_reel for all
  using (project_id in (select id from projects where org_id = get_user_org_id()));

-- Produits BDD
create policy "produits_org" on produits_bdd for all using (org_id = get_user_org_id());

-- Cotisation config
create policy "cotis_org" on cotisation_config for all using (org_id = get_user_org_id());

-- Grille CC : lecture publique
create policy "grille_cc_read" on grille_cc for select using (true);

-- ============================================================
-- DONNÉES INITIALES — Grille CC Audiovisuelle 2026
-- ============================================================
insert into grille_cc (intitule, filiere, niveau, type_contrat, journee_min, semaine_min, mois_min) values
-- CDDU Flux
('Cadreur / OPV','C','IIIB','CDDU Flux',248.81,null,null),
('Chef OPV','C','II','CDDU Flux',279.58,null,null),
('Chef OPS / Ingénieur du son','H','IIIA','CDDU Flux',268.18,null,null),
('Perchiste / 1er assistant son','H','IIIA','CDDU Flux',195.09,null,null),
('Chargé de production','F','II','CDDU Flux',212.86,null,null),
('Directeur de production','F','I','CDDU Flux',338.82,null,null),
('Chef monteur','E','IIIA','CDDU Flux',249.32,null,null),
('Monteur','C','IIIB','CDDU Flux',208.21,null,null),
('Mixeur','E','II','CDDU Flux',298.17,null,null),
-- CDDU Hors Fiction & Flux
('Chef décorateur','B','II','CDDU HFF',1656.28,6293.87,7192.97),
('Chef électricien','D','IIIB','CDDU HFF',975.19,3705.74,4235.12),
('Chef machiniste','D','IIIB','CDDU HFF',975.19,3705.74,4235.12),
('Chef maquilleur','D','IIIA','CDDU HFF',871.49,3311.66,3784.74),
('Chef monteur (hors flux)','E','IIIA','CDDU HFF',1110.85,4221.22,4824.24),
('Chef OPS / Ingénieur du son (hors flux)','H','IIIA','CDDU HFF',1206.80,4585.86,5240.96),
('Chef OPV (hors flux)','C','II','CDDU HFF',1258.10,4780.78,5463.73),
('Chargé de production (hors flux)','F','II','CDDU HFF',948.41,3603.95,4118.79),
('Coiffeur','D','V','CDDU HFF',703.86,2674.68,3056.77),
('Comptable de production','F','IV','CDDU HFF',739.80,2811.23,3212.82),
('Costumier','B','IV','CDDU HFF',703.86,2674.68,3056.77),
('Décorateur','B','II','CDDU HFF',1054.04,4005.37,4577.55),
('Directeur artistique','A','II','CDDU HFF',1110.85,4221.22,4824.24),
('Directeur de post-production','E','II','CDDU HFF',1258.10,4780.78,5463.73),
('Directeur de production (hors flux)','F','I','CDDU HFF',1524.67,5793.76,6621.42),
('Directeur photo','C','I','CDDU HFF',1753.32,6662.63,7614.41),
('Documentaliste','A','II','CDDU HFF',826.70,3141.46,3590.23),
('Électricien / Éclairagiste','D','V','CDDU HFF',800.11,3040.40,3474.73),
('Étalonneur','E','IIIB','CDDU HFF',950.84,3613.20,4129.36),
('Infographiste','E','IIIA','CDDU HFF',1035.68,3935.57,4497.78),
('Ingénieur de la vision','C','II','CDDU HFF',1258.10,4780.78,5463.73),
('Machiniste','D','V','CDDU HFF',800.11,3040.40,3474.73),
('Maquilleur','D','V','CDDU HFF',703.86,2674.68,3056.77),
('Maquilleur effets spéciaux','D','IIIB','CDDU HFF',1056.37,4014.21,4587.65),
('Mixeur (hors flux)','E','II','CDDU HFF',1341.76,5098.69,5827.06),
('Monteur (hors flux)','C','IIIB','CDDU HFF',927.66,3525.09,4028.66),
('OPS','H','IIIB','CDDU HFF',881.28,3348.87,3827.27),
('Perchiste / 1er assistant son (hors flux)','H','IIIA','CDDU HFF',869.19,3302.93,3774.77),
('Opérateur spécial (steadicamer)','C','IIIA','CDDU HFF',1174.46,4462.95,5100.50),
('Photographe de plateau','C','IIIB','CDDU HFF',798.94,3035.97,3469.67),
-- CAT C
('Doublure lumière','—','V','CAT C',122.00,null,null),
('Figurant (ensemble 30+)','—','V','CAT C',96.20,null,null),
('Figurant (ensemble <30)','—','V','CAT C',98.00,null,null),
-- Artistes Interprètes
('Artiste interprète – Émission dramatique','—','—','Artiste Interprète',289.23,null,null),
('Artiste interprète – Journée unique','—','—','Artiste Interprète',304.99,null,null),
('Artiste interprète – Variétés enregistrement','—','—','Artiste Interprète',419.31,null,null),
('Artiste interprète – Lyrique soliste','—','—','Artiste Interprète',432.86,null,null)
on conflict do nothing;

-- ============================================================
-- Taux cotisations patronales par défaut (modifiables par org)
-- NOTE : insérer après avoir créé une organisation
-- ============================================================
-- Ces valeurs sont insérées côté app lors de la création d'une org.
-- Taux CAPTIV : 67% flat pour Intermittent (Technicien + Artiste)
--               45% pour Salarié CDD
--               0% pour Auto-entrepreneur et Prestation facturée
