-- Add extra_usage_enabled column to users table
-- Allow users to toggle whether they want to spend credits when hitting limits

ALTER TABLE users 
ADD COLUMN extra_usage_enabled INTEGER DEFAULT 1 NOT NULL;

-- Create index for future queries
CREATE INDEX IF NOT EXISTS ix_users_extra_usage ON users(extra_usage_enabled);
