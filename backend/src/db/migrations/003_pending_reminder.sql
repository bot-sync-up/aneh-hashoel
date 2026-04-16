-- 003_pending_reminder.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- הוספת עמודת last_reminder_at לטבלת questions, כדי למנוע שליחת תזכורות
-- כפולות על אותה שאלה בתוך חלון הזמן שהוגדר ב-system_config.pending_reminder.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE questions
  ADD COLUMN IF NOT EXISTS last_reminder_at TIMESTAMPTZ;

-- אינדקס חלקי — רק שאלות שעדיין ממתינות ונשלחה להן תזכורת,
-- כדי שאפשר יהיה לשלוף מהר את הקבוצה שצריך להזכיר מחדש.
CREATE INDEX IF NOT EXISTS idx_questions_pending_last_reminder
  ON questions (last_reminder_at)
  WHERE status = 'pending';

-- ברירת מחדל לתצורה (disabled עד שהאדמין מפעיל).
-- משתמשים ב-ON CONFLICT DO NOTHING כדי לא לדרוס הגדרות קיימות.
INSERT INTO system_config (key, value, updated_at)
VALUES (
  'pending_reminder',
  '{"enabled": false, "hours": 24, "remind_every": 24}'::jsonb,
  NOW()
)
ON CONFLICT (key) DO NOTHING;
