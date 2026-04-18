-- Revert: Remove extra_usage_enabled column from users table

ALTER TABLE users 
DROP COLUMN IF EXISTS extra_usage_enabled;

-- Drop index if exists
DROP INDEX IF EXISTS ix_users_extra_usage;
