-- Up Migration
-- Admin is the ADMIN_TOKEN now, not a user (ADR-0058). Any user that ADMIN_PHONES made an admin
-- becomes a seeker and loses its sessions, the column can no longer hold 'admin', and the plain
-- codes the demo inbox kept for everyone are wiped. Only the hashes stay.

DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE role = 'admin');
UPDATE users SET role = 'seeker' WHERE role = 'admin';

ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('seeker', 'shop'));

UPDATE otp_codes SET dev_code = NULL WHERE dev_code IS NOT NULL;

-- Down Migration
-- The demoted users stay seekers and the wiped codes are gone; this only allows 'admin' again.
ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('seeker', 'shop', 'admin'));
