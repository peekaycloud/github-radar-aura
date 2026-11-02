-- Multi-channel support
-- 1) Message IDs are unique per Telegram chat, not globally
-- 2) ingestion_state keyed by channel (no hardcoded id=1)

-- Ensure existing rows have a channel
UPDATE telegram_posts
SET source_channel = 'githubtrending'
WHERE source_channel IS NULL OR source_channel = '';

ALTER TABLE telegram_posts
  ALTER COLUMN source_channel SET NOT NULL;

-- Drop global unique on telegram_message_id
ALTER TABLE telegram_posts
  DROP CONSTRAINT IF EXISTS telegram_posts_telegram_message_id_key;

DROP INDEX IF EXISTS telegram_posts_telegram_message_id_key;
DROP INDEX IF EXISTS idx_telegram_posts_message_id;

-- Composite uniqueness: same message id can exist on different channels
CREATE UNIQUE INDEX IF NOT EXISTS uq_telegram_posts_channel_message
  ON telegram_posts (source_channel, telegram_message_id);

CREATE INDEX IF NOT EXISTS idx_telegram_posts_message_id
  ON telegram_posts (telegram_message_id);

CREATE INDEX IF NOT EXISTS idx_telegram_posts_channel_posted
  ON telegram_posts (source_channel, posted_at DESC);

-- Rebuild ingestion_state with channel as primary key
CREATE TABLE IF NOT EXISTS ingestion_state_new (
  channel TEXT PRIMARY KEY,
  last_telegram_message_id BIGINT,
  last_posted_at TIMESTAMPTZ,
  last_successful_run_at TIMESTAMPTZ
);

INSERT INTO ingestion_state_new (
  channel, last_telegram_message_id, last_posted_at, last_successful_run_at
)
SELECT
  channel,
  last_telegram_message_id,
  last_posted_at,
  last_successful_run_at
FROM ingestion_state
ON CONFLICT (channel) DO UPDATE SET
  last_telegram_message_id = EXCLUDED.last_telegram_message_id,
  last_posted_at = EXCLUDED.last_posted_at,
  last_successful_run_at = EXCLUDED.last_successful_run_at;

DROP TABLE ingestion_state;
ALTER TABLE ingestion_state_new RENAME TO ingestion_state;

-- Seed default channels (watermarks filled on first successful run)
INSERT INTO ingestion_state (channel)
VALUES
  ('githubtrending'),
  ('github_repos'),
  ('github_repositories_bds')
ON CONFLICT (channel) DO NOTHING;
