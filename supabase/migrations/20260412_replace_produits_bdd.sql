-- Remplacement complet des éléments produits_bdd pour CAPTIV (ZQSD)
-- Source : BDD ITEMS.xlsx — 2026-04-12

-- ÉTAPE 1 : Supprimer tous les éléments existants de l'org
DELETE FROM produits_bdd WHERE org_id = '222868b2-aced-4cc1-b98d-e0337b571462';

-- ÉTAPE 2 : Insérer les nouveaux éléments
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Production', 'Direction Artistique', NULL, 'F', 800.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Production', 'Conception', NULL, 'F', 400.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Production', 'Storyboard', NULL, 'F', 950.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Production', 'Accompagnement et suivi de projet', NULL, 'F', 400.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Production', 'Repérages', NULL, 'F', NULL, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Production', 'Casting', NULL, 'F', NULL, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Production', 'Démarches admninistratives', 'Préparation du tournage, plannification, administratif, demandes d''autorisations', 'F', 400.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Production', 'Protocole aérien, Autorisations, Administratif', 'Dont demandes d''autorisation de vol auprès de : Préfecture/Agglomération/Militaire/CTR/Mairie/Gestionnaires des lieux de tournages', 'F', 400.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Humain', 'Comédien.ne', NULL, 'J', NULL, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Humain', 'Comédien.ne 2nd rôle', NULL, 'J', NULL, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Humain', 'Figurant.e', NULL, 'J', NULL, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Humain', 'Silouhette', NULL, 'J', NULL, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Humain', 'Doublure', NULL, 'J', NULL, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Humain', 'Comédien.e - Enfant', NULL, 'J', NULL, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Humain', 'Figurant.e - Enfant', NULL, 'J', NULL, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Humain', 'Silouhette - Enfant', NULL, 'J', NULL, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Humain', 'Doublure - Enfant', NULL, 'J', NULL, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Humain', 'Réalisateur', NULL, 'J', 800.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Humain', 'Réalisateur (droits)', NULL, 'J', NULL, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Humain', 'Photographe', NULL, 'J', 550.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Humain', 'Photographe (droits)', NULL, 'J', NULL, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Humain', 'Chef opérateur', NULL, 'J', 700.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Humain', 'Cadreur', NULL, 'J', 550.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Humain', '1er Assistant caméra', NULL, 'J', 450.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Humain', '2nd Assistant caméra', NULL, 'J', 400.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Humain', '1er Assistant réalisateur', NULL, 'J', 450.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Humain', '2nd Assistant réalisateur', NULL, 'J', 400.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Humain', 'Technicien image', NULL, 'J', 400.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Humain', 'Chef opérateur son', NULL, 'J', 500.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Humain', 'Photographe de plateau (BTS)', NULL, 'J', 500.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Humain', 'Vidéaste Making Of', NULL, 'J', 500.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Humain', 'Maquilleur', NULL, 'J', 400.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Humain', 'Machiniste', NULL, 'J', 450.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Humain', 'Chef électricien', NULL, 'J', 450.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Humain', 'Électricien', NULL, 'J', 400.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Humain', 'Chef décorateur', NULL, 'J', 450.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Humain', 'Styliste', NULL, 'J', 450.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Humain', 'Régisseur général', NULL, 'J', 400.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Humain', 'Régisseur adjoint', NULL, 'J', 350.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Humain', 'Technicien montage/démontage', NULL, 'J', 350.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Humain', 'Opérateur médias', NULL, 'J', 400.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Humain', 'Opérateur PTZ', NULL, 'J', 450.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Humain', 'Directeur de production', NULL, 'J', 600.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Humain', 'Chargé de production', NULL, 'J', 500.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Humain', 'Chef d''équipement', NULL, 'J', 550.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Humain', 'Post-producteur', NULL, 'J', 550.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Humain', 'Directeur de post-production', NULL, 'J', 600.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Humain', 'Chargé de post-production', NULL, 'J', 500.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Humain', 'Monteur', NULL, 'J', 550.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Humain', 'Assitant monteur', NULL, 'J', 450.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Humain', 'Motion designer', NULL, 'J', 550.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Humain', 'Étalonneur', NULL, 'J', 700.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Humain', 'Superviseur VFX', NULL, 'J', 700.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Humain', 'CG & Compositing artist', NULL, 'J', 700.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Humain', 'Mixeur Son', NULL, 'J', 600.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Humain', 'Compositeur', NULL, 'J', 700.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Humain', 'Sound Designer', NULL, 'J', 500.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Humain', 'Ingénieur Vision', NULL, 'J', 700.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Humain', 'Télépilote drone', NULL, 'J', 900.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Humain', 'Directeur technique', NULL, 'J', 700.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Humain', 'Steadycamer', NULL, 'J', 1000.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Humain', 'Opérateur Grue', NULL, 'J', 600.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Humain', 'Opérateur CableCam', NULL, 'J', 600.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Humain', 'Réalisateur Live', NULL, 'J', 550.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Humain', 'Final Cut', NULL, 'J', 450.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Humain', 'Assistant de production', NULL, 'J', 400.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Humain', 'Chauffeur', NULL, 'J', 350.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Humain', 'Producteur', NULL, 'J', 700.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Humain', 'Assistant vidéo', NULL, 'J', 400.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Humain', 'DIT', NULL, 'J', 600.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Humain', 'Runner', NULL, 'J', 350.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Post-production', 'Retouches photo', NULL, 'F', NULL, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Post-production', 'Habillage graphique', NULL, 'F', NULL, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Post-production', 'Sous-titrage', NULL, 'F', NULL, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Post-production', 'License musique', NULL, 'F', NULL, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Post-production', 'Frais de post-production', 'Machines + Licences
Stockage et archivage
Divers', 'F', NULL, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Post-production', 'Déclinaisons et versioning', NULL, 'F', NULL, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Post-production', 'Rendu des livrables', NULL, 'F', NULL, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Frais', 'Indemnités kilométriques', NULL, NULL, NULL, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Frais', 'Repas', NULL, NULL, 25.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Frais', 'Hébergement', NULL, NULL, 110.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Frais', 'Jours de voyage / Travel day', NULL, NULL, 300.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Frais', 'Billets de train / Avion', NULL, NULL, 120.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Frais', 'Locaton véhicule', NULL, 'J', 110.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Frais', 'Fraix Taxi / Uber', NULL, 'F', NULL, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Moyen technique', 'Pack caméra FX6 "base"', 'Caméra Sony ILME-FX6
Moniteur BM VideoAssist 5"
Poignée XLR + Poignée latérale + Viseur
2x VLOCK NanoTwo 98Wh
1x Carte SD Sony V90 128Go
Trépied à tête fluide
Câbles + Accessoires', 'J', 170.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Moyen technique', 'Pack caméra FX6 "complet"', 'Caméra Sony ILME-FX6
Moniteur BM VideoAssist 5"
Poignée XLR + Poignée latérale + Viseur
2x VLOCK NanoTwo 98Wh
1x Carte SD Sony V90 128Go
Trépied à tête fluide
Câbles + Accessoires
Micro HF Sennheiser
Optique SONY 16-35mm/2.8', 'J', 210.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Moyen technique', 'Caméra SONY FX6', NULL, 'J', 130.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Moyen technique', 'Caméra SONY FX3', NULL, 'J', 110.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Moyen technique', 'Caméra SONY FX9', NULL, 'J', 160.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Moyen technique', 'Caméra SONY FR-7', NULL, 'J', 400.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Moyen technique', 'Caméra SONY type a7iv', NULL, 'J', 90.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Moyen technique', 'Caméra GoPro', NULL, 'J', 60.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Moyen technique', 'Caméra UHD', NULL, 'J', NULL, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Moyen technique', 'Caméra Cinema UHD', NULL, 'J', NULL, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Moyen technique', 'Optique G-MASTER', NULL, 'J', 60.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Moyen technique', 'Optique Broadcast/Ciné', NULL, 'J', 350.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Moyen technique', 'Série Optiques Ciné', NULL, 'J', 550.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Moyen technique', 'Metabones PL-E', NULL, 'J', 30.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Moyen technique', 'Multiplicateur Focale', NULL, 'J', NULL, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Moyen technique', 'Accessoires caméra - Divers', NULL, 'J', NULL, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Moyen technique', 'RONIN S3 PRO', NULL, 'J', 50.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Moyen technique', 'RONIN M', NULL, 'J', 90.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Moyen technique', 'Trépied cam léger', NULL, 'J', 20.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Moyen technique', 'Trépied cam lourd', NULL, 'J', 60.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Moyen technique', 'Dolly', NULL, 'J', 20.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Moyen technique', 'Machinerie diverse', NULL, 'J', NULL, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Moyen technique', 'HF Vidéo 1080p', NULL, 'J', 90.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Moyen technique', 'HF Vidéo 4K', NULL, 'J', 60.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Moyen technique', 'Moniteur 5''''', NULL, 'J', 30.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Moyen technique', 'Moniteur 7''''', NULL, 'J', 50.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Moyen technique', 'Moniteur 19''''', NULL, 'J', 90.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Moyen technique', 'Moniteur', NULL, 'J', NULL, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Moyen technique', 'Follow focus HF', NULL, 'J', 50.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Moyen technique', 'Micro Cravate HF', NULL, 'J', 40.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Moyen technique', 'Micro Main HF', NULL, 'J', 40.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Moyen technique', 'Table mixage son', NULL, 'J', 90.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Moyen technique', 'Enregistreur son / Mixette', NULL, 'J', 40.0, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Moyen technique', 'Pack "Lights"', NULL, 'J', NULL, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Moyen technique', 'Sources LED', NULL, 'J', NULL, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Moyen technique', 'Bijoute light', NULL, 'J', NULL, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Moyen technique', 'Grip Light', NULL, 'J', NULL, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Moyen technique', 'Light', NULL, 'J', NULL, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Moyen technique', 'Location matériel', NULL, 'F', NULL, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Moyen technique', 'Sous location - Assurance', NULL, 'F', NULL, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Moyen technique', 'Sous location - Transport', NULL, 'F', NULL, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Moyen technique', 'ADD Moyen technique', NULL, NULL, NULL, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Humain', 'ADD Humain', NULL, NULL, NULL, NULL, NULL, true);
INSERT INTO produits_bdd (org_id, categorie, produit, description, unite, tarif_defaut, ref, notes, actif) VALUES ('222868b2-aced-4cc1-b98d-e0337b571462', 'Frais', 'ADD Frais', NULL, NULL, NULL, NULL, NULL, true);

-- Vérification
SELECT categorie, count(*) FROM produits_bdd WHERE org_id = '222868b2-aced-4cc1-b98d-e0337b571462' GROUP BY categorie ORDER BY categorie;