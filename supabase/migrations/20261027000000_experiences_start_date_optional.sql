-- Experiences imported from a CV without dates can be saved; the app shows a pending item
-- asking the user to fill in the start date until it is set (approved by Bruno, 24/10/2026).
alter table public.experiences alter column start_date drop not null;
