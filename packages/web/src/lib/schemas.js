/**
 * Schémas de validation Zod — règles métier centralisées.
 *
 * Chaque formulaire de l'app utilise un schéma défini ici.
 * Avantages :
 *  - Les règles (email valide, SIRET 14 chiffres, etc.) sont en un seul endroit
 *  - Les messages d'erreur sont en français et cohérents
 *  - On peut réutiliser les mêmes schémas côté test si besoin
 *
 * Usage dans un composant :
 *   import { projectSchema } from '@/lib/schemas'
 *   import { useFormValidation } from '@/hooks/useFormValidation'
 *
 *   const { errors, validate, clearErrors } = useFormValidation(projectSchema)
 *   // dans le handleSubmit :
 *   if (!validate(form)) return
 */
import { z } from 'zod'

// ─── Helpers réutilisables ───────────────────────────────────────────────────

/** Champ string optionnel : vide → null, sinon on trim */
const optionalString = z
  .string()
  .trim()
  .transform((v) => v || null)
  .nullable()
  .optional()

/** Email optionnel mais validé si rempli */
const optionalEmail = z
  .string()
  .trim()
  .transform((v) => v || null)
  .nullable()
  .optional()
  .refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), {
    message: 'Email invalide',
  })

/** Téléphone optionnel : format libre mais au moins 8 chiffres si rempli */
const optionalPhone = z
  .string()
  .trim()
  .transform((v) => v || null)
  .nullable()
  .optional()
  .refine((v) => !v || v.replace(/[\s.\-()]/g, '').length >= 8, {
    message: 'Numéro trop court (min. 8 chiffres)',
  })

/** SIRET optionnel : 14 chiffres (avec ou sans espaces) si rempli */
const optionalSiret = z
  .string()
  .trim()
  .transform((v) => v || null)
  .nullable()
  .optional()
  .refine((v) => !v || /^\d{14}$/.test(v.replace(/\s/g, '')), {
    message: 'SIRET invalide (14 chiffres attendus)',
  })

// ─── Schéma : Création de projet ─────────────────────────────────────────────
export const projectSchema = z.object({
  title: z
    .string()
    .trim()
    .min(2, 'Le titre doit faire au moins 2 caractères')
    .max(120, 'Le titre est trop long (max 120 caractères)'),
  client_id: optionalString,
  status: z.string().min(1, 'Statut requis'),
  description: optionalString,
  date_debut: optionalString,
  date_fin: optionalString,
})

// ─── Schéma : Client ─────────────────────────────────────────────────────────
export const clientSchema = z.object({
  nom_commercial: z
    .string()
    .trim()
    .min(2, 'Le nom commercial doit faire au moins 2 caractères')
    .max(120, 'Nom commercial trop long'),
  raison_sociale: optionalString,
  type_client: z.string().min(1, 'Type requis'),
  statut: z.string().min(1, 'Statut requis'),
  contact_name: optionalString,
  contact_fonction: optionalString,
  email: optionalEmail,
  email_facturation: optionalEmail,
  phone: optionalPhone,
  address: optionalString,
  code_postal: optionalString,
  ville: optionalString,
  pays: optionalString,
  siret: optionalSiret,
  tva_number: optionalString,
  notes: optionalString,
})

// ─── Schéma : Contact ────────────────────────────────────────────────────────
export const contactSchema = z.object({
  nom: z
    .string()
    .trim()
    .min(1, 'Le nom est obligatoire')
    .max(80, 'Nom trop long'),
  prenom: optionalString,
  date_naissance: optionalString,
  email: optionalEmail,
  telephone: optionalPhone,
  address: optionalString,
  code_postal: optionalString,
  ville: optionalString,
  pays: optionalString,
  regime: z.string().min(1, 'Régime obligatoire'),
  specialite: optionalString,
  taille_tshirt: optionalString,
  regime_alimentaire: optionalString,
  permis: z.boolean().optional().default(false),
  vehicule: z.boolean().optional().default(false),
  tarif_jour_ref: z
    .union([z.string(), z.number()])
    .optional()
    .nullable()
    .transform((v) => {
      if (v == null || v === '') return null
      const n = Number(v)
      return isNaN(n) ? null : n
    })
    .refine((v) => v == null || v >= 0, {
      message: 'Le tarif ne peut pas être négatif',
    }),
  iban: optionalString,
  siret: optionalSiret,
  notes: optionalString,
  actif: z.boolean().optional().default(true),
  default_tva: z.union([z.string(), z.number()]).optional().default(0),
  user_id: optionalString,
})

// ─── Schéma : Produit BDD ────────────────────────────────────────────────────
export const produitSchema = z.object({
  ref: optionalString,
  categorie: optionalString,
  produit: z
    .string()
    .trim()
    .min(1, 'Le nom du poste est obligatoire')
    .max(120, 'Nom trop long'),
  description: optionalString,
  unite: z.string().min(1, 'Unité requise'),
  tarif_defaut: z
    .union([z.string(), z.number()])
    .optional()
    .nullable()
    .transform((v) => {
      if (v == null || v === '') return null
      const n = Number(v)
      return isNaN(n) ? null : n
    })
    .refine((v) => v == null || v >= 0, {
      message: 'Le tarif ne peut pas être négatif',
    }),
  notes: optionalString,
  actif: z.boolean().optional().default(true),
})

// ─── Schéma : Fournisseur ────────────────────────────────────────────────────
export const fournisseurSchema = z.object({
  nom: z
    .string()
    .trim()
    .min(1, 'Le nom est obligatoire')
    .max(120, 'Nom trop long'),
  type: optionalString,
  siret: optionalSiret,
  email: optionalEmail,
  phone: optionalPhone,
  notes: optionalString,
  default_tva: z.union([z.string(), z.number()]).optional().default(20),
})
