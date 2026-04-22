# Template email : invitation CAPTIV

Ce document explique comment personnaliser le mail d'invitation envoyé par
Supabase quand on invite un contact depuis CAPTIV (Chantier 4C.2).

## Où configurer

Supabase Dashboard → **Authentication → Emails → Invite user**

(ou via URL : `https://supabase.com/dashboard/project/{TON_PROJECT}/auth/templates`)

## Variables disponibles

Supabase expose ces variables dans le template :

- `{{ .ConfirmationURL }}` — lien magique pour accepter l'invitation (obligatoire)
- `{{ .Email }}` — email du destinataire
- `{{ .Data.full_name }}` — nom complet passé dans le metadata par l'Edge Function
- `{{ .Data.role }}` — rôle assigné (prestataire / coordinateur / charge_prod)
- `{{ .SiteURL }}` — URL du site (depuis Settings → Auth → Site URL)

## Template HTML proposé (à coller dans Supabase)

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Invitation CAPTIV</title>
  </head>
  <body style="margin:0; padding:0; background:#f5f5f7; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color:#1d1d1f;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f7; padding:40px 20px;">
      <tr>
        <td align="center">
          <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,.08);">

            <!-- Header -->
            <tr>
              <td style="padding:32px 40px 24px; text-align:center; border-bottom:1px solid #f0f0f2;">
                <div style="font-size:22px; font-weight:700; letter-spacing:-0.5px; color:#1d1d1f;">
                  CAPTIV
                </div>
                <div style="font-size:12px; color:#86868b; margin-top:2px;">
                  Production audiovisuelle · OMNI FILMS
                </div>
              </td>
            </tr>

            <!-- Corps -->
            <tr>
              <td style="padding:32px 40px;">
                <h1 style="font-size:20px; font-weight:600; margin:0 0 12px; color:#1d1d1f;">
                  Bonjour{{ if .Data.full_name }} {{ .Data.full_name }}{{ end }},
                </h1>
                <p style="font-size:14px; line-height:1.6; color:#424245; margin:0 0 24px;">
                  Vous avez été invité(e) à rejoindre <strong>CAPTIV</strong>, notre
                  plateforme de gestion de projets audiovisuels. Cliquez sur le bouton
                  ci-dessous pour activer votre compte et définir votre mot de passe.
                </p>

                <div style="text-align:center; margin:32px 0;">
                  <a href="{{ .ConfirmationURL }}"
                     style="display:inline-block; background:#0071e3; color:#ffffff; text-decoration:none; padding:12px 28px; border-radius:10px; font-size:14px; font-weight:500;">
                    Activer mon compte
                  </a>
                </div>

                <p style="font-size:12px; line-height:1.5; color:#86868b; margin:24px 0 0;">
                  Si le bouton ne fonctionne pas, copiez-collez ce lien dans votre navigateur :
                </p>
                <p style="font-size:11px; color:#86868b; word-break:break-all; margin:4px 0 0;">
                  {{ .ConfirmationURL }}
                </p>
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td style="padding:20px 40px; background:#fafafc; border-top:1px solid #f0f0f2; text-align:center;">
                <p style="font-size:11px; color:#86868b; margin:0; line-height:1.5;">
                  Ce lien est valable 24h. S'il a expiré, demandez un nouveau lien à votre contact CAPTIV.
                </p>
                <p style="font-size:11px; color:#86868b; margin:8px 0 0;">
                  © CAPTIV · SARL OMNI FILMS
                </p>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
```

## Subject proposé

```
Invitation à rejoindre CAPTIV
```

## Étapes à suivre dans le dashboard

1. Ouvrir Supabase Dashboard → ton projet CAPTIV
2. Menu de gauche → **Authentication** → **Emails**
3. Onglet **Invite user**
4. Coller le subject et le HTML ci-dessus
5. **Save** en bas
6. Tester en invitant un contact depuis l'app (page Contacts → éditer → Envoyer email)

## Notes

- Le lien `{{ .ConfirmationURL }}` est composé par Supabase Auth à partir du
  **Site URL** configuré dans Dashboard → Authentication → URL Configuration.
  **Si ce champ est resté sur `http://localhost:5173` (valeur dev par défaut),
  TOUS les mails d'invitation et de reset password partiront avec un lien
  localhost.** Il faut impérativement le basculer sur l'URL de prod.
- Le `redirect_to` passé par l'Edge Function est superposé au Site URL. L'Edge
  Function prend sa valeur dans cet ordre :
    1. `PUBLIC_SITE_URL` (env var du projet Supabase, à positionner avec
       `supabase secrets set PUBLIC_SITE_URL=https://captiv.cc` par exemple).
    2. Header `origin` de la requête (fallback dev).
    3. Header `referer` (dernier recours).
  Pour éviter que des invitations lancées depuis un admin en local partent
  avec un redirect `http://localhost:5173/accept-invite`, on pose
  `PUBLIC_SITE_URL` côté secrets.
- URLs à whitelister dans Dashboard → Authentication → URL Configuration →
  **Redirect URLs** :
    - `https://<prod>/accept-invite`
    - `https://<prod>/**`
    - `http://localhost:5173/accept-invite` (optionnel — dev)
    - `http://localhost:5173/**` (optionnel — dev)
- Si le mail part dans les spams, vérifie la configuration SMTP custom dans
  Settings → Auth → SMTP Settings (sinon Supabase utilise son propre serveur
  limité à 3 mails/heure en free tier).
- Pour un rendu mobile correct, ne modifie pas la structure `<table>` — c'est
  le seul moyen fiable pour les clients email.
