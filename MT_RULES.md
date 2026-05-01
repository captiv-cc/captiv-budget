# Règles multi-tenant pour les futures migrations

> Document de référence — créé le 2026-05-01 dans le cadre du chantier
> MT-0.5 (Phase 0). À consulter **avant** chaque nouvelle migration
> Supabase qui crée ou modifie une table de la base.
>
> Pourquoi ce doc existe : MATRICE GOLDEN est désormais conçu pour
> accueillir plusieurs organisations clientes. Chaque table doit donc
> être pensée pour rester cloisonnée par société. Cette discipline
> imposée dès la conception évite d'avoir à réauditer 60 tables le
> jour où une 2e société s'inscrit.
>
> Public visé : Claude (qui rédige les migrations) + Hugo (qui
> supervise et valide).

---

## 1. Les 3 catégories de tables

Toute nouvelle table tombe dans **une** des trois catégories suivantes.
Identifier laquelle dès la conception est l'étape la plus importante.

### Catégorie A — Scopée par société directement

La table porte une colonne `org_id` qui désigne la société propriétaire.
Exemples existants : `clients`, `projects`, `fournisseurs`,
`materiel_bdd`, `produits_bdd`, `events`, `event_types`, `locations`,
`planning_views`, `cotisation_config`, `tarifs`, `charges`,
`invitations_log`, `ical_tokens`.

À utiliser quand la table contient des données **directement
appartenant à la société**, sans entité parente.

### Catégorie B — Scopée par héritage

La table n'a pas de `org_id` mais a une clé étrangère vers une table
de catégorie A. L'isolation est garantie par cette FK et par les
policies RLS qui font la jointure. Exemples : `livrables` (via
`project_id`), `livrable_versions` (via `livrable_id` → `livrables`
→ `project_id`), `devis_lines` (via `devis_id` → `devis` →
`project_id`), `matos_items` (via `matos_blocks` → `matos_versions`
→ `project_id`).

À utiliser quand la table est **un détail** d'une entité parente
elle-même scopée. Évite la duplication de la colonne `org_id` et
évite les risques d'incohérence (un livrable et son projet dans
des orgs différentes, ça ne doit pas arriver).

### Catégorie C — Globale (partagée entre toutes les orgs)

