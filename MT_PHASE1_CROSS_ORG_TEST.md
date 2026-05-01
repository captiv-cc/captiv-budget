# Procédure de test cross-organisation (Phase 1)

> Créé le 2026-05-01 dans le cadre du chantier MT-0.4-B.
>
> **À exécuter le jour J** où une seconde organisation est créée pour
> de vrai dans MATRICE GOLDEN (typiquement : onboarding du 1er prospect
> en Phase 1). Ce test grandeur nature valide définitivement que le
> cloisonnement multi-tenant est étanche, là où l'audit statique
> de MT-0.4-C donnait une preuve structurelle mais pas fonctionnelle.
>
> Si l'un des tests échoue, **arrêter immédiatement** l'onboarding
> de la nouvelle org, créer un ticket "MT-INCIDENT" et corriger
> avant tout autre développement.

---

## 1. Pré-requis

### Comptes nécessaires
- **Org A** : Captiv (existante). Compte admin = ton compte habituel.
- **Org B** : nouvelle org de test. Créer un compte admin dédié, par
  exemple via une adresse alias (`test+orgb@captiv.cc` ou un compte
  Gmail dédié). Ne pas utiliser un compte qui pourrait servir en prod
  par la suite.

### Données à pré-remplir (avant tests)

Sur **Org A** (Captiv), depuis ton compte habituel :
- Identifie **un projet existant** (idéalement TEST CAPTIV ou un
  projet sandbox)
- Note son nom et son URL : `https://app.<domaine>/projets/<id-A>`
- Vérifie qu'il a au moins : 1 devis, 1 livrable, 1 fournisseur,
  1 membre d'équipe

Sur **Org B**, depuis le compte admin de test :
- Crée 1 projet "TEST_ORGB_PROJET_1"
- Note son URL : `https://app.<domaine>/projets/<id-B>`
- Crée dedans : 1 devis, 1 livrable, 1 fournisseur, 1 membre d'équipe

À ce stade, chaque org a son propre univers de données isolé.

---

## 2. Tests d'isolation en lecture

Les tests suivants vérifient qu'**aucune donnée de l'autre org
n'est visible**. Connecte-toi en alternance avec l'admin de chaque
org.

### Test 2.1 — Liste des projets

| Étape | Action | Résultat attendu |
|---|---|---|
| 2.1.a | Login Org A → page `/projets` | **Seuls les projets de Captiv** s'affichent. Aucun "TEST_ORGB_PROJET_1". |
| 2.1.b | Login Org B → page `/projets` | **Seul "TEST_ORGB_PROJET_1"** s'affiche. Aucun projet de Captiv. |

### Test 2.2 — Accès direct par URL

L'attaque la plus probable : un user d'Org A connaît l'URL d'un projet
d'Org B et tente de la visiter directement.

| Étape | Action | Résultat attendu |
|---|---|---|
| 2.2.a | Login Org A → coller URL `<id-B>` dans la barre | Page d'erreur "projet introuvable" OU redirection vers /projets. **Aucune donnée d'Org B visible**. |
| 2.2.b | Login Org B → coller URL `<id-A>` dans la barre | Page d'erreur "projet introuvable" OU redirection vers /projets. |

### Test 2.3 — Listes globales (devis, factures, fournisseurs, livrables, équipe)

