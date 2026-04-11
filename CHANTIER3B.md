# Chantier 3B.1 — Project Access + RLS granulaire

Système de permissions **par projet** côté serveur (Supabase Row Level
Security). Un humain peut désormais avoir des rôles différents sur différents
projets (ex: monteur sur projet A, chef op sur projet B), et les RLS Postgres
garantissent qu'un utilisateur qui bypass le front ne peut toujours pas voir
ce à quoi il n'a pas droit.

---

## 1. Philosophie

`profiles.role` devient uniquement un **niveau de clearance global** :

| profiles.role   | Sens                                                   |
|-----------------|--------------------------------------------------------|
| `admin`         | Voit/contrôle tout. Bypass RLS total.                  |
| `charge_prod`   | Accès finance **sur les projets où il est attaché**    |
| `coordinateur`  | Pas d'accès finance. Visibilité projet limitée à ses attachements. |
| `prestataire`   | Aucun accès global. Tout se joue sur `project_access`. |

Le **métier** (Monteur, Cadreur, Réalisateur…) n'est plus sur `profiles`, il
est porté par `project_access.metier_template_id` — un humain peut donc être
monteur sur un projet et chef op sur un autre.

---

## 2. Modèle de données

### `project_access` (attachement user ↔ projet)
```
user_id             uuid → profiles(id)
project_id          uuid → projects(id)
metier_template_id  uuid → metiers_template(id)  [NULL pour les internes]
role_label          text                          [libellé libre "Chef op lumière"]
added_at, added_by, note
PRIMARY KEY (user_id, project_id)
```

### `project_access_permissions` (overrides par outil)
```
user_id, project_id  → FK vers project_access
outil_key            → FK vers outils_catalogue
can_read, can_comment, can_edit  [NULL = hériter du template]
PRIMARY KEY (user_id, project_id, outil_key)
```

### Colonnes supprimées
- `profiles.metier_template_id` (3A → 3B)
- `profiles.metier_label` (3A → 3B)
- Table `prestataire_outils` (3A → 3B : remplacée par `project_access_permissions`)

Les tables `outils_catalogue`, `metiers_template`, `metier_template_permissions`
de 3A **restent inchangées** et sont réutilisées.

---

## 3. Helpers SQL

Tous SECURITY DEFINER + STABLE, définis sur `search_path = public` :

| Fonction                              | Rend                                          |
|---------------------------------------|-----------------------------------------------|
| `current_user_role()`                 | `'admin'` / `'charge_prod'` / ...             |
| `is_admin()`                          | bool                                          |
| `is_internal()`                       | bool (admin/charge_prod/coordinateur)         |
| `has_finance_role()`                  | bool (admin/charge_prod)                      |
| `is_project_member(pid)`              | bool — user attaché au projet                 |
| `can_see_project(pid)`                | admin OR attaché                              |
| `can_see_project_finance(pid)`        | admin OR (charge_prod AND attaché)            |
| `can_read_outil(pid, outil)`          | résolution template + override                |
| `can_edit_outil(pid, outil)`          | résolution template + override                |

---

## 4. Hiérarchie de résolution (prestataires)

Pour un prestataire attaché à un projet, la lecture d'une permission outil
résout dans cet ordre (premier non-NULL gagne) :

1. **Override projet** : `project_access_permissions` pour (user, projet, outil)
2. **Template** : `metier_template_permissions` pour `project_access.metier_template_id`
3. **Défaut** : `false`

Les rôles internes (admin, charge_prod, coordinateur) attachés au projet
**bypass** complètement cette résolution et obtiennent `true` sur tout outil
(côté RLS via `can_read_outil` / `can_edit_outil`).

---

## 5. RLS tightening — tables touchées

### Visibilité projet
- `projects` → `can_see_project(id)` en lecture, `can_see_project_finance` en écriture pour charge_prod attaché, admin sinon

### Finance scopée (admin + charge_prod attaché uniquement)
- `devis`, `devis_categories`, `devis_lines`, `devis_ligne_membres`
- `budget_reel`
- `factures`

Le token public `devis_public_token` est préservé (clients externes).

### Outil scopé (read via `can_read_outil`, write via `can_edit_outil`)
- `livrables`, `livrable_versions` → outil `livrables`
- `call_sheets`, `call_sheet_lignes` → outil `callsheet`
- `planning_phases`, `planning_items`, `jours_tournage` → outil `planning`
- `projet_membres` → read = visibilité projet, write = outil `equipe`
  (le read est élargi pour permettre les joins depuis call_sheet_lignes / devis_ligne_membres)

---

## 6. Trigger auto-attachement

Quand un projet est INSERT-é, un trigger inscrit automatiquement son
`created_by` dans `project_access`. Un charge_prod qui crée un nouveau
projet est donc instantanément attaché — sinon il ne verrait pas le projet
qu'il vient de créer.

---

## 7. Application de la migration

⚠️ **À faire manuellement dans le Supabase SQL Editor.** Migration idempotente.

### Étape 1 — Backup si possible
Plan gratuit : exporter un CSV de `profiles` et `projects` avant de lancer.
Plan Pro : déclencher un backup manuel.

### Étape 2 — Exécution
1. Ouvrir `supabase/ch3b_project_access.sql`
2. Copier-coller l'intégralité dans le SQL Editor
3. Run