La table contient des données **publiques ou de référence** qui ont
vocation à être identiques pour toutes les sociétés. Exemples :
`grille_cc` (conventions collectives), `minimas_convention` (minimas
CCNTA), `outils_catalogue` (catalogue d'outils du système),
`organisations` (table de gestion).

**Cas usage très limité.** Si tu hésites entre A et C, c'est presque
toujours A. Une donnée de référence n'est globale que si elle est
légalement publique (ex: une convention collective) ou structurelle
au système (ex: catalogue interne d'outils).

---

## 2. Checklist par migration

À cocher mentalement avant tout `git commit`.

### Si tu crées une nouvelle table
- [ ] Ai-je identifié sa catégorie (A, B ou C) ?
- [ ] **Catégorie A** : la colonne `org_id UUID NOT NULL REFERENCES
      organisations(id) ON DELETE CASCADE` est-elle présente ?
- [ ] **Catégorie B** : la FK vers la table parente est-elle bien
      `NOT NULL` (sauf cas justifié) et `ON DELETE CASCADE` ?
- [ ] La RLS est-elle activée : `ALTER TABLE x ENABLE ROW LEVEL
      SECURITY;` ?
- [ ] Ai-je créé au moins 2 policies (SELECT et ALL ou
      INSERT/UPDATE/DELETE séparées) ?
- [ ] Les policies utilisent-elles `get_user_org_id()` ou les helpers
      `can_read_outil` / `can_edit_outil` / `can_see_project*` ?
- [ ] **Aucune policy avec `using (true)`** sauf cas explicitement
      whitelisté dans `MT_RULES.md` (catégorie C uniquement) ?
- [ ] Les colonnes de filtre/tri fréquentes ont-elles un index ?
      (notamment `org_id`, ou les FK des catégorie B)

### Si tu modifies une table existante
- [ ] Ai-je préservé le scoping `org_id` direct ou hérité ?
- [ ] Si je rajoute une colonne, est-ce qu'elle ne casse pas le
      scope (ex: une nouvelle FK qui pointerait vers une autre org) ?
- [ ] Si je rajoute/modifie une policy, ai-je relu les autres policies
      de la table ? (rappel : entre policies de même action,
      PostgreSQL fait un OR — une policy laxiste annule les autres)

### Si tu crées un helper SQL `SECURITY DEFINER`
- [ ] Le helper vérifie-t-il l'org du user via `get_user_org_id()`
      ou en passant par les helpers existants (qui le font déjà) ?
- [ ] Le helper ne contourne-t-il pas accidentellement la RLS d'une
      autre table en faisant un SELECT direct ?

### Validation post-migration
- [ ] J'ai exécuté la migration sur Supabase et elle a réussi
- [ ] J'ai relancé `supabase/mt0_4_static_audit.sql` et le verdict
      §6 est toujours **PASS**
- [ ] J'ai fait un smoke test (navigation Captiv 2 min) — rien de
      cassé

---

## 3. Patterns à recopier

### 3.1 — Nouvelle table catégorie A (scopée directement par org)

```sql
CREATE TABLE IF NOT EXISTS ma_nouvelle_table (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  -- ... autres colonnes métier ...
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ma_nouvelle_table_org
  ON ma_nouvelle_table(org_id);

ALTER TABLE ma_nouvelle_table ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ma_nouvelle_table_scoped_read" ON ma_nouvelle_table
  FOR SELECT
  USING (org_id = get_user_org_id());

CREATE POLICY "ma_nouvelle_table_scoped_write" ON ma_nouvelle_table
  FOR ALL
  USING (
    org_id = get_user_org_id()
    AND current_user_role() IN ('admin', 'charge_prod')
  )
  WITH CHECK (
    org_id = get_user_org_id()
    AND current_user_role() IN ('admin', 'charge_prod')
  );
```

### 3.2 — Nouvelle table catégorie B (scopée via projet)

```sql
CREATE TABLE IF NOT EXISTS livrable_attachments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  livrable_id  UUID NOT NULL REFERENCES livrables(id) ON DELETE CASCADE,
  -- ... autres colonnes ...
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_livrable_attachments_livrable
  ON livrable_attachments(livrable_id);

ALTER TABLE livrable_attachments ENABLE ROW LEVEL SECURITY;

-- Lecture : un user peut lire les attachments d'un livrable
-- s'il a la permission "livrables" sur le projet parent.
-- can_read_outil() filtre déjà par org grâce au garde-fou MT-0.3.
CREATE POLICY "livrable_attachments_scoped_read" ON livrable_attachments
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM livrables l
    WHERE l.id = livrable_attachments.livrable_id
      AND can_read_outil(l.project_id, 'livrables')
  ));

CREATE POLICY "livrable_attachments_scoped_write" ON livrable_attachments
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM livrables l
    WHERE l.id = livrable_attachments.livrable_id
      AND can_edit_outil(l.project_id, 'livrables')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM livrables l
    WHERE l.id = livrable_attachments.livrable_id
      AND can_edit_outil(l.project_id, 'livrables')
  ));
```

### 3.3 — Nouvelle table catégorie C (globale, à utiliser parcimonieusement)

```sql
CREATE TABLE IF NOT EXISTS table_de_reference_publique (
  key         TEXT PRIMARY KEY,
  -- ... autres colonnes purement référentielles ...
  updated_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE table_de_reference_publique ENABLE ROW LEVEL SECURITY;

-- ⚠️ Policy "open" assumée : ces données sont VOLONTAIREMENT
-- partagées entre toutes les orgs.
CREATE POLICY "table_de_reference_publique_read" ON table_de_reference_publique
  FOR SELECT
  USING (true);

-- L'écriture reste réservée aux super-admins (Phase 1) ou
-- gérée hors-app (script ETL, sync depuis source officielle).
-- Pas de policy WRITE = personne ne peut écrire via l'app.
```

**Si tu utilises ce pattern, ajoute la table à la whitelist dans
`supabase/mt0_4_static_audit.sql` §6 BILAN** pour qu'elle ne fasse
plus failer le verdict global.

---

## 4. Pièges à éviter

### Piège 1 — Policy laxiste qui annule les autres

PostgreSQL applique les policies en **OR** entre celles de même
action. Si tu as :

```sql
CREATE POLICY "x_strict" FOR SELECT USING (org_id = get_user_org_id());
CREATE POLICY "x_open"   FOR SELECT USING (true);  -- ⚠️
```

→ La policy `x_open` rend la première inutile. Tout user peut tout
lire. Toujours **drop les anciennes policies** avant d'en créer de
nouvelles, ou faire `CREATE OR REPLACE POLICY` quand c'est supporté.

### Piège 2 — Helper `SECURITY DEFINER` qui bypass la RLS

Une fonction `SECURITY DEFINER` s'exécute avec les privilèges du
créateur (souvent `postgres` = bypass RLS). Si dans ta fonction tu
fais :

```sql
SELECT * FROM autre_table WHERE id = qqch;
```

→ Tu lis sans filtre RLS. Si tu retournes ces données à l'utilisateur,
c'est une fuite. **Toujours filtrer explicitement par
`get_user_org_id()` ou par les helpers existants** dans le corps
des fonctions.

### Piège 3 — `auth.uid()` sans contrainte d'org

Une policy `USING (user_id = auth.uid())` est OK pour un cas
"self-only" (l'utilisateur ne voit que ses propres lignes, ex:
`profiles`, `project_access`). Mais pour toute autre table, ce n'est
**pas suffisant** : il faut au minimum vérifier que la donnée
appartient à l'org du user.

### Piège 4 — Oublier l'index sur `org_id`

Sans index sur la colonne de scope, chaque requête fait un full
scan. Avec 1 org, c'est imperceptible. Avec 50 orgs et 1M de rows,
c'est dramatique. **Toujours indexer la colonne de scope** des
catégorie A, et les FK des catégorie B.

### Piège 5 — Foreign key sans `ON DELETE CASCADE`

Si la suppression d'une org ne cascade pas vers ses tables filles,
on se retrouve avec des "rows zombies" pointant vers une org
inexistante. Pour la suppression RGPD d'une société, c'est
problématique. **Toujours `ON DELETE CASCADE`** sur les FK vers
`organisations`, `projects`, et tout ce qui est un "owner".

### Piège 6 — Policies créées via le dashboard Supabase

Le SQL Editor permet de créer des policies via une UI graphique.
**À éviter** : ces policies ne sont pas dans les migrations
versionnées, donc invisibles aux audits et impossibles à reproduire
sur un autre environnement. Toujours créer les policies en SQL
dans un fichier de migration commité.

---

## 5. Comment auditer

Après toute migration impactant la sécurité :

### Audit rapide (30 sec)

```bash
# Dans Supabase SQL Editor, copier-coller la requête §6 BILAN
# de supabase/mt0_4_static_audit.sql
# Doit renvoyer "PASS"
```

### Audit complet (5 min)

Lancer l'intégralité de `supabase/mt0_4_static_audit.sql`. Lire les
6 sections, vérifier qu'aucune table critique n'est sans policy,
qu'aucune nouvelle policy "open" n'est apparue.

### Audit cross-org (Phase 1, jour J)

Dérouler `MT_PHASE1_CROSS_ORG_TEST.md` quand une 2e org existe pour
de vrai. 21 tests à passer.

---

## 6. Exception : que faire si je dois vraiment partager une donnée ?

Cas réel rencontré : tu ajoutes une table de référence (ex: liste
des départements français, codes ROME, etc.). Cette table doit être
identique pour toutes les orgs, c'est de la donnée pure.

**Procédure** :

1. Créer la table comme catégorie C (sans `org_id`, RLS avec
   `using (true)` en SELECT, pas de WRITE policy)
2. Ajouter la table à la **whitelist** dans
   `supabase/mt0_4_static_audit.sql` §6 BILAN (la liste
   `c.relname NOT IN (...)`)
3. Documenter dans **`CHANTIER_MULTI_TENANT.md` §10** pourquoi
   cette table est volontairement partagée
4. Si le contenu doit pouvoir être édité depuis l'app (au-delà de
   l'ETL), réserver l'édition au super_admin uniquement (policy
   WRITE qui vérifie `is_super_admin()` — fonction à créer en
   Phase 1)

---

## 7. Quand demander de l'aide

Tout cas qui ne rentre pas dans A/B/C ou qui semble bizarre =
**ouvrir le sujet avec Hugo avant de coder**. Quelques signaux :

- "Cette table doit être visible par certaines orgs mais pas
  toutes" → cas inhabituel, mérite réflexion architecturale
- "On a besoin que les users d'une org puissent lire les données
  d'une autre via un workflow spécifique (ex: sous-traitance)" →
  c'est probablement Phase 2/3, mérite un design doc
- "Le helper existant ne suffit pas pour cette policy" → vérifier
  qu'on n'est pas en train de réinventer un trou de sécurité
- "On va juste mettre `using (true)` temporairement, on
  durcira plus tard" → **NON, jamais**. Le "temporairement" devient
  permanent. Toujours scoper dès le départ.

---

## Annexe — Liens utiles

- **Audit statique** : `supabase/mt0_4_static_audit.sql`
- **Procédure cross-org Phase 1** : `MT_PHASE1_CROSS_ORG_TEST.md`
- **Roadmap MT** : `CHANTIER_MULTI_TENANT.md`
- **Helpers SQL existants** : voir `supabase/ch3b_project_access.sql`
- **Migration sécurité MT-0.3** :
  `supabase/migrations/20260501_mt0_security_hardening.sql`
