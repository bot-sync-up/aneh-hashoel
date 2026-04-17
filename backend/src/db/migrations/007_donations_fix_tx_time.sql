-- 007_donations_fix_tx_time.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- תיקון ה-backfill: נדרים פלוס שולחים את TransactionTime בפורמט
-- ישראלי "DD/MM/YYYY HH24:MI:SS" ולא ב-ISO. ה-backfill ב-migration 006
-- חיפש פורמט ISO בלבד וכולם נפלו ל-fallback שהגדיר transaction_time =
-- created_at (היום). עכשיו חוזרים אחורה ומבצעים את ההמרה הנכונה.
--
-- שעת נדרים = שעון ישראל → הופכים אותה לרגע UTC אמיתי.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  parsed_count INT := 0;
  failed_count INT := 0;
BEGIN
  -- כל השורות שבהן יש TransactionTime בפורמט ישראלי DD/MM/YYYY — מתוקנות.
  -- cast ל-timestamp (בלי TZ) ואז AT TIME ZONE 'Asia/Jerusalem' כדי להמיר
  -- את הקריאה הלוקאלית לרגע UTC אמיתי ב-TIMESTAMPTZ.
  UPDATE donations
     SET transaction_time =
           to_timestamp(raw_payload->>'TransactionTime', 'DD/MM/YYYY HH24:MI:SS')::timestamp
           AT TIME ZONE 'Asia/Jerusalem'
   WHERE raw_payload IS NOT NULL
     AND raw_payload ? 'TransactionTime'
     AND raw_payload->>'TransactionTime' ~ '^\d{2}/\d{2}/\d{4}';

  GET DIAGNOSTICS parsed_count = ROW_COUNT;
  RAISE NOTICE 'Re-parsed TransactionTime (DD/MM/YYYY format) for % donations', parsed_count;

  -- שורות שעדיין אין להן TransactionTime תקין — לא נוגעים יותר.
  -- (ההפעלה החוזרת של fallback ל-created_at במיגרציה 006 גרמה לבעיה הזו
  -- מלכתחילה; כאן לא חוזרים על הטעות.)
  SELECT COUNT(*) INTO failed_count
  FROM donations
  WHERE raw_payload IS NOT NULL
    AND raw_payload ? 'TransactionTime'
    AND raw_payload->>'TransactionTime' !~ '^\d{2}/\d{2}/\d{4}';

  IF failed_count > 0 THEN
    RAISE NOTICE '% donations have an unknown TransactionTime format — left untouched', failed_count;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Re-parse failed: %', SQLERRM;
END $$;
