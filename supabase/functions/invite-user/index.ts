/**
 * Edge Function : invite-user
 * ---------------------------
 * Invite un utilisateur à rejoindre CAPTIV.
 *
 * Entrée (JSON) :
 *   {
 *     contact_id: uuid,     // contact à lier (obligatoire)
 *     email:      string,   // email du destinataire
 *     full_name:  string,   // nom complet (optionnel, on tente contact.nom si vide)
 *     role:       string,   // 'prestataire' | 'coordinateur' | 'charge_prod' (défaut: prestataire)
 *     mode:       'email' | 'link',  // email : envoie l'invite ; link : renvoie l'URL
 *   }
 *
 * Sortie :
 *   { success: true, user_id, mode, action_link? }
 *
 * Sécurité :
 *   - L'appelant doit être authentifié (JWT dans l'en-tête Authorization)
 *   - L'appelant doit avoir le rôle 'admin' ou 'charge_prod'
 *   - Le contact doit appartenir à la même org que l'appelant
 *   - Le contact ne doit pas déjà être lié à un user
 */

// @ts-ignore - Deno imports
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'
import { corsHeaders } from '../_shared/cors.ts'

// @ts-ignore - Deno global
declare const Deno: { env: { get(key: string): string | undefined }; serve: (handler: (req: Request) => Promise<Response>) => void }

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  // Préflight CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' })
  }

  try {
    // ── 1. Parse body ────────────────────────────────────────────────────
    const body = await req.json()
    const {
      contact_id,
      email,
      full_name,
      role = 'prestataire',
      mode = 'email',
    } = body || {}

    if (!contact_id || !email) {
      return jsonResponse(400, { error: 'contact_id et email sont requis' })
    }
    if (mode !== 'email' && mode !== 'link') {
      return jsonResponse(400, { error: "mode doit être 'email' ou 'link'" })
    }
    const validRoles = ['prestataire', 'coordinateur', 'charge_prod']
    if (!validRoles.includes(role)) {
      return jsonResponse(400, { error: `role invalide (${validRoles.join(', ')})` })
    }

    // ── 2. Authentification de l'appelant ────────────────────────────────
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return jsonResponse(401, { error: 'Authorization header manquant' })
    }
    // Extraction du JWT (format attendu : "Bearer xxxx")
    const jwt = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (!jwt) {
      return jsonResponse(401, { error: 'JWT manquant dans Authorization header' })
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    // Client admin (service_role) : on l'utilise à la fois pour vérifier
    // le JWT de l'appelant (via getUser(jwt)) et pour les opérations
    // privilégiées (création de user, upsert profile, update contact).
    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // Vérification du JWT : on passe explicitement le token à getUser().
    // C'est la seule façon fiable de vérifier un JWT dans une Edge Function ;
    // un client créé avec global.headers.Authorization ne propage PAS
    // automatiquement le token à getUser() sans argument.
    const { data: userData, error: userErr } = await adminClient.auth.getUser(jwt)
    if (userErr || !userData?.user) {
      return jsonResponse(401, {
        error: 'Token invalide : ' + (userErr?.message || 'user null'),
      })
    }
    const callerId = userData.user.id

    // ── 3. Vérifier le profil de l'appelant ──────────────────────────────
    const { data: callerProfile, error: callerErr } = await adminClient
      .from('profiles')
      .select('id, role, org_id, full_name')
      .eq('id', callerId)
      .single()

    if (callerErr || !callerProfile) {
      return jsonResponse(403, { error: 'Profil appelant introuvable' })
    }
    if (!['admin', 'charge_prod'].includes(callerProfile.role)) {
      return jsonResponse(403, { error: 'Seuls les admins et chargés de prod peuvent inviter' })
    }
    if (!callerProfile.org_id) {
      return jsonResponse(400, { error: 'Appelant non rattaché à une org' })
    }

    // ── 4. Vérifier le contact cible ─────────────────────────────────────
    const { data: contact, error: ctErr } = await adminClient
      .from('contacts')
      .select('id, nom, prenom, org_id, user_id, email')
      .eq('id', contact_id)
      .single()

    if (ctErr || !contact) {
      return jsonResponse(404, { error: 'Contact introuvable' })
    }
    if (contact.org_id !== callerProfile.org_id) {
      return jsonResponse(403, { error: "Ce contact n'appartient pas à votre organisation" })
    }
    if (contact.user_id) {
      return jsonResponse(400, { error: 'Ce contact est déjà lié à un compte' })
    }

    // Nom final : full_name reçu OU "prenom nom" du contact
    const finalName =
      full_name ||
      [contact.prenom, contact.nom].filter(Boolean).join(' ').trim() ||
      email

    // Métadonnées stockées sur le user Auth (user_metadata)
    const metadata = {
      full_name: finalName,
      org_id: callerProfile.org_id,
      role,
      contact_id,
      invited_by: callerId,
    }

    // URL de redirection après vérification du token Supabase. On calcule
    // l'origine à partir des headers Origin / Referer de la requête pour
    // que le lien pointe vers /accept-invite (formulaire "Définir mot de
    // passe") au lieu de la racine du site. Si non détectable, on omet
    // l'option et Supabase utilise la Site URL par défaut.
    const origin = req.headers.get('origin') || req.headers.get('referer') || ''
    const cleanOrigin = origin.replace(/\/$/, '').replace(/\/accept-invite.*$/, '')
    const redirectTo = cleanOrigin
      ? `${cleanOrigin}/accept-invite`
      : undefined

    // ── 5. Vérifier qu'aucun user auth n'existe déjà avec cet email ──────
    // (on laisse Supabase renvoyer l'erreur si c'est le cas, c'est plus fiable
    // que de scanner auth.users depuis ici)

    // ── 6. Création du user + génération de l'invite ─────────────────────
    let newUserId: string
    let actionLink: string | null = null

    if (mode === 'link') {
      // Génère le lien sans envoyer d'email. Si le user n'existe pas, il est
      // créé au passage.
      const { data, error } = await adminClient.auth.admin.generateLink({
        type: 'invite',
        email,
        options: { data: metadata, redirectTo },
      })
      if (error) return jsonResponse(400, { error: 'generateLink: ' + error.message })
      newUserId = data.user?.id || ''
      // @ts-ignore - action_link existe dans la réponse
      actionLink = data.properties?.action_link || null
    } else {
      const { data, error } = await adminClient.auth.admin.inviteUserByEmail(
        email,
        { data: metadata, redirectTo },
      )
      if (error) return jsonResponse(400, { error: 'inviteUserByEmail: ' + error.message })
      newUserId = data.user?.id || ''
    }

    if (!newUserId) {
      return jsonResponse(500, { error: "Création du user échouée (id manquant)" })
    }

    // ── 7. Création du profil (upsert pour tolérer un trigger éventuel) ──
    const { error: profErr } = await adminClient
      .from('profiles')
      .upsert(
        {
          id: newUserId,
          org_id: callerProfile.org_id,
          full_name: finalName,
          role,
        },
        { onConflict: 'id' },
      )
    if (profErr) {
      return jsonResponse(500, { error: 'Création profil : ' + profErr.message })
    }

    // ── 8. Liaison contact ↔ user ────────────────────────────────────────
    const { error: linkErr } = await adminClient
      .from('contacts')
      .update({ user_id: newUserId })
      .eq('id', contact_id)
    if (linkErr) {
      return jsonResponse(500, { error: 'Liaison contact : ' + linkErr.message })
    }

    // ── 9. Succès ────────────────────────────────────────────────────────
    return jsonResponse(200, {
      success: true,
      user_id: newUserId,
      mode,
      action_link: actionLink,
      email,
      full_name: finalName,
      role,
    })
  } catch (err) {
    console.error('[invite-user] uncaught:', err)
    return jsonResponse(500, { error: (err as Error).message || 'Erreur inconnue' })
  }
})
