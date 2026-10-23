-- Atomic usage counter increment (ESPEC §14 / usage_counters). Service role only.

create or replace function public.increment_usage(
  p_user_id uuid,
  p_period text,
  p_metric text,
  p_delta integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period char(7);
  v_new integer;
begin
  if p_delta is null or p_delta = 0 then
    raise exception 'increment_usage: delta must be non-zero';
  end if;

  v_period := left(trim(p_period), 7);

  insert into public.usage_counters (user_id, period, metric, value)
  values (p_user_id, v_period, p_metric, p_delta)
  on conflict (user_id, period, metric)
  do update set value = public.usage_counters.value + excluded.value
  returning value into v_new;

  return v_new;
end;
$$;

revoke all on function public.increment_usage(uuid, text, text, integer) from public;
grant execute on function public.increment_usage(uuid, text, text, integer) to service_role;
