-- Incremento atómico de active_seconds e idle_seconds en user_activity_daily
-- Evita race condition cuando múltiples tabs hacen flush simultáneo
CREATE OR REPLACE FUNCTION fn_upsert_activity_daily(
  p_user_id UUID,
  p_day DATE,
  p_active_seconds INT DEFAULT 0,
  p_idle_seconds INT DEFAULT 0,
  p_last_seen_at TIMESTAMPTZ DEFAULT now()
)
RETURNS VOID AS $$
BEGIN
  INSERT INTO user_activity_daily (user_id, day, active_seconds, idle_seconds, last_seen_at)
  VALUES (p_user_id, p_day, p_active_seconds, p_idle_seconds, p_last_seen_at)
  ON CONFLICT (user_id, day) DO UPDATE
  SET
    active_seconds = user_activity_daily.active_seconds + EXCLUDED.active_seconds,
    idle_seconds   = user_activity_daily.idle_seconds   + EXCLUDED.idle_seconds,
    last_seen_at   = GREATEST(user_activity_daily.last_seen_at, EXCLUDED.last_seen_at);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
