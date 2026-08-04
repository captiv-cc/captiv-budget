# MUS-7 — Tunnel Autorisations (V2)

> **Statut** : à cadrer en V2, après stabilisation du workflow Musique-Livrables (MUS-6).
> **Date d'ouverture** : 2026-06-09
> **Owner** : Hugo MARTIN

## Nouveaux inputs Hugo (2026-08-04)

Précision majeure sur QUI opère le tunnel : ce ne sont pas (que) les clients —
ce sont les **chargés de comm / RP du festival** qui lancent les demandes
d'autorisation auprès des artistes/labels, mettent à jour le suivi et
commentent. Il faut donc une **page qui leur est accessible** (externe à
l'équipe Captiv), probablement un lien token en lecture-ÉCRITURE limitée
(pattern share_creneau_set_statut du déroulé).

Référence produit : le tableur de suivi utilisé sur V and B Fest' 2025
(colonnes : ARTISTE / TITRE / LIEN / jour / média / DURÉE / REMARQUES /
UTILISÉ ? / AUTOR ? (OUI · EN COURS · NON) / DOC SIGNÉ / COMMENTAIRE /
MASTER — groupé par séquence du film, sous un bandeau média « AFTERMOVIE »).

Deuxième besoin : **partage en lecture configurable par lien** — au choix,
les musiques *choisies*, *proposées* ou *validées* pour **chaque média**
(= statut_local des links par livrable). Pattern multi-tokens avec config
par lien (comme logistique_share_tokens).

## Contexte

Le module Musiques se découpe en plusieurs phases successives :

1. **Phase Vrac** (✅ fait, MUS-1 à MUS-5) — collecte libre de propositions
2. **Phase Attribution par livrable** (✅ fait, MUS-6) — proposition / choix / validé en interne
3. **Phase Autorisations** (🟦 V2, ce document) — validation client + droits/labels/presse
4. (potentiellement) Phase Intégration — track effectivement dans le montage final

À la fin de la phase Attribution, une track est "validée" en interne pour un livrable
donné. Ça veut dire : l'équipe interne a tranché, c'est elle qu'on veut. Mais ça ne suffit
pas pour pouvoir l'utiliser. Il reste **deux portes à franchir** :

- **Validation client** : le client (= commanditaire du projet) approuve ou rejette le
  choix interne. Peut donner lieu à un aller-retour (le client demande une autre piste,
  l'équipe re-propose).
- **Droits / sync clearance** : négocier avec le label ou l'éditeur pour obtenir le droit
  d'utiliser la track dans le livrable (souvent payant). Peut échouer (refus, prix trop
  élevé), ce qui ramène à reproposer une autre track au client.

Ces deux étapes ne sont pas indépendantes :

- On peut négocier les droits SANS validation client (en parallèle pour gagner du temps,
  surtout sur des labels lents)
- Mais on ne signe / paie pas tant que les deux ne sont pas alignés
- Si le client rejette, ça abandonne la négociation droits (perte de temps mais pas
  d'argent)
- Si les droits sont refusés, ça force à retourner au client avec une autre option

C'est donc un **petit workflow à plusieurs canaux** par couple track+livrable, qu'il
faut tracer.

## Besoins identifiés (à compléter)

### Côté validation client
- [ ] Notifier le client qu'on a une track à valider (email ? lien public ?)
- [ ] Le client peut écouter le preview + accepter/refuser/commenter
- [ ] Si refuse : commentaire explicatif → revient en "Choix" pour reproposer
- [ ] Historique des allers-retours (qui a dit quoi quand)
- [ ] Validation finale = la track est OK côté client (mais reste à clearer côté droits)

### Côté droits / labels
- [ ] Suivi de l'état de la négociation par track+livrable :
  - À contacter
  - En négociation
  - Devis reçu
  - Accordé (avec contrat)
  - Refusé (avec raison)
- [ ] Contact label/éditeur (nom, email, téléphone)
- [ ] Deadlines de réponse (pour relancer)
- [ ] Fees (prix proposé / négocié / final)
- [ ] Référence contrat / preuve de paiement
- [ ] Type de droits : sync, mécanique, streaming, etc. (selon le livrable et son canal
      de diffusion)

### Côté équipe interne
- [ ] Tableau de bord centralisé "Que faut-il valider/négocier cette semaine ?"
- [ ] Alertes deadlines proches
- [ ] Vue par track : tous les livrables où elle est utilisée et leur état d'autorisation
- [ ] Vue par livrable : toutes les tracks et leur statut d'autorisation

## Questions ouvertes pour le cadrage

1. **Granularité** : on suit l'autorisation par couple track+livrable (la même track peut
   être autorisée pour le Master mais refusée pour la Story Insta — droits différents
   selon le canal). Confirmer.

2. **Validation client : interne ou externe ?**
   - **Interne** : le client a un compte dans Captiv (admin / collaborateur), valide
     dans l'app
   - **Externe** : on lui envoie un lien public tokenisé (style Frame.io), il valide
     sans compte
   - **Mix** : selon le client

3. **Lien public client** : si externe, quoi inclure dans la page partagée ?
   - Preview Deezer 30s ? Track complète ? YouTube full ?
   - Plusieurs tracks à valider d'un coup (batch) ou une à la fois ?
   - Possibilité de noter / commenter ?

4. **Tunnel droits — manuel ou semi-automatisé ?**
   - **Manuel** : on tape tout (contacts, devis, contrats)
   - **Semi-auto** : connecteur API vers une base de licences (Soundreef, BMI, etc.) ?
     C'est probablement trop ambitieux pour V2.

5. **Stockage des documents** : devis PDF, contrats signés, preuves de paiement → où ?
   - Supabase Storage ?
   - Lien externe (Drive / Dropbox) collé en métadonnée ?

6. **Notifications** :
   - Email automatique au client à chaque changement de statut ?
   - Email à l'équipe quand le client répond ?
   - Notifications in-app uniquement ?

7. **Intégration avec les modules existants** :
   - Les tracks **accordées** (validé client + droits OK) entrent dans une potentielle
     5e phase "Intégrées au montage" ? Ou ça reste au niveau Livrables qu'on coche
     "track utilisée" ?
   - Lien avec Budget réel : les fees négociés alimentent la ligne budgétaire musique
     du projet ?

## Contraintes techniques

### BDD
- Probablement une nouvelle table `projet_musique_autorisations` avec un FK vers
  `projet_musique_livrable_link.id` (one-to-one pour V1, multi-droits pour V2 si
  on distingue sync/mécanique/etc.)
- Sous-champs probables : statut, contact_label, deadline, fee_proposed, fee_final,
  contrat_url, validation_client_status, validation_client_comments
- RLS héritée du link → livrable → projet
- Historique : table `projet_musique_autorisations_log` pour tracer les changements ?

### UI
- Nouvel onglet "Autorisations" dans le view switcher du module Musiques (déjà placeholder
  "à venir")
- Probablement une grille / kanban par état de négociation
- Section "Validation client" dans le drawer prop (similaire à "Utilisée dans" mais
  pour le statut client)
- Email templates pour les notifications

### Sécurité / privacy
- Si lien public client : token tokenisé avec scope limité, expiration, révocable
- Contrats stockés : autorisation de download stricte (RLS)
- RGPD : conservation des données client (emails, etc.) limitée

## Options d'architecture envisagées

### Option A — Minimaliste manuel
- 1 table `projet_musique_autorisations` avec quelques champs texte libre
- Tous les statuts gérés manuellement par l'équipe
- Pas de notification email, pas de lien public
- Avantage : 1 semaine de dev
- Inconvénient : peu d'automatisation, friction usage

### Option B — Tunnel client externe + suivi droits manuel
- Lien public client tokenisé (pattern Livrables share existant)
- Page publique : liste des tracks à valider par livrable + boutons accepter/refuser
- Notifications email basiques
- Suivi droits manuel comme Option A
- Avantage : friction client réduite, déjà la moitié de la valeur
- Inconvénient : pas de mémoire institutionnelle sur les négociations droits

### Option C — Stack complète intégrée
- Option B + suivi droits structuré (contacts, deadlines, devis, contrats)
- Dashboard alertes deadlines
- Stockage docs en Supabase Storage
- Avantage : workflow industriel complet
- Inconvénient : 3-4 semaines de dev, plus de surface de bug

## Prochaine étape

Avant de coder, **séance de cadrage avec Hugo + équipe** pour répondre aux questions
ouvertes ci-dessus et choisir une option d'architecture. Ne pas commencer à coder tant
que la sémantique métier n'est pas claire.

### Inputs à apporter en séance
- Exemples concrets de validations client passées (mails, allers-retours)
- Exemples de contrats sync (formats, durées, montants)
- Liste des labels avec qui on bosse régulièrement (pour cadrer le formulaire contact)
- Volumes typiques par projet (combien de tracks à clearer, combien d'allers-retours)

## Liens utiles

- Migration BDD livrable_link : `supabase/migrations/20260609a_musique_livrable_link.sql`
- Migration BDD statut_local 3 stades : `supabase/migrations/20260609c_musique_link_statut_local_3_stades.sql`
- Vue Livrables (où vivront les tracks "validé" → entrant dans Autorisations) :
  `src/features/musiques/LivrablesView.jsx`
- Placeholder UI onglet : MusiquesTab — `viewMode === 'autorisations'` (actuellement
  disabled avec badge "à venir")
