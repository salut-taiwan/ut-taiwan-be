-- Migration 006: ACID-compliant scraper + cart RPCs
-- Run in Supabase SQL Editor

-- ============================================================
-- 1. apply_scraper_changes — Atomicity for scraper writes
-- ============================================================
CREATE OR REPLACE FUNCTION apply_scraper_changes(
  p_run_id   uuid,
  p_adds     jsonb,  -- [{tbo_code, name, price_student, price_general, tbo_url, cover_image_url, is_available, ...}]
  p_updates  jsonb,  -- [{id, changes, old_data}]
  p_removes  jsonb   -- [{id, old_data}]
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_added   int := 0;
  v_updated int := 0;
  v_removed int := 0;
  rec       jsonb;
BEGIN
  -- ADDS: batch insert, capture inserted IDs via CTE, then batch history insert
  IF jsonb_array_length(p_adds) > 0 THEN
    WITH inserted AS (
      INSERT INTO modules (tbo_code, name, price_student, price_general, tbo_url, cover_image_url, is_available, first_seen_at, last_seen_at)
      SELECT
        x.tbo_code,
        x.name,
        (x.price_student)::numeric,
        (x.price_general)::numeric,
        x.tbo_url,
        x.cover_image_url,
        COALESCE((x.is_available)::boolean, true),
        now(),
        now()
      FROM jsonb_to_recordset(p_adds) AS x(
        tbo_code        text,
        name            text,
        price_student   text,
        price_general   text,
        tbo_url         text,
        cover_image_url text,
        is_available    text
      )
      ON CONFLICT (tbo_code) DO NOTHING
      RETURNING id, tbo_code
    )
    INSERT INTO module_history (module_id, scraper_run_id, change_type, new_data)
    SELECT ins.id, p_run_id, 'added', elem
    FROM inserted ins
    JOIN jsonb_array_elements(p_adds) AS elem ON elem->>'tbo_code' = ins.tbo_code;

    GET DIAGNOSTICS v_added = ROW_COUNT;
  END IF;

  -- UPDATES: loop, update module, insert history
  FOR rec IN SELECT * FROM jsonb_array_elements(p_updates) LOOP
    UPDATE modules
    SET
      name            = COALESCE((rec->'changes'->>'name'),            name),
      price_student   = COALESCE((rec->'changes'->>'price_student')::numeric,  price_student),
      price_general   = COALESCE((rec->'changes'->>'price_general')::numeric,  price_general),
      tbo_url         = COALESCE((rec->'changes'->>'tbo_url'),          tbo_url),
      cover_image_url = COALESCE((rec->'changes'->>'cover_image_url'),  cover_image_url),
      is_available    = COALESCE((rec->'changes'->>'is_available')::boolean, is_available),
      last_seen_at    = now(),
      updated_at      = now()
    WHERE id = (rec->>'id')::uuid;

    INSERT INTO module_history (module_id, scraper_run_id, change_type, old_data, new_data)
    VALUES (
      (rec->>'id')::uuid,
      p_run_id,
      'updated',
      rec->'old_data',
      rec->'changes'
    );

    v_updated := v_updated + 1;
  END LOOP;

  -- REMOVES: loop, soft-delete module, insert history
  FOR rec IN SELECT * FROM jsonb_array_elements(p_removes) LOOP
    UPDATE modules
    SET
      is_available = false,
      deleted_at   = now(),
      updated_at   = now()
    WHERE id = (rec->>'id')::uuid;

    INSERT INTO module_history (module_id, scraper_run_id, change_type, old_data)
    VALUES (
      (rec->>'id')::uuid,
      p_run_id,
      'removed',
      rec->'old_data'
    );

    v_removed := v_removed + 1;
  END LOOP;

  -- Update run record to success inside the same transaction
  UPDATE scraper_runs
  SET
    status          = 'success',
    finished_at     = now(),
    modules_added   = v_added,
    modules_updated = v_updated,
    modules_removed = v_removed
  WHERE id = p_run_id;

  RETURN jsonb_build_object('added', v_added, 'updated', v_updated, 'removed', v_removed);
END;
$$;


-- ============================================================
-- 2. get_or_create_cart — Race-condition-safe cart upsert
-- ============================================================
CREATE OR REPLACE FUNCTION get_or_create_cart(p_user_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO carts (user_id) VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;
  SELECT id INTO v_id FROM carts WHERE user_id = p_user_id;
  RETURN v_id;
END;
$$;