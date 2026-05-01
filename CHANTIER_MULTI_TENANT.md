# Chantier Multi-Tenant (MT) — Roadmap

> Créé le 2026-05-01. Document de référence pour le passage de Captiv
> (mono-org de fait) à un SaaS B2B multi-organisation, vendable à d'autres
> sociétés de production. Les phases sont déclenchées au fur et à mesure :
> Phase 0 sécurité dès maintenant, Phase 1+ quand un prospect sérieux
> apparaît.

---

## 1. Contexte & vision

L'outil MATRICE GOLDEN a vocation à être ouvert à d'autres sociétés de
production que Captiv. Chaque société (« organisation ») doit avoir un
espace **isolé**, **sécurisé** et **personnalisable** : ses utilisateurs,
ses projets, ses clients, ses fournisseurs, son catalogue matériel, ses
taux de charges, son branding.

**Bonne nouvelle d'entrée de jeu** : la fondation multi-tenant est déjà
posée dès le schéma initial. La table `organisations` existe, la majorité
des tables critiques portent déjà un `org_id`, et un helper SQL
`get_user_org_id()` est en place pour les policies RLS. L'objectif n'est
donc **pas** de refondre l'architecture — mais de **boucler les trous**,
**formaliser la discipline** et **se préparer à passer à l'échelle** avec
un effort modéré.

---

## 2. État des lieux (audit rapide 2026-05-01)

### Tables avec `org_id` direct (vérifié)
- `organisations`, `profiles`
- `clients`, `projects`, `produits_bdd`, `cotisation_config`
- `fournisseurs` (ajouté en 2026-04-12)
- Domaine planning : `events`, `event_types`, `event_members`,
  `event_devis_lines`, `locations`, `planning_views`, `ical_tokens`
- Domaine matériel : `materiel_bdd`, `matos_listes`, `matos_versions`,
  `matos_categories`, `matos_items`, `matos_item_loueurs`,
  `matos_check_tokens`, `matos_item_comments`,
  `matos_version_attachments`, `matos_version_loueur_infos`,
  `matos_item_photos`
- Domaine devis : `devis_lots`, `tarifs`, `charges`

### Tables scopées par héritage `project_id` → `projects.org_id` (à valider)
- Domaine devis : `devis`, `devis_categories`, `devis_lines`
- Domaine budget : `budget_reel`
- Domaine factures : `factures`
- Domaine livrables : `livrables`, `livrable_blocks`, `livrable_versions`,
  `livrable_etapes`, `livrable_share_tokens`, `projet_livrable_config`
- Domaine accès projet : `project_access`

### Helpers SQL existants
- `get_user_org_id()` (schema.sql) : récupère l'org_id du user courant
  pour usage dans les policies RLS

### Tables qui n'ont pas (ou ne devraient pas avoir) d'org_id
- `auth.*` : tables système Supabase
- Tables purement publiques (rares) — à inventorier dans Phase 0

---

## 3. Phase 0 — Sécurité (DÉCLENCHÉE 2026-05-01) — 3-5 jours

> **Objectif** : garantir l'isolation cross-org **avant** d'ouvrir à un
> second client, et imposer la discipline RLS pour toutes les futures
> migrations. Cette phase n'apporte aucune fonctionnalité visible aux
> utilisateurs Captiv mais constitue le verrou de sûreté indispensable
> au passage en SaaS.

### 0.1 — Audit complet du scoping (1 jour)
- Inventaire de toutes les tables : a-t-elle `org_id` direct ? scope
  hérité via FK ? aucune ?
- Production d'une table récap (markdown ou SQL) avec colonnes : table,
  scope (direct/hérité/none), justification, action.
- **Livrable** : document `docs/MT_SCOPING_AUDIT.md` ou section dans ce
  fichier listant l'inventaire exhaustif.

### 0.2 — Audit RLS rigoureux (1-2 jours)
- Pour chaque table avec RLS activé : analyser chaque policy. Vérifier
  qu'elle filtre bien par org (directement ou via jointure).
- Identifier les policies qui ne filtrent que par `auth.uid()` sans
  contrainte d'org (souvent OK pour profils self mais à vérifier au cas
  par cas).
- Identifier les RPC `SECURITY DEFINER` qui pourraient bypass le scope.
- **Livrable** : tableau des policies + actions correctives.