Le script :
1. Supprime `profiles.metier_template_id`, `profiles.metier_label`, table `prestataire_outils`
2. Crée `project_access` + `project_access_permissions`
3. Crée les 10 helpers SQL
4. Active RLS et pose les policies sur les nouvelles tables
5. Remplace les anciennes policies org-wide par des policies scopées sur :
   `projects`, `devis*`, `budget_reel`, `factures`, `livrables*`, `call_sheets*`,
   `planning_*`, `jours_tournage`, `projet_membres`
6. Installe le trigger auto-attachement

### Étape 3 — Vérifications

```sql
-- 1. Les nouvelles tables existent
SELECT count(*) FROM project_access;              -- 0
SELECT count(*) FROM project_access_permissions;  -- 0

-- 2. Colonnes 3A supprimées
SELECT column_name FROM information_schema.columns
WHERE table_name='profiles' AND column_name IN ('metier_template_id','metier_label');
-- 0 lignes

-- 3. Table prestataire_outils supprimée
SELECT to_regclass('public.prestataire_outils');   -- NULL

-- 4. Helpers présents
SELECT is_admin(), is_internal(), has_finance_role();  -- attendu pour Hugo : true, true, true

-- 5. Admin voit toujours tous les projets
SELECT id, title FROM projects;
```

---

## 8. Assigner un prestataire à un projet

```sql
-- 1. Attacher le user au projet avec son template métier
INSERT INTO project_access (user_id, project_id, metier_template_id, role_label)
VALUES (
  (SELECT id FROM profiles WHERE email = 'monteur@example.com'),
  (SELECT id FROM projects WHERE title = 'Mon projet'),
  '11111111-1111-1111-1111-111111111111',  -- Monteur
  'Chef monteur'
);

-- 2. (optionnel) Override : lui donner accès au callsheet en lecture sur CE projet
INSERT INTO project_access_permissions
  (user_id, project_id, outil_key, can_read, can_comment, can_edit)
VALUES (
  (SELECT id FROM profiles WHERE email = 'monteur@example.com'),
  (SELECT id FROM projects WHERE title = 'Mon projet'),
  'callsheet',
  true, false, false
);
```

Les NULL sur `can_read/can_comment/can_edit` signifient "hériter du template".

### Attacher un charge_prod à un projet
Pour qu'un charge_prod voie un projet existant, il faut l'attacher explicitement
(le trigger auto-attachement ne marche que pour les projets créés par lui) :
```sql
INSERT INTO project_access (user_id, project_id)
VALUES (<user_id>, <project_id>);
-- metier_template_id = NULL pour les internes (bypass outil)
```

---

## 9. Impact front

| Fichier                                       | Changement                                        |
|-----------------------------------------------|---------------------------------------------------|
| `src/lib/permissions.js`                      | Rename `buildPermissions` → `buildProjectPermissions` (alias conservé), commentaires 3B |
| `src/hooks/useProjectPermissions.js`          | **NOUVEAU** : charge perms par projet depuis Supabase |
| `src/contexts/AuthContext.jsx`                | Retrait du chargement global template + overrides |
| `src/pages/ProjetLayout.jsx`                  | Utilise `useProjectPermissions(id)`, redirect `/unauthorized` si non attaché |
| `src/components/guards/RequirePermission.jsx` | Accepte désormais `projectId` (via `useParams()` par défaut) |
| `src/App.jsx`                                 | Nettoyage import inutilisé                         |

Les pages Dashboard, Compta, HomePage ne changent **pas** côté code : les RLS
scopent automatiquement les requêtes finance pour charge_prod selon les
projets attachés. C'est le principal bénéfice de la migration.

---

## 10. Tests

17 tests smoke verts via `node --test` (indépendants de vitest), exerçant :
- Constantes + INTERNAL_ROLES
- `buildProjectPermissions` (template, overrides, monotonie, NULL = hériter)
- Alias rétro-compat `buildPermissions`
- `can()` bypass admin/charge_prod/coordinateur
- `can()` résolution prestataire (Monteur, Réalisateur)
- `canSee`, `hasRole`, `isInternal`, `isPrestataire`
- Edge cases (ctx null, outil manquant)

Le fichier `src/lib/permissions.test.js` (suite vitest 44 tests de 3A) reste
valide : `buildPermissions` étant aliasé sur `buildProjectPermissions`, aucun
test ne casse. À relancer localement après `npm install` :

```bash
npx vitest run src/lib/permissions.test.js
```

---

## 11. Points d'attention / limites connues

1. **Pas de seed automatique** : les projets existants ne contiennent personne
   dans `project_access`. Seul l'admin (bypass) voit le projet existant.
   Pour qu'un charge_prod ou coordinateur voie un projet existant, il faut
   l'y attacher manuellement (cf. §8).

2. **UI d'attachement = chantier 3B.2** : pour l'instant l'attachement se
   fait en SQL. Le chantier 3B.2 ajoutera une page admin "Accès du projet"
   avec bouton "Attacher un user", sélecteur de template, et override
   avancé.

3. **`projet_membres` ≠ `project_access`** : la table existante
   `projet_membres` (crew HR/compta, intermittents avec tarifs et statut
   MovinMotion) est **distincte** de `project_access` (droits applicatifs
   d'un user avec un compte). Elles coexistent sans chevauchement. Le
   chantier 3B.2 pourra offrir une UX pour lier les deux quand un crew
   member a aussi un compte app.

4. **Overrides côté UI** : le hook `useProjectPermissions` gère la
   résolution template + override. Pour écrire un override il faudra
   l'écran admin du 3B.2 (actuellement SQL uniquement).
