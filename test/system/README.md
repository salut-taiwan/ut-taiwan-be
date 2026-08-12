# System tests

These run the stored procedures against a real Postgres. Everything else in
`test/` stubs the database, so this is the only tier that can prove what the SQL
actually does: row locking, the availability re-check inside the checkout
transaction, rollback, and the numeric-column mapping.

## Running them

```
npm run test:system          # boots the container if needed, applies the schema
npm run test:system:down     # stop and delete the container
```

Docker is the only requirement. Without it the tier skips itself with a reason
rather than failing. To point at a database you manage yourself:

```
SYSTEST_DB_URL=postgres://user:pass@host:5432/db npm run test:system
```

The container listens on **55432**, not 5432, so it cannot collide with a
developer's own Postgres. Its data directory is a tmpfs and durability is off —
it is disposable.

## The migration manifest

`sql/migrations.manifest.txt` lists every migration in the order it must be
applied. It exists because `migrations/` has duplicate numbers — two `005`s, two
`006`s, two `007`s — so sorting the directory is ambiguous.

**A migration is not finished until it is in the manifest and this suite is
green.** `apply.js` fails when a file in `migrations/` appears neither in the
manifest nor in its `# SKIP` list, so forgetting is loud rather than silent.

Three large data-only seeds are skipped deliberately; tests build the rows they
need through `helpers/factories.js` instead.

## Isolation

Every test truncates the mutable tables first. Not a wrapping transaction:
the procedures open their own transactions and take row locks, and the
concurrency tests need two connections to see each other's committed work —
neither survives being nested inside one outer transaction that gets rolled
back.

## What this tier still does not cover

Supabase Auth, Storage, and PostgREST's own error envelope. The connection here
owns the tables and bypasses row-level security, which mirrors production —
the backend reaches Postgres with the service role, and the RLS policies guard
the frontend's direct reads rather than this server.