### 0.3 — Migration corrective (1-2 jours)
- Ajouter `org_id` aux tables qui en manquent (avec backfill depuis
  Captiv, unique org actuelle).
- Durcir les policies RLS faibles.
- Ajouter les index `(org_id, ...)` manquants pour les colonnes
  fréquentes en filtre/tri.
- **Livrable** : migration `2026MMDD_mt0_security_hardening.sql`.

### 0.4 — Tests cross-org (1 jour)
- Créer un fichier de tests d'intégration `__tests__/mt-isolation.test.js`
  ou équivalent SQL qui :
  - crée 2 orgs avec données dupliquées (mêmes noms de projets, mêmes
    fournisseurs, mêmes events)
  - simule un user de chaque org
  - pour chaque table, vérifie que :
    - SELECT renvoie uniquement les rows de l'org du user
    - INSERT avec un `org_id` foreign échoue
    - UPDATE d'une row d'une autre org échoue
    - DELETE d'une row d'une autre org échoue
- Faire tourner ces tests en CI.
- **Livrable** : suite de tests qui passe + intégration CI.

### 0.5 — Documentation des règles (0.5 jour)
- Document `docs/MT_RULES.md` : "Comment écrire une nouvelle migration
  multi-tenant safe".
- Checklist par migration :
  - [ ] La nouvelle table a-t-elle `org_id NOT NULL` ou un scope hérité
        clair via FK ?
  - [ ] RLS activé ?
  - [ ] Policies SELECT/INSERT/UPDATE/DELETE filtrant par
        `get_user_org_id()` ou héritage FK ?
  - [ ] Index sur `(org_id, ...)` pour les colonnes de tri/filtre ?
  - [ ] Tests cross-org mis à jour ?
- **Livrable** : doc référencé dans le README et dans tous les futurs
  prompts de chantier.

---

## 4. Phase 1 — MVP B2B (à déclencher quand un prospect sérieux signe un LOI / trial payant) — 4-5 semaines

### 4.1 — Branding dynamique
- Colonnes sur `organisations` : `name`, `slug`, `logo_url`,
  `brand_color`, `pdf_logo_url`, `signature_blob`.
- Injecter partout où "captiv." apparaît en dur :
  - `Layout.jsx` (sidebar logo)
  - Login screen
  - Headers/footers PDF (devis, livrables, matériel, bilans)
  - Page de partage client
  - Emails transactionnels
- Estimation : 3-5 jours.

### 4.2 — Onboarding nouvelle société
- Le flow signup → création org existe partiellement (`AuthContext.jsx`).
  À muscler :
- Setup wizard pas-à-pas pour le premier admin :
  - Logo + couleur de marque
  - Taux de charges spécifiques (CDD, CDI, intermittents...)
  - Types de projets typiques de la boîte
  - Templates PDF (logo, signature)
  - Invitations équipe par email
- Estimation : 5-7 jours.

### 4.3 — Buckets Storage isolés
- Préfixer tous les paths storage par `<org_id>/...`.
- RLS du bucket : vérifier que l'utilisateur appartient à l'org du
  préfixe.
- Migration des fichiers existants Captiv (rebuild paths).
- Buckets concernés : `project-covers`, `mat-photos`, `mat-attachments`,
  `signatures`, etc.
- Estimation : 2 jours.

### 4.4 — Domaine partagé + landing
- Domaine : `app.captivdesk.com` (ou nom de marque finalisé) pour tous.
- Login détecte l'org via `profiles.org_id` après auth.
- Landing publique avec pricing, démo, formulaire de contact.
- Estimation : 3-4 jours (hors design landing).

### 4.5 — Console super-admin
- Page `/super-admin` accessible uniquement à toi (flag `is_super_admin`
  sur `profiles`).
- Vue : toutes les orgs, leur usage (nb projets, nb users, dernière
  connexion, plan), suspension/réactivation.
- Action « impersonate » : login en tant qu'admin de l'org pour debug.
- Estimation : 3-4 jours.

---

## 5. Phase 2 — Production SaaS (4-5 semaines)

### 5.1 — Stripe Billing
- Plans : Solo / Studio / Production (à finaliser, ex 29€ / 99€ / 299€
  par mois).
