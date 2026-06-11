-- ════════════════════════════════════════════════════════════════════════════
-- 20260610d — Autorise un utilisateur à supprimer ses propres notifications
-- ════════════════════════════════════════════════════════════════════════════
-- Le centre de notifs mobile permet de supprimer une notif. La table n'avait
-- que SELECT/UPDATE own → on ajoute DELETE own.
-- ════════════════════════════════════════════════════════════════════════════

drop policy if exists "notifications_delete_own" on public.notifications;
create policy "notifications_delete_own"
  on public.notifications for delete
  using (auth.uid() = user_id);
