-- Remove the rows a mis-read export wrote, on 24 August 2026.
--
-- Vault22 changed its export: new column names, the account split into a name and a mask, and a
-- positive amount with the direction in a Type column. The importer of the day read it literally.
-- Because `pay_month` fell back to an empty string when the column it wanted was absent, and an
-- account name it cannot parse falls back to an id of "raw|<the whole name>", roughly four thousand
-- rows were written that belong to no pay cycle and no known account. The app draws its cycles from
-- the pay months in the data, so a cycle with no name is a cycle it cannot draw, and the page went
-- blank.
--
-- Both marks together are the signature of that import and of nothing else: every real row has a
-- pay month, because every export until now wrote one, and every real account parses to
-- "<bank>|<mask>". Rows carrying both marks are unreadable by every part of the app — they are not
-- data being thrown away, they are the absence of data being cleared out. The transactions they
-- were meant to represent come back the moment the same file is imported again, now that the
-- importer understands it (see src/utils/vault22.js).
--
-- This runs once, at boot, like every migration here. Anything that does not carry both marks is
-- left exactly where it is: the app's rule is that an imported row is never deleted, and this is
-- the narrowest possible exception to it.

delete from transactions
 where coalesce(pay_month, '') = ''
   and account_id like 'raw|%';

-- The same import invented an account record for each unparseable name. An account with no
-- transactions left pointing at it, whose id never parsed, is the other half of the same debris.
delete from accounts
 where id like 'raw|%'
   and not exists (select 1 from transactions t where t.account_id = accounts.id);

-- The data version is what tells a browser its cached bootstrap is stale; without this the app
-- would keep showing the rows this migration just removed.
update meta set value = ((value::bigint) + 1)::text where key = 'data_version';
