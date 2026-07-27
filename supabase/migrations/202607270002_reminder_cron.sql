-- Schedule reminder delivery from Supabase so Vercel Hobby deployments do not
-- depend on the once-per-day Vercel Cron limit.
--
-- Runtime secrets are stored in Supabase Vault, never in this migration:
--   shouzhong_site_url
--   shouzhong_cron_secret

create extension if not exists pg_cron;
create extension if not exists pg_net;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.trigger_due_reminders()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  site_url text;
  cron_secret text;
  request_id bigint;
begin
  select decrypted_secret
    into site_url
    from vault.decrypted_secrets
   where name = 'shouzhong_site_url'
   limit 1;

  select decrypted_secret
    into cron_secret
    from vault.decrypted_secrets
   where name = 'shouzhong_cron_secret'
   limit 1;

  if site_url is null or cron_secret is null then
    raise warning 'Reminder cron Vault secrets are not configured';
    return null;
  end if;

  select net.http_post(
    url := rtrim(site_url, '/') || '/api/push/send-due',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || cron_secret
    ),
    body := jsonb_build_object(
      'source', 'supabase-cron',
      'requested_at', timezone('utc', now())
    )
  )
  into request_id;

  return request_id;
end;
$$;

revoke all on function private.trigger_due_reminders() from public, anon, authenticated;

select cron.schedule(
  'shouzhong-due-reminders',
  '*/15 * * * *',
  'select private.trigger_due_reminders();'
);
