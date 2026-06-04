# CHANTIER DÉROULÉ — Extension FESTIVAL

> **État** : Roadmap discutée et validée avec Hugo — pas encore commencée.
> Document vivant, à mettre à jour au fil des sprints.
>
> **Précondition** : extension du chantier `CHANTIER_DEROULE.md` (V1
> existante = lives simples). Cette roadmap ajoute le support festival
> multi-scènes / multi-cadreurs sans casser le mode live.

## TL;DR

L'outil Déroulé actuel marche très bien pour les **lives** (max 2-3 lanes,
créneaux verticaux, partage public read-only). Pour les **festivals
musicaux** (multi-scènes, multi-cadreurs nominatifs, missions partielles
sur artistes), il manque :

- Distinction sémantique **Lieu vs Personne** dans les lanes
- Plus de 5 lanes (festival = 10-15 colonnes facilement)
- **Vue par cadreur** (mobile-first, sans scroll horizontal)
- **Liens entre créneaux** (artiste programmé ↔ mission cadreur)
- **Notes enrichies + pièces jointes** sur blocs (setlist PNG, conditions
  photo, "2 premiers sons seulement")
- **Import IA** depuis timetable festival (PDF, image, Excel) pour
  dégrossir le travail
- Détection de conflits cadreur, charge, indispos
- Métadonnées contextuelles (golden hour / sunset / sunrise)
- Mode régie live avec annonces broadcast
- Historique des versions du planning

Toutes les évolutions sont **additives** — un déroulé live continue à
fonctionner exactement comme avant si on n'active rien des nouveautés.

## Contrainte transversale : MINIMALISME

Hugo : *"Je veux surtout que ce soit visuellement fluide et léger, pas de
surplus, du minimalisme, il y aura beaucoup d'infos déjà."*

Implications pour toutes les features ci-dessous :
- Par défaut, l'UI ressemble à l'actuel
- Les nouvelles features s'activent via toggles discrets / actions
  contextuelles, pas via des panneaux permanents
- Les indicateurs visuels sont fins (pastilles, bandes 1px, badges
  discrets), jamais de bandeau de couleur qui prend la moitié de l'écran
- La densité d'info est maîtrisée : ce qui n'est pas critique au regard
  est masqué par défaut, accessible au click/hover

## Gap actuel vs besoin festival (analyse des Google Sheets Hugo)

Sur les exemples partagés (festival Saturday avec 17 colonnes, festival
Vendredi 13 juin, festival Vand B Fest, Marsatac, MC26 Moga Capa) :

| Caractéristique festival | État actuel | Gap |
|---|---|---|
| 7+ scènes en colonnes | Max 5 lanes, pas de distinction lieu/personne | Cap à élargir + typage |
| Cadreurs nominatifs en colonnes | Pas de type "personne" | Nouveau type de lane |
| Cadreur sur plusieurs scènes | Pas de vue par personne | Vue Cadreur à créer |
| Mission partielle (Hugo filme les 30 premières min) | Pas de lien créneau-créneau | Lien + ancrage |
| Briefing par artiste (conditions, setlist) | Notes basiques sur créneau | Markdown + pièces jointes |
| Lien artiste-mission cadreur | Pas de relation | source_creneau_id |
| Golden hour / Sunset visible | Pas de méta jour | Champs + calcul auto |
| Saisie rapide d'un planning festival | Tout à saisir bloc par bloc | Drag & drop + import IA |

## Stratégie d'évolution

**Additive et progressive**. Aucun breaking change sur les déroulés
live existants. Toutes les nouvelles features sont opt-in (toggle,
action contextuelle, type de lane).

### Modèle data — extensions proposées

