-- ═══════════════════════════════════════════════════════════════════════════
-- 20260610a_push_notifications.sql — Push notifications mobile
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Tables :
--   - push_tokens          : tokens Expo Push enregistrés par device
--   - user_settings        : préférences utilisateur (push on/off, délai rappel)
--   - notifications        : log centralisé des notifs envoyées (debug + history)
--
-- RLS : chaque utilisateur ne voit/modifie que ses propres lignes.
--
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── push_tokens ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.push_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expo_token  text NOT NULL,
  platform    text CHECK (platform IN ('ios', 'android', 'web')),
  device_name text,
  device_os   text,                            -- "iOS 17.5", "Android 14"
  app_version text,
  last_seen   timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, expo_token)
);

CREATE INDEX IF NOT EXISTS push_tokens_user_id_idx ON public.push_tokens(user_id);
CREATE INDEX IF NOT EXISTS push_tokens_last_seen_idx ON public.push_tokens(last_seen DESC);

ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "push_tokens_select_own" ON public.push_tokens;
CREATE POLICY "push_tokens_select_own"
  ON public.push_tokens FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "push_tokens_insert_own" ON public.push_tokens;
CREATE POLICY "push_tokens_insert_own"
  ON public.push_tokens FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "push_tokens_update_own" ON public.push_tokens;
CREATE POLICY "push_tokens_update_own"
  ON public.push_tokens FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "push_tokens_delete_own" ON public.push_tokens;
CREATE POLICY "push_tokens_delete_own"
  ON public.push_tokens FOR DELETE
  USING (auth.uid() = user_id);

COMMENT ON TABLE public.push_tokens IS
  'Tokens Expo Push enregistrés par device. Un user peut avoir N tokens (multi-device).';

-- ─── user_settings ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_settings (
  user_id              uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  push_enabled         boolean NOT NULL DEFAULT true,
  rappel_delai_min     int NOT NULL DEFAULT 15
                       CHECK (rappel_delai_min IN (5, 15, 30, 45, 60, 120)),
  language             text DEFAULT 'fr',
  theme                text DEFAULT 'auto' CHECK (theme IN ('auto', 'light', 'dark')),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_settings_select_own" ON public.user_settings;
CREATE POLICY "user_settings_select_own"
  ON public.user_settings FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_settings_insert_own" ON public.user_settings;
CREATE POLICY "user_settings_insert_own"
  ON public.user_settings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_settings_update_own" ON public.user_settings;
CREATE POLICY "user_settings_update_own"
  ON public.user_settings FOR UPDATE
  USING (auth.uid() = user_id);

COMMENT ON TABLE public.user_settings IS
  'Préférences utilisateur transverses (push, rappels, thème, langue).';

-- ─── notifications (log historique) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type        text NOT NULL,
  titre       text NOT NULL,
  corps       text,
  deep_link   text,                            -- "captivdesk://creneau/c3"
  data        jsonb,                           -- payload custom (creneau_id, etc.)
  lu          boolean NOT NULL DEFAULT false,
  envoye_at   timestamptz,                     -- quand on a envoyé la push
  lu_at       timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_user_id_created_idx
  ON public.notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_user_id_lu_idx
  ON public.notifications(user_id, lu);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notifications_select_own" ON public.notifications;
CREATE POLICY "notifications_select_own"
  ON public.notifications FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "notifications_update_own" ON public.notifications;
CREATE POLICY "notifications_update_own"
  ON public.notifications FOR UPDATE
  USING (auth.uid() = user_id);

-- Note : pas d'INSERT policy → l'insertion se fait via service_role
-- depuis l'Edge function send-push uniquement.

COMMENT ON TABLE public.notifications IS
  'Log des notifications push (envoyées + reçues côté in-app).';

-- ─── Realtime ─────────────────────────────────────────────────────────────
-- Activer Realtime sur notifications pour push in-app temps réel
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
