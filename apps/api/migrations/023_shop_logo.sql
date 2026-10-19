-- Up Migration
-- A shop's logo (ADR-0040) is a photo the shop chose to publish. It lives in `photos` beside the
-- others, owned by a shop (`shop_id`), stored as a 512 px square webp, and `shops.logo_photo_id`
-- points at the current one. Only adds and widens: the previous release keeps working against it.
ALTER TABLE photos ADD COLUMN shop_id uuid REFERENCES shops (id) ON DELETE CASCADE;

ALTER TABLE photos DROP CONSTRAINT photos_role_check;
ALTER TABLE photos ADD CONSTRAINT photos_role_check CHECK (role IN ('request', 'answer', 'logo'));
ALTER TABLE photos DROP CONSTRAINT photos_mime_check;
ALTER TABLE photos ADD CONSTRAINT photos_mime_check CHECK (mime IN ('image/jpeg', 'image/webp'));

ALTER TABLE photos DROP CONSTRAINT photos_links;
ALTER TABLE photos ADD CONSTRAINT photos_links CHECK (
  (role = 'request' AND ping_id IS NULL AND shop_id IS NULL)
  OR (role = 'answer' AND request_id IS NULL AND errand_id IS NULL AND shop_id IS NULL)
  OR (role = 'logo' AND shop_id IS NOT NULL AND request_id IS NULL AND ping_id IS NULL
      AND errand_id IS NULL)
);
-- One logo per shop.
CREATE UNIQUE INDEX photos_shop_logo ON photos (shop_id) WHERE role = 'logo';

ALTER TABLE shops ADD COLUMN logo_photo_id uuid;
ALTER TABLE shops ADD CONSTRAINT shops_logo_photo_id_fkey
  FOREIGN KEY (logo_photo_id) REFERENCES photos (id) ON DELETE SET NULL;

-- Down Migration
ALTER TABLE shops DROP COLUMN logo_photo_id;
DROP INDEX photos_shop_logo;
DELETE FROM photos WHERE role = 'logo';
ALTER TABLE photos DROP CONSTRAINT photos_links;
ALTER TABLE photos ADD CONSTRAINT photos_links CHECK (
  (role = 'request' AND ping_id IS NULL)
  OR (role = 'answer' AND request_id IS NULL AND errand_id IS NULL)
);
ALTER TABLE photos DROP CONSTRAINT photos_mime_check;
ALTER TABLE photos ADD CONSTRAINT photos_mime_check CHECK (mime = 'image/jpeg');
ALTER TABLE photos DROP CONSTRAINT photos_role_check;
ALTER TABLE photos ADD CONSTRAINT photos_role_check CHECK (role IN ('request', 'answer'));
ALTER TABLE photos DROP COLUMN shop_id;
