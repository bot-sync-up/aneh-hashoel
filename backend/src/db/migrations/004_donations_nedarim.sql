-- 004_donations_nedarim.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- הרחבת טבלת donations לתמיכה מלאה בפורמט המלא של נדרים פלוס (Webhook + API).
-- העמודות הקיימות נשמרות — אלה תוספות אופציונליות + עמודה לשמירת כל ה-payload
-- המקורי ל-auditing וחסינות מפני שינויי סכמה בצד נדרים.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE donations
  ADD COLUMN IF NOT EXISTS transaction_id    VARCHAR(100),   -- Nedarim TransactionId (stable unique key)
  ADD COLUMN IF NOT EXISTS transaction_type  VARCHAR(30),    -- רגיל / תשלומים / הו"ק
  ADD COLUMN IF NOT EXISTS confirmation      VARCHAR(30),    -- מספר אישור משב"א
  ADD COLUMN IF NOT EXISTS tashloumim        INTEGER,        -- מספר תשלומים (לעסקה בתשלומים)
  ADD COLUMN IF NOT EXISTS first_tashloum    DECIMAL(12, 2), -- סכום תשלום ראשון
  ADD COLUMN IF NOT EXISTS keva_id           VARCHAR(100),   -- מזהה הו"ק (לחיובים של הוראת קבע)
  ADD COLUMN IF NOT EXISTS last_num          VARCHAR(10),    -- 4 ספרות אחרונות של כרטיס
  ADD COLUMN IF NOT EXISTS source            VARCHAR(30),    -- 'webhook' / 'api_sync' / 'manual'
  ADD COLUMN IF NOT EXISTS raw_payload       JSONB;          -- כל ה-payload המקורי מנדרים

-- אינדקס ייחודי על TransactionId כדי למנוע כפילויות כשהסנכרון הלולאתי
-- מושך אותה עסקה שכבר הגיעה דרך ה-webhook.
CREATE UNIQUE INDEX IF NOT EXISTS idx_donations_transaction_id
  ON donations (transaction_id)
  WHERE transaction_id IS NOT NULL;

-- מזהה הו"ק — נשאל כדי להציג "החיוב החודשי מס' 3 של תורם X"
CREATE INDEX IF NOT EXISTS idx_donations_keva_id
  ON donations (keva_id)
  WHERE keva_id IS NOT NULL;

-- ברירת מחדל להגדרות הסנכרון (nedarim_sync_last_id נשמר אחרי כל ריצה)
INSERT INTO system_config (key, value, updated_at)
VALUES
  ('nedarim_sync_enabled', 'true'::jsonb, NOW()),
  ('nedarim_sync_last_id', '0'::jsonb, NOW())
ON CONFLICT (key) DO NOTHING;
