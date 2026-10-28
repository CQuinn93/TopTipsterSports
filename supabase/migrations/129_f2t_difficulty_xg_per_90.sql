-- Tipster20 difficulty ranks: prefer FPL expected_goals_per_90 over season totals.
-- Bands are calibrated for per-90 rates (not season cumulative xG).

create or replace function public.f2t_difficulty_rank_from_stats(
  p_stats jsonb,
  p_position text
)
returns int
language plpgsql
immutable
as $$
declare
  v_stats jsonb := coalesce(p_stats, '{}'::jsonb);
  v_xg90 numeric;
  v_xg numeric;
  v_goals numeric;
  v_minutes numeric;
  v_signal numeric;
  v_pos text := upper(trim(coalesce(p_position, '')));
  v_floor int;
begin
  begin
    v_xg90 := nullif(trim(v_stats->>'expected_goals_per_90'), '')::numeric;
  exception when others then
    v_xg90 := null;
  end;
  begin
    v_xg := nullif(trim(v_stats->>'expected_goals'), '')::numeric;
  exception when others then
    v_xg := null;
  end;
  begin
    v_goals := nullif(trim(v_stats->>'season_goals'), '')::numeric;
  exception when others then
    v_goals := null;
  end;
  begin
    v_minutes := nullif(trim(v_stats->>'minutes'), '')::numeric;
  exception when others then
    v_minutes := null;
  end;

  -- Prefer official FPL xG/90; else derive from season xG when minutes are meaningful.
  if v_xg90 is not null then
    v_signal := v_xg90;
  elsif v_xg is not null and coalesce(v_minutes, 0) >= 90 then
    v_signal := v_xg / (v_minutes / 90.0);
  else
    v_signal := null;
  end if;

  v_floor := case
    when v_pos in ('GK', 'GKP', '1') then 5
    when v_pos in ('DEF', '2') then 4
    when v_pos in ('MID', '3') then 3
    when v_pos in ('FWD', '4') then 2
    else 3
  end;

  -- Sparse sample: don't trust a tiny minutes base.
  if coalesce(v_minutes, 0) < 180 and coalesce(v_signal, 0) < 0.20 then
    return v_floor;
  end if;

  if v_signal is null then
    -- Last resort: coarse season goals → weak proxy only.
    if coalesce(v_goals, 0) >= 8 then
      return 1;
    elsif coalesce(v_goals, 0) >= 4 then
      return 2;
    elsif coalesce(v_goals, 0) >= 2 then
      return 3;
    elsif coalesce(v_goals, 0) >= 1 then
      return 4;
    else
      return v_floor;
    end if;
  end if;

  -- xG per 90 bands
  if v_signal >= 0.55 then
    return 1; -- elite scorers
  elsif v_signal >= 0.35 then
    return 2; -- strong
  elsif v_signal >= 0.20 then
    return 3; -- occasional
  elsif v_signal >= 0.08 then
    return 4; -- rare
  else
    return 5; -- very rare
  end if;
end;
$$;

comment on function public.f2t_difficulty_rank_from_stats(jsonb, text) is
  'Maps FPL picker_stats to Tipster20 difficulty 1–5 using expected_goals_per_90 (preferred).';