- Tiers : nb utilisateurs / nb projets actifs / outils inclus.
- Trial 14 jours.
- Stripe Customer Portal pour gestion abonnement par admin client.
- Suspension auto si impayé : flag `subscription_status` sur `orgs`,
  RLS qui restreint en read-only.
- Estimation : 5-7 jours.

### 5.2 — Emails transactionnels
- Service : Resend ou Postmark.
- Templates : invitation équipe, welcome, paiement OK, paiement raté,
  rappel deadline livrable, partage client...
- Estimation : 3-4 jours.

### 5.3 — RGPD
- DPA (Data Processing Agreement) signable au signup.
- Registre des traitements.
- Procédure de suppression d'un compte / d'une org (GDPR right to
  erasure).
- Export RGPD : ZIP avec toutes les données d'une org en JSON.
- Estimation : 3-5 jours (+ avocat pour rédaction CGV/DPA).

### 5.4 — Sous-domaines par slug (optionnel mais sympa)
- `<slug>.captivdesk.com` pour chaque org (`captiv.captivdesk.com`,
  `boitex.captivdesk.com`).
- Wildcard SSL (Vercel / Cloudflare).
- Estimation : 2-3 jours.

---

## 6. Phase 3 — White-label profond (à la demande, plusieurs semaines)

- Domaines custom (`app.boite-x.com`) avec certificats automatiques.
- Modèles PDF entièrement custom par org (templates uploadables).
- API publique + webhooks pour intégrations.
- Personnalisation des libellés outils ("Livrables" → "Films" → "Contenus").

---

## 7. Trade-offs architecturaux

### Single-DB vs DB-par-client
**Choix actuel** : single-DB avec scoping `org_id` (modèle Linear, Notion,
Stripe). Avantages : simple, migrations centralisées, coûts marginaux
faibles. Inconvénient : un bug RLS expose cross-org → d'où l'importance
de Phase 0. Pour Captiv c'est le bon choix jusqu'à ~100-200 clients.