```sql
-- projet_deroules : nouvelles méta contextuelles
ALTER TABLE projet_deroules ADD COLUMN
  golden_hour_start TIME,           -- début golden hour (optionnel)
  golden_hour_end TIME,             -- fin golden hour
  sunset_time TIME,                 -- coucher de soleil
  sunrise_time TIME;                -- lever de soleil (festival multi-jours)

-- projet_deroule_lanes : typage des lanes
ALTER TABLE projet_deroule_lanes
  ADD COLUMN type TEXT NOT NULL DEFAULT 'equipe'
    CHECK (type IN ('global', 'equipe', 'lieu', 'personne')),
  ADD COLUMN membre_id UUID REFERENCES projet_membres(id) ON DELETE SET NULL,
    -- Si type='personne' : lien direct vers le membre. Permet la vue Cadreur
    -- native (les créneaux de cette lane sont auto-assignés à ce membre).
  ADD COLUMN couleur TEXT;
    -- Code couleur de la lane (hex sans #). Hérité par les créneaux qui
    -- n'ont pas de couleur propre. Pour type='personne' → code couleur cadreur.

-- Déverrouiller le cap 5 lanes
ALTER TABLE projet_deroule_lanes
  DROP CONSTRAINT projet_deroule_lanes_sort_order_check;
-- Pas de CHECK sur sort_order — scroll horizontal côté UI gère N lanes.

-- projet_deroule_creneaux : lien créneau-créneau + sous-titre
ALTER TABLE projet_deroule_creneaux
  ADD COLUMN source_creneau_id UUID REFERENCES projet_deroule_creneaux(id) ON DELETE SET NULL,
    -- Le créneau parent (ex: artiste sur scène). NULL = créneau autonome.
  ADD COLUMN source_anchor TEXT
    CHECK (source_anchor IN ('start', 'end', 'free')),
    -- 'start' : enfant suit le DÉBUT du parent (offset fixe, durée propre)
    -- 'end'   : enfant suit la FIN du parent (offset fixe depuis la fin)
    -- 'free'  : lien sémantique seul (notes héritées, pas de propagation)
  ADD COLUMN sous_titre TEXT;
    -- Description courte affichée DANS le bloc en sous-titre, sans clic.
    -- Ex: "BABYLON CIRCUS / CRASH ONLY". Conçu pour rester court (<60 chars).

-- Multi-cadreurs : déjà supporté via projet_deroule_creneau_membres existant
-- (member_ids array). Pas de migration nécessaire — juste enrichir l'UI.

-- Indispos cadreur (table dédiée)
CREATE TABLE projet_deroule_membre_indispos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deroule_id UUID REFERENCES projet_deroules(id) ON DELETE CASCADE,
  membre_id UUID REFERENCES projet_membres(id) ON DELETE CASCADE,
  heure_debut_min INTEGER NOT NULL,
  heure_fin_min INTEGER NOT NULL,
  motif TEXT,  -- 'repas' / 'pause' / 'brief' / texte libre
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Historique des versions du planning
CREATE TABLE projet_deroule_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deroule_id UUID REFERENCES projet_deroules(id) ON DELETE CASCADE,
  version_num INTEGER NOT NULL,
  snapshot JSONB NOT NULL,  -- snapshot complet lanes + créneaux + assignations
  notes TEXT,               -- "modif Babylon décalé de 30min"
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  UNIQUE (deroule_id, version_num)
);
```

### UI — 2 layouts pour la vue Cadreur

**Sur mobile (portrait, <640px)** — vue verticale unique. Pas de
scroll horizontal jamais.

Chaque mission cadreur est une carte verticale :
- Heure début → fin (grand format à gauche)
- Action en titre ("Filmer BABYLON CIRCUS")
- Lieu en sous-titre avec icône
- Sous-titre court hérité du bloc artiste (ex: "CRASH ONLY")
- Pictogrammes pour les notes / pièces jointes / multi-cadreurs
- Badge statut "À faire / En cours / Fait" en mode live

