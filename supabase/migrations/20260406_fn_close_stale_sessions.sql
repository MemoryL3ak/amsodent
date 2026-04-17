-- Cierra sesiones zombie: ended_at IS NULL y last_seen_at más viejo que p_stale_seconds
CREATE OR REPLACE FUNCTION fn_close_stale_sessions(p_stale_seconds INT DEFAULT 45)
RETURNS INT AS $$
DECLARE
  v_count INT;
BEGIN
  UPDATE user_sessions
  SET ended_at = last_seen_at
  WHERE ended_at IS NULL
    AND last_seen_at < now() - make_interval(secs => p_stale_seconds);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
