# CHANTIER — Sprint 5 Festival : Polish (Golden hour + Indispos + Couleurs)

> Objectif : enrichir le déroulé festival avec 3 features de polish utiles
> en production réelle : visualisation du golden hour, gestion des indispos
> cadreurs (sommeil/repos), et personnalisation des couleurs de lanes.

---

## Décisions de cadrage (Hugo, juin 2026)

| Sujet | Décision |
|---|---|
| **Ordre des features** | Golden → Indispos → Couleurs (Vue Scène reportée à un sprint ultérieur) |
| **Golden hour** | Auto via lat/lon. Champ "lieu" dans Settings projet, géocodage Nominatim gratuit (OpenStreetMap), calcul SunCalc local |
| **Indispos** | Créneau type='indispo' dans lane cadreur, rendu hachuré gris, bloque drag/clic create dessus |
| **Couleurs cadreurs** | Color picker dans le lane settings (popover) |
| **Vue Scène** | Reportée — sera évaluée selon usage réel des 3 autres features |

---

## FEST-5.1 — Golden hour visuelle

### Architecture

```
Settings projet              Hook useGoldenHour              Timeline overlay
─────────────────            ────────────────────            ─────────────────
Champ "Lieu" input           projects.lieu_text              <GoldenHourOverlay>
  ↓ blur                     projects.lat                    sunrise band
geocode (Nominatim)          projects.lon                    sunset band
  ↓ lat,lon                  + SunCalc.getTimes              + toggle in toolbar
update projects              → { sunrise, sunset,
                                  goldenHourStart,
                                  goldenHourEnd }
```

### Migration BDD

```sql
ALTER TABLE projects ADD COLUMN IF NOT EXISTS lieu_text TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS lat NUMERIC(9,6);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS lon NUMERIC(9,6);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS geocoded_at TIMESTAMPTZ;
```

- `lieu_text` : saisie libre user (ex: "Vand'B Fest, Vendeuvre-sur-Barse")
- `lat`/`lon` : cache du géocodage (NUMERIC pour précision 6 décimales = ~10cm)
- `geocoded_at` : pour invalider le cache si Hugo change lieu_text

### Géocodage (Nominatim)

**Endpoint** : `https://nominatim.openstreetmap.org/search?format=jsonv2&q=...`

- Pas de clé API
- Rate-limit : 1 req/seconde (largement OK pour un seul projet à la fois)
- Headers : User-Agent obligatoire (sinon 403)
- Retour : array avec `lat`, `lon`, `display_name`

**Helper** : `src/lib/geocode.js`

```js
export async function geocodeAddress(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`
  const r = await fetch(url, {
    headers: { 'User-Agent': 'Captiv/1.0 (contact@captiv.cc)' }
  })
  const data = await r.json()
  if (!Array.isArray(data) || data.length === 0) return null
  return {
    lat: parseFloat(data[0].lat),
    lon: parseFloat(data[0].lon),
    display_name: data[0].display_name,
  }
}
```

### SunCalc

```bash
npm i suncalc
```

```js
import SunCalc from 'suncalc'
const times = SunCalc.getTimes(new Date(date_jour), lat, lon)
// → { sunrise, sunset, goldenHour, goldenHourEnd, sunriseEnd, sunsetStart, ... }
```

### Rendu

`<GoldenHourOverlay>` dans `DerouleTimelineView` :
- 2 bandes horizontales sur toute la timeline (à travers les lanes)
- Couleur : `linear-gradient(rgba(245,158,11,0.10), rgba(245,158,11,0.18))`
- Période **dawn** : sunrise - 30min → sunrise + 30min
- Période **dusk** : sunset - 30min → sunset + 30min
- Z-index sous les blocs (pas cliquable)
- Petit label "🌅 lever 06:32" / "🌇 coucher 21:18" à droite

### Toggle toolbar

Bouton dans la toolbar du DerouleTab : `☀️ Golden`
- État persisté localStorage `deroule.showGoldenHour`
- Visible uniquement si `projects.lat && projects.lon`

### UI Settings projet

Section "Localisation" dans la page Settings du projet :
- Input "Lieu" (libre)
- onBlur : appelle `geocodeAddress`, save lat/lon + geocoded_at
- Affiche en dessous : "✅ Géolocalisé : 48.86°N, 2.35°E" ou "❌ Non trouvé"
- Bouton "Re-géocoder" si besoin

---

## FEST-5.2 — Indispos cadreurs (bloc hachuré)

### Mécanique

Un créneau `type='indispo'` dans une lane de type `personne` (cadreur) représente
une plage où le cadreur n'est pas disponible (sommeil, repas perso, hors-shift).

**Rendu visuel** :
- Pattern hachures gris diagonales (45°)
- Texte vertical "Indispo" ou label custom (sommeil, off, …)
- Pas cliquable pour ouvrir l'inspecteur (juste hover info)
- Bloque le drop d'autres créneaux dessus (drag-and-drop refuse)
- Bloque le clic de création dans cette zone (QuickCreateMenu refuse)

**BDD** : ajout du type 'indispo' aux types autorisés.

```sql
-- Si la colonne type est une enum/check constraint, étendre
ALTER TABLE projet_deroule_creneaux DROP CONSTRAINT IF EXISTS projet_deroule_creneaux_type_check;
ALTER TABLE projet_deroule_creneaux ADD CONSTRAINT projet_deroule_creneaux_type_check
  CHECK (type IN ('install','repas','prise','pause','transport','brief','live','autre','indispo'));
