# CAPTIV Budget — Guide de déploiement

## Stack
- **Frontend** : React 18 + Vite + Tailwind CSS
- **Backend / DB** : Supabase (PostgreSQL + Auth + RLS)
- **Hébergement** : Vercel (free tier)
- **PDF** : jsPDF + jspdf-autotable

---

## Étape 1 — Supabase (base de données)

1. Créer un compte sur https://supabase.com (gratuit)
2. Créer un **nouveau projet** (choisir la région `eu-west-3` Paris)
3. Dans **SQL Editor** → **New query**, coller le contenu de `supabase/schema.sql` → **Run**
4. Récupérer vos clés dans **Project Settings → API** :
   - `Project URL` → `VITE_SUPABASE_URL`
   - `anon public` key → `VITE_SUPABASE_ANON_KEY`

---

## Étape 2 — Installation locale

```bash
# Dans le dossier captiv-budget/
cp .env.example .env
# Remplir .env avec vos clés Supabase

npm install
npm run dev
# → http://localhost:3000
```

---

## Étape 3 — Premier lancement

1. Ouvrir http://localhost:3000
2. Cliquer **"Pas encore de compte ? S'inscrire"**
3. Créer votre compte (email/mot de passe)
4. L'app demandera le nom de votre organisation — saisir **"CAPTIV SARL / OMNI FILMS"**
5. Les taux de cotisations par défaut sont insérés automatiquement :
   - Intermittent Technicien : **67%**
   - Intermittent Artiste : **67%**
   - Salarié CDD : **45%**
   - Auto-entrepreneur : **0%**
   - Prestation facturée : **0%**

---

## Étape 4 — Déploiement Vercel

```bash
npm install -g vercel
vercel login
vercel --prod
# Suivre les instructions
# Ajouter les variables d'environnement quand demandé
```

Ou via l'interface Vercel :
1. Push le dossier sur GitHub
2. Importer le repo sur https://vercel.com
3. Ajouter les variables d'environnement dans Settings → Environment Variables :
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Deploy → URL générée en ~2 minutes

---

## Étape 5 — Inviter des collaborateurs

Dans Supabase → **Authentication → Users** :
- Cliquer **"Invite user"** pour ajouter les membres de l'équipe
- Ils recevront un email d'invitation
- À la première connexion, ils rejoindront automatiquement votre organisation

> Pour modifier les rôles : SQL Editor →
> `UPDATE profiles SET role = 'editor' WHERE id = 'uuid-de-l-utilisateur';`

---

## Architecture fichiers

```
src/
├── lib/
│   ├── supabase.js       → Client Supabase
│   ├── cotisations.js    → Moteur de calcul (taux, formules)
│   └── pdfExport.js      → Génération PDF devis
├── contexts/
│   └── AuthContext.jsx   → Auth + profil + org
├── components/
│   └── Layout.jsx        → Sidebar + navigation
└── pages/
    ├── Login.jsx         → Connexion / inscription
    ├── Dashboard.jsx     → KPIs + projets récents
    ├── Projets.jsx       → Liste projets
    ├── ProjetDetail.jsx  → Devis + budget d'un projet
    ├── DevisEditor.jsx   → Éditeur de devis (page principale)
    ├── BudgetReel.jsx    → Suivi dépenses réelles
    ├── Clients.jsx       → Gestion clients
    ├── BDD.jsx           → Base de données produits + Grille CC
    └── DevisPublic.jsx   → Vue client (lien public)
```

---

## Fonctionnalités principales

### Éditeur de devis
- Colonnes : REF | PRODUIT | DESCRIPTION | RÉGIME | USE? | INT | C=V | MAR | QT | U | TARIF | REMISE | **PRIX VENTE HT** | **COÛT RÉEL HT** | **MARGE HT** | **% MARGE** | **CHARGES PAT.** | **COÛT CHARGÉ**
- Toggles par ligne :
  - **USE?** : activer/désactiver la ligne du calcul
  - **INT** : prestation interne gérant (coût = 0)
  - **C=V** : coût = prix de vente (pas de marge)
  - **MAR** : inclure/exclure de la marge globale
- Panel synthèse live : Total HT / TVA / TTC / Acompte / Marge

### Versions de devis
- Dupliquer en V+1 en un clic (menu "Dupliquer V2")
- Changer le statut : Brouillon → Envoyé → Accepté / Refusé
- Comparaison des versions dans ProjetDetail

### Lien client public
- Bouton **"Lien client"** → copie l'URL `/devis/public/:token`
- Vue simplifiée : Désignation | Description | Qté | U | Prix unitaire | Total
- **Pas de coûts ni de marges affichés au client**
- Le client peut cliquer **"Accepter ce devis"** → statut passe à "Accepté"

### Export PDF
- Bouton **"PDF"** → télécharge `Devis_NomProjet_V1.pdf`
- Filtre automatique les lignes vides
- En-tête société + infos client + tableau + synthèse

### Budget réel vs devis
- Saisie des dépenses réelles (date, fournisseur, montant HT, facture)
- Comparatif automatique avec le dernier devis accepté
- Alerte visuelle si dépassement

---

## Taux de cotisations — modifier

Les taux sont dans la table `cotisation_config`. Pour les modifier :

```sql
UPDATE cotisation_config 
SET value = 0.70  -- 70% au lieu de 67%
WHERE org_id = 'votre-org-id' AND key = 'Intermittent Technicien';
```

Ou via l'interface (à venir dans Settings).

---

## Grille CC Audiovisuelle 2026

Intégrée dans la table `grille_cc` (lecture seule).
Visible dans BDD → onglet "Grille CC Audiovisuelle".
Source : CC Audiovisuelle, avenant n°20 du 29/11/2024, SMIC 01/01/2026 (12,02€/h).
