/**
 * cotisations — moteur de calcul devis (lignes, synthèse, taux, formats).
 *
 * ⚠️ La source vit désormais dans packages/shared/src/lib/cotisations.js
 * (chantier app bi-mode : le mobile calcule exactement comme le web).
 * Ce fichier n'est qu'une façade de ré-export pour ne pas toucher aux
 * ~28 imports existants côté web.
 */
export * from '@captiv/shared/lib/cotisations'