Entre les missions, on intercale :
- Événements de référence du festival pendant les temps morts ("Babylon
  Circus joue 18:30 sur Découverte — pas dans ta journée")
- Repères temporels métier ("Coucher de soleil 21:21", "Golden hour")

Un bouton "Programme festival complet" en haut ouvre un overlay avec
la timetable globale, sans quitter la vue.

**Sur desktop (≥640px)** — layout split :
- Sa journée à gauche (~60% largeur), focus visuel
- Rail global à droite (~40% largeur), scrollable indépendamment
- Permet de croiser visuellement "ma mission Babylon Circus se cale bien
  sur le BABYLON dans le rail global"

## Roadmap par sprints — décisions Hugo

Toutes les sous-features ci-dessous ont été validées (ou refusées)
explicitement par Hugo lors de la conception (mai 2026).

### Sprint 1 — Foundation festival (5-6 jours)

- [ ] Types de lanes (`global` / `equipe` / `lieu` / `personne`)
- [ ] Lien `membre_id` sur lanes type `personne`
- [ ] Déverrouillage cap 5 lanes + scroll horizontal sur desktop
- [ ] **Vue Cadreur** (le gros morceau du sprint)
  - Toggle "Vue : Global / Cadreur ▾" à côté du toggle Timeline/Liste
  - Mobile : layout verticale unique avec contexte intégré
  - Desktop : split sa journée + rail global
  - Accessible aussi depuis la page share global (lien direct par cadreur)
- [ ] Détection de **conflits cadreur** (créneau qui chevauche un autre
      pour le même membre) — badge rouge sur les blocs concernés
- [ ] Compteur de charge dans la **vue Cadreur uniquement** (pas pendant
      l'édition globale, décision Hugo)

### Sprint 2 — Notes + Liens créneaux (4-5 jours)

- [ ] Lien `source_creneau_id` côté SQL
- [ ] 3 modes d'ancrage : `start` / `end` / `free`
  - `start` (défaut) : suit le début du parent, durée fixe
  - `end` : suit la fin du parent, durée fixe
  - `free` : lien sémantique seul (notes héritées, pas de propagation)
- [ ] Propagation automatique au drag/resize du parent
- [ ] **Sous-titre court dans le bloc** (`sous_titre TEXT`) affiché sans
      clic. Ex: "BABYLON CIRCUS / CRASH ONLY"
- [ ] Notes markdown sur créneau (existant à enrichir)
- [ ] **Pièces jointes** sur créneau (PNG/PDF type setlist) — réutilise
      pattern Logistique V0 (bucket Storage + RLS)
- [ ] **Multi-cadreurs sur un créneau** (drone + sol, principal + B-cam)
      — pattern `member_ids` existant à exposer dans l'UI
- [ ] Drawer détail créneau affiche les notes héritées du parent

### Sprint 3 — Construction rapide (3-4 jours)

Actions validées par Hugo :

- [ ] **Drag-and-drop rail artiste → rail cadreur**
  - Drag simple = ancrage `start` + durée artiste
  - Alt+drag = ancrage `end`
  - Shift+drag = ancrage `free`
- [ ] **Clic dans trou cadreur → menu** avec :
  - **En haut** : actions rapides — "Libre (texte vide)" / "Repas" /
    "Pause" / "Story" / "Setup" / "Interview" / "Transit"
  - **En dessous** : liste des artistes disponibles à ce moment
    (filtrés par horaire), avec scène
- [ ] **Right-click sur bloc artiste → "Attribuer à..."** avec menu
      cadreurs filtrés par disponibilité à cet horaire
- [ ] **Copy-paste de créneau** (Cmd+C / Cmd+V)

Refusés par Hugo :
- ~~Multi-sélection puis bulk assign~~
- ~~Suggestion automatique de mission~~
- ~~Auto-équilibrage~~
- ~~Modèles "missions types" en raccourci~~ — intégré directement dans le
  menu du clic (les actions rapides Libre/Repas/Pause/etc. en haut de liste)

### Sprint 4 — Import IA (5-6 jours)

Wizard d'import en 4 étapes :

1. **Upload** : 1 ou N fichiers (PDF, PNG, JPG, Excel)
2. **Analyse IA** via Edge Function Supabase → API Anthropic Claude (vision)
   - Prompt structuré qui retourne JSON normalisé : lanes_lieux,
     events_detected, metadata, warnings, extra_columns_detected
3. **Review interactive** :
   - Renommer / fusionner / supprimer scènes
   - Cocher / décocher événements
   - Sélectionner jour cible si plusieurs jours détectés
   - Garder ou ignorer colonnes parasites (Get In, LoadIn, SoundCheck,
     Change Over selon Marsatac)
   - Valider métadonnées (sunset détecté ?)
4. **Re-essai guidé** : bouton "Pas bon — re-analyser avec consigne libre"
   pour relancer Claude avec instruction custom
5. **Validation finale** + preview timeline + import

Workflow multi-documents :
- Hugo upload N PDFs (1 par scène par exemple)
- Analyse en parallèle
- Fusion des scènes communes
- Hugo voit la fusion et décoche ce qu'il ne veut pas

**Coût** : 5-15 cents par document Claude vision. Acceptable.

**Risques + mitigations** :
- Hallucinations → champ `confidence` côté JSON, surlignage des low-confidence
- Format exotique non détecté → fallback re-essai guidé
- Coût qui dérape → limite "max 5 imports/jour par projet"

### Sprint 5 — Contextuel + polish (3-4 jours)

- [ ] **Golden hour + Sunset + Sunrise** sur le déroulé
  - Calcul automatique à partir de lieu projet + date
  - Côté technique : librairie `suncalc` côté serveur (pas d'API externe
    nécessaire, calcul mathématique pur)
  - Affichage : bande horizontale fine (1px, opacité 40%) sur la timeline
    + info dans le header du jour
  - **OPEN QUESTION** : où stocker le lieu du projet (lat/lng) ?
    - Soit nouveau champ `lieu_lat`, `lieu_lng` sur la table `projects`
    - Soit étendre le champ `lieu_text` existant avec un geocode auto
      (Nominatim gratuit, rate-limited)
    - À trancher au début du sprint
- [ ] **Code couleur par cadreur** — auto-assigné ou choisi, hérité par
      ses créneaux. Visible d'un coup d'œil sur la timetable globale.
- [ ] **Gestion indispos cadreur**
  - Plages "pas dispo" hachurées sur la lane personne
  - Empêche la création de créneaux dedans (avec override explicite +
    warning)
  - Table `projet_deroule_membre_indispos`
- [ ] **Vue par scène** (alternative à vue Cadreur)
  - Mode "Vue : Scène ▾ → Le Château"
  - Affiche la programmation + cadreurs qui y interviennent
  - Utile pour un responsable scène

### Sprint 6 — Régie live (3-4 jours)

- [ ] Statuts par créneau exploités en mode live (existant `statut` :
      `planifie` / `en_cours` / `fait` / `annule`)
- [ ] **Annonces broadcast** : push notif aux cadreurs partageant le
      déroulé via leur lien personnel (refresh visuel sur leur écran +
      éventuellement notif PWA si déjà installé)
- [ ] **Mode "remplacement urgent"** (Hugo : "à prévoir dans un second
      temps", probablement Sprint 6 ou 7)
  - "Remplacer Hugo par ?" → propose cadreurs dispos sur les créneaux
    concernés
  - Migration en bloc avec recalcul des conflits

### Sprint 7 — Historique + polish (2-3 jours)

- [ ] **Historique des versions du planning**
  - Snapshot automatique à chaque modification importante (changement
    horaire majeur, ajout/retrait scène, etc.)
  - Diff visuel "ce qui a changé entre v3 et v4"
  - Affichage pour communication équipe ("Babylon Circus passe de 18:30
    à 19:00, conséquence : Hugo et Logan touchés")
- [ ] Polish + tests + doc

### Refusés / non priorisés (à conserver pour mémoire)

- ~~PDF cadreur~~ (pas utile pour l'instant)
- ~~Flux iCal personnel par cadreur~~ (pas utile)
- ~~Stats post-festival~~ (pas dans cette V1)
- ~~Suivi "rendu temps réel" granulaire par mission~~ (non)
- ~~Compteur de charge en temps réel pendant l'édition globale~~
  (uniquement dans vue Cadreur)
- ~~Suggestion automatique de mission~~
- ~~Auto-équilibrage~~
- ~~Multi-sélection puis bulk assign~~

## Estimation totale

| Sprint | Charge | Cumul |
|---|---|---|
| 1. Foundation | 5-6j | 5-6j |
| 2. Notes + Liens | 4-5j | 9-11j |
| 3. Construction rapide | 3-4j | 12-15j |
| 4. Import IA | 5-6j | 17-21j |
| 5. Contextuel + polish | 3-4j | 20-25j |
| 6. Régie live | 3-4j | 23-29j |
| 7. Historique | 2-3j | **25-32j total** |

**Compressé pour deadline festival proche** : Sprints 1+2+3+4 = 17-21j
pour avoir les essentiels (foundation + liens + saisie rapide + import IA).

## Questions ouvertes

- **Lieu projet pour golden hour** : où stocker lat/lng ? Existe-t-il
  déjà un champ lieu sur `projects` ?
- **Niveau d'intégration avec Équipe** : quand on ajoute un membre du
  crew, est-ce qu'il devient automatiquement disponible comme lane
  "personne" dans le déroulé, ou faut-il action manuelle ?
- **Gestion du multi-jours festival** : 1 déroulé par jour comme
  actuellement, ou un nouveau concept "événement multi-jours" qui
  regroupe N déroulés ?
- **Quand attaquer** : Hugo a-t-il un festival en vue à court terme qui
  justifie de compresser le calendrier ? À demander avant de planifier.

## Historique des décisions

- **2026-05-13** : conception initiale roadmap festival, discussion
  avec Hugo, choix sprints validés, décisions par sous-feature notées.
  Doc créé.