| Étape | Action | Résultat attendu |
|---|---|---|
| 2.3.a | Login Org A → page Fournisseurs (depuis n'importe quel projet) | Aucun fournisseur d'Org B visible. |
| 2.3.b | Login Org B → page Fournisseurs | Aucun fournisseur de Captiv visible. |
| 2.3.c | Login Org A → page Index Livrables global (si applicable) | Aucun livrable d'Org B. |
| 2.3.d | Login Org B → page Index Livrables global | Aucun livrable de Captiv. |
| 2.3.e | Login Org A → vue planning globale | Aucun event d'Org B. |
| 2.3.f | Login Org B → vue planning globale | Aucun event de Captiv. |

### Test 2.4 — Recherche / autocomplete

| Étape | Action | Résultat attendu |
|---|---|---|
| 2.4.a | Login Org A → champ recherche projet : taper le nom du projet d'Org B | Aucun résultat. |
| 2.4.b | Login Org B → champ recherche projet : taper le nom d'un projet de Captiv | Aucun résultat. |

---

## 3. Tests d'isolation en écriture

Les tests suivants vérifient qu'**aucune action n'est possible** sur
les données de l'autre org, même via une URL/un payload forgé.

### Test 3.1 — Modification d'un projet

| Étape | Action | Résultat attendu |
|---|---|---|
| 3.1.a | Login Org A → URL `<id-B>` puis tenter de cliquer "Modifier" | Le bouton n'existe pas / l'action échoue / erreur "permission refusée". |
| 3.1.b | Login Org B → URL `<id-A>` puis tenter "Modifier" | Idem. |

### Test 3.2 — Création d'une donnée pour l'autre org

Plus subtile : tester via les outils de développement du navigateur (F12 → onglet Network) qu'on ne peut pas forger une requête API qui crée une donnée pour l'autre org. Si tu n'as pas le réflexe DevTools, demande-moi (Claude) de faire ce test pour toi avec un script.

| Étape | Action | Résultat attendu |
|---|---|---|
| 3.2.a | Login Org A → essayer de créer un livrable en passant `project_id = <id-B>` dans la requête | Erreur 403 / 401 / contrainte RLS. La row n'apparaît pas dans la base. |

### Test 3.3 — Suppression d'une donnée de l'autre org

| Étape | Action | Résultat attendu |
|---|---|---|
| 3.3.a | Login Org A → tenter via DevTools de DELETE un projet `<id-B>` | Erreur 403. La row reste intacte. |

---

## 4. Tests autour du super_admin (si déjà déployé)

Si ton compte super_admin (Phase 1) est en place :

| Étape | Action | Résultat attendu |
|---|---|---|
| 4.a | Login super_admin → console super-admin | Liste des orgs visible (Captiv + Org B). |
| 4.b | Login super_admin → tenter d'ouvrir un projet d'Org B en URL directe | **Refusé**. Le super_admin n'a pas accès aux données business (cohérent avec la décision RGPD). |
| 4.c | Login super_admin → tenter de lister les fournisseurs d'Org B | **Refusé**. |

Si l'un de ces tests passe alors que le super_admin n'est pas censé
avoir accès : c'est un trou RGPD à fermer immédiatement.

---

## 5. Test du token de partage public (livrables)

Le partage public des livrables (LIV-24) génère des URL avec token.
Ces URL doivent fonctionner SANS auth, mais ne donner accès qu'aux
livrables du projet pointé par le token.

| Étape | Action | Résultat attendu |
|---|---|---|
| 5.a | Login Org A → générer un lien de partage pour le projet `<id-A>` | Lien créé. URL `https://app/share/livrables/<token-A>`. |
| 5.b | Ouvrir cette URL en navigation privée (sans auth) | La page s'affiche correctement avec les livrables d'Org A. |
| 5.c | Modifier le token dans l'URL pour mettre un token aléatoire | Erreur "lien invalide / expiré". |
| 5.d | Login Org B → tenter de générer un lien pour le projet `<id-A>` | **Refusé** (Org B ne devrait pas voir ce projet). |

---

## 6. Bilan

À la fin de la procédure, lister les tests dans un récap :

| Catégorie | PASS | FAIL |
|---|---|---|
| §2 Lecture | __ / 10 | __ |
| §3 Écriture | __ / 4 | __ |
| §4 Super_admin | __ / 3 | __ |
| §5 Partage public | __ / 4 | __ |
| **Total** | __ / 21 | __ |

**Critère de validation** : 21/21 PASS. Tout autre score est un
incident bloquant à corriger avant ouverture publique.

Une fois la procédure terminée :
- **Si 21/21** : marquer MT-0.4-B ✅ dans `CHANTIER_MULTI_TENANT.md`,
  Phase 0 est définitivement close.
- **Si < 21/21** : créer un ticket par test KO, corriger, rejouer la
  procédure complète. Ne pas valider partiellement.

---

## Annexe : nettoyer après les tests

Une fois la validation réussie et si l'Org B était une org de test
(pas un vrai prospect), penser à supprimer ses données pour ne pas
polluer la base :

```sql
-- À exécuter en SQL Editor avec les bons UUIDs
DELETE FROM organisations WHERE name LIKE 'TEST_ORGB%';
-- (cascade DELETE supprimera projets, devis, livrables, etc.)
```