```

### Création

Right-click sur lane cadreur (zone vide) → menu :
- "Indispo / Sommeil ici" → crée un créneau type='indispo' libelle="Indispo"

Ou via création normale, type='indispo' dans le sélecteur.

### Filtrage conflits

L'algo `findMembreOverlaps` (deroule.js) existe déjà. Il faut s'assurer qu'il
prend en compte les créneaux type='indispo' comme des conflits si on tente
d'assigner le cadreur pendant une plage indispo.

---

## FEST-5.3 — Couleurs cadreurs personnalisables — **SKIPPÉ**

> **Décision Hugo (post-FEST-5.2)** : skip. La fonction `effectiveCouleurCreneau`
> calcule déjà la couleur d'un créneau via son TYPE (prise=vert, brief=violet,
> install=bleu…). Un cadreur voit donc le sens du créneau au premier coup d'œil.
> Une couleur custom par lane n'apporterait rien — pire, elle écraserait ce
> code couleur sémantique. Sprint 5 clos avec 2 features sur 3.

### Mécanique (gardée en archive doc si on veut revenir dessus)

La colonne `projet_deroule_lanes.couleur` existe déjà (varchar 6 hex sans #).
Actuellement initialisée par défaut. Il manque juste l'UI pour la modifier.

### UI

Sur le header de chaque lane (timeline), un petit pastille colorée à côté du
libellé. Clic → popover color picker avec 8 couleurs presets + champ custom.

Presets (palette DESK) :
- Bleu `#3B82F6`
- Vert `#22C55E`
- Orange `#F97316`
- Rouge `#EF4444`
- Violet `#A855F7`
- Rose `#EC4899`
- Jaune `#EAB308`
- Cyan `#06B6D4`

Save direct via `updateLane(laneId, { couleur: '3B82F6' })`.

Impact visuel : la bande verticale colorée des créneaux de cette lane prend la
couleur (déjà géré par `effectiveCouleurCreneau()` qui fallback sur la couleur
de la lane si pas de type-couleur dominant).

---

## Sprint 5 — Tickets

| # | Ticket | Estim. |
|---|---|---|
| FEST-5.1 a | Migration BDD `projects` lat/lon/lieu_text | 0.25j |
| FEST-5.1 b | Helper geocode + lib SunCalc + hook useGoldenHour | 0.5j |
| FEST-5.1 c | UI Settings projet (champ lieu + géocodage) | 0.5j |
| FEST-5.1 d | GoldenHourOverlay + toggle toolbar | 1j |
| FEST-5.2 a | Migration BDD type 'indispo' + constraint | 0.25j |
| FEST-5.2 b | Rendu hachuré + bloc dans timeline | 0.5j |
| FEST-5.2 c | Création via right-click + sélecteur type | 0.5j |
| FEST-5.2 d | Blocage drag/drop sur indispo | 0.5j |
| FEST-5.3 | Color picker + update lane | 1j |

**Total estimé** : ~5j

---

## Roadmap Festival globale

| Sprint | Status |
|---|---|
| ✅ Sprint 1 — Foundation | Clos |
| ✅ Sprint 2 — Notes + Liens | Clos |
| ✅ Sprint 3 — Construction rapide | Clos |
| ✅ Sprint 4 — Import IA | Clos |
| ✅ Sprint 5 — Polish (Golden + Indispos) | **Clos** — Couleurs skippées |
| ⏳ Sprint 5b ? — Vue Scène dédiée | Conditionnel à demande |
| ⏳ Sprint 6 — Régie live | À venir |
| ⏳ Sprint 7 — Historique versions | À venir |