### Supabase tient la charge ?
Oui jusqu'à plusieurs dizaines de clients sur le plan Pro/Team. Au-delà,
ou pour des contrats sensibles (clients exigeant l'isolation physique),
prévoir un tier "Enterprise" avec instance Supabase dédiée payante.

---

## 8. Estimation budgétaire globale

| Phase | Effort | Quand |
|---|---|---|
| Phase 0 — Sécurité | 3-5 jours | **Maintenant** (mai 2026) |
| Phase 1 — MVP B2B | 4-5 semaines (~25 j) | Au 1er prospect sérieux |
| Phase 2 — Production | 3-4 semaines (~20 j) | Avant le 5e client |
| Phase 3 — White-label | À la demande | Selon besoin |
| **Avocat** (CGV, DPA, mentions légales) | — | ~3-5 k€ Phase 1/2 |
| **Marketing initial** (landing, démos) | — | ~3-5 k€ Phase 1 |

**Total dev pour passer de "outil interne Captiv" à "SaaS B2B vendable"** :
~50 jours-dev répartis sur Phase 1 + 2.

---

## 9. Décisions ouvertes

- Nom commercial du SaaS (« CaptivDesk », « MATRICE », autre ?)
- Domaine final
- Modèle de pricing exact
- Structure juridique (vente directe ? freemium ? on-premise ?)
- Premier prospect cible
- Stratégie de support (Intercom ? email ? Slack partagé ?)

---

## 10. Notes de session

### 2026-05-01 — Création du document
- Audit rapide effectué : fondations MT déjà solides à 80%.
- Décision : Phase 0 déclenchée immédiatement (3-5 jours), pas d'attente.
- Phases 1-3 documentées pour traçabilité, à déclencher selon besoin.

### 2026-05-01 — MT-0.1 ✅ Audit complet du scoping terminé
- **59 tables auditées** dans la base.
- **52 tables saines** : 17 avec `org_id` direct, 35 héritant via FK
  (project_id / event_id / livrable_id / devis_id / version_id / item_id /
  bloc_id / lot_id / facture_id).
- **7 catalogues globaux intentionnellement partagés** :
  `organisations`, `grille_cc` (conventions collectives publiques),
  `outils_catalogue`, `metiers_template`, `metier_template_permissions`,
  `template_categories`, `template_lines`.
- **0 trou structurel** : aucune table business n'est sans rattachement
  à une société.
- **1 cas à valider en MT-0.2** : `prestataire_outils` n'a pas d'`org_id`
  direct, isolation indirecte via `user_id → profiles.org_id`. À
  vérifier que la policy RLS est correcte.
- **Conclusion** : aucune migration corrective de structure nécessaire.
  On peut enchaîner directement sur MT-0.2 (audit RLS).

### 2026-05-01 — Décision produit (Phase 1)
- **Templates métiers personnalisables par org** : aujourd'hui
  `metiers_template`, `template_categories`, `template_lines`,
  `metier_template_permissions` sont partagés entre toutes les orgs.
  Décision Hugo : en Phase 1, chaque organisation devra pouvoir créer
  ses propres templates. Action à prévoir : ajouter `org_id` à ces
  tables avec backfill `NULL = global Captiv` puis bascule des templates
  existants en gabarits "préset système" non-éditables, et permettre
  aux orgs de créer leurs propres templates par-dessus. Pas urgent
  côté sécurité, mais à intégrer au design produit Phase 1.

### 2026-05-01 — MT-0.2 ✅ Audit RLS terminé
- **169 policies analysées** sur 59 tables.
- **Architecture saine** : 99% des policies passent par des fonctions
  centralisées (`can_read_outil`, `can_edit_outil`,
  `can_see_project_finance`, `can_see_project`, `is_admin`,
  `current_user_role`, `is_project_member`). Pas de copier-coller
  hasardeux, tout est unifié.
- **Trou principal détecté** : les fonctions de permission **ne
  vérifient pas l'org** du projet vs l'org du user. Conséquence : en
  multi-tenant, un admin d'une org pourrait potentiellement lire/écrire
  les données d'une autre org si on lui donne par erreur un access. En
  mono-tenant Captiv → aucun risque actuel (1 seule org).
- **Trous spécifiques** :
  - `fournisseurs` a 2 policies trop ouvertes (`using (true)` et
    `auth.uid() IS NOT NULL`) qui annulent le filtre org via le OR
    implicite entre policies de même action.
  - `devis.devis_public_token` a 3 versions de la policy dont 2 en
    `using (true)` — vraisemblablement reliques de migrations
    successives, à nettoyer.
  - `project_access.project_access_admin_write` et
    `project_access_permissions.pap_admin_write` : `is_admin()` sans
    filtre org — un admin peut écrire les permissions d'un projet
    d'une autre org.
- **Helpers à muscler** : ajouter un check
  `EXISTS (SELECT 1 FROM projects p WHERE p.id = pid AND p.org_id =
  get_user_org_id())` dans `can_read_outil`, `can_edit_outil`,
  `can_see_project_finance`, `can_see_project`, `is_project_member`.

### 2026-05-01 — Décisions Phase 0 (validées Hugo)
- **Option A — Cloisonnement total** : un admin d'une organisation ne
  voit jamais les données d'une autre organisation. Pas d'exception,
  pas de bypass dans les helpers RLS.
- **Super_admin RGPD-safe (Phase 1)** : la console super-admin
  n'aura **pas** accès aux données business sensibles (clients,
  projets, finances, équipes, livrables, devis, factures…). Elle
  donnera accès uniquement à :
  - Liste des organisations (nom, slug, plan, statut abonnement)
  - Métriques agrégées (nb projets, nb users, dernière connexion,
    usage stockage)
  - Actions métier (suspendre, réactiver, supprimer une org)
  - Logs techniques (audit, erreurs)
  - **Pas** d'accès en lecture aux tables business
  - Pour le debug client : workflow "impersonate sur demande" en
    Phase 2/3, avec consentement explicite + audit log + durée
    limitée + notification visible dans l'org cible.
- Cette posture est plus contraignante côté support que de pouvoir
  "regarder les données d'un client" mais c'est la posture pro et
  alignée RGPD à laquelle viseront tous les SaaS B2B sérieux. Mieux
  vaut le poser dès Phase 0 que d'avoir à le rétrofitter plus tard.

### 2026-05-01 — MT-0.3 démarré
- Migration corrective en cours de rédaction.
