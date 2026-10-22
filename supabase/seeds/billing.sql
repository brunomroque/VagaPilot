-- P6.2 Stripe seed hint (dev): create BRL products/prices in Stripe test mode and set:
-- STRIPE_PRICE_PRO_MONTHLY, STRIPE_PRICE_PRO_YEARLY, STRIPE_PRICE_EXECUTIVE_*,
-- STRIPE_PRICE_SEARCH_PASS (see .env.example and apps/web/lib/billing/stripe.ts BILLING_SEED_HINT).
-- Marina keeps trialing Pro from supabase/seed.sql; Rafael stays on free for entitlement tests.

-- P6.4 RLS fixtures (fictitious Marina + Rafael).
insert into public.privacy_exports (user_id, status, storage_path, expires_at)
values
  (
    '11111111-1111-4111-8111-111111111111'::uuid,
    'ready',
    'exports/fictitious/marina-lgpd-sample.zip',
    now() + interval '24 hours'
  ),
  (
    '22222222-2222-4222-8222-222222222222'::uuid,
    'ready',
    'exports/fictitious/rafael-lgpd-sample.zip',
    now() + interval '24 hours'
  );

insert into public.account_deletion_requests (user_id, scheduled_purge_at, status)
values
  (
    '11111111-1111-4111-8111-111111111111'::uuid,
    now() + interval '15 days',
    'cancelled'
  ),
  (
    '22222222-2222-4222-8222-222222222222'::uuid,
    now() + interval '15 days',
    'pending'
  );
