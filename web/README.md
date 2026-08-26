This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Database roles

Reporter identity (email/phone) is stored encrypted in the `vault` schema
(`vault.reporter_identities`, `vault.vault_access_log`), isolated from the
`public` schema — see the comment above the `vault` schema declaration in
`src/db/schema.ts` and `src/lib/vault.ts`, the only module allowed to query
it.

For local development, a single Postgres role (whatever `DATABASE_URL`
connects as) is used for everything, since drizzle-kit's migration/owner
role needs DDL rights the app role shouldn't have anyway. That's fine for a
dev machine but isn't a real security boundary — application code
discipline ("only vault.ts touches vault.\*") is a convention, not
enforcement.

For production, `db/roles.sql` defines two least-privilege roles:

- `cf_app` — the main application role. Full CRUD on `public.*`. No grants
  at all on the `vault` schema (not even `USAGE`), so it can't read
  `reporter_identities` even if application code had a bug that tried.
- `cf_vault` — used only by the connection `src/lib/vault.ts` uses in
  production. Full CRUD on `vault.*` only, no access to `public.*`.

Neither role is a superuser or schema owner, so neither can run migrations.

`db/roles.sql` is documentation plus a prod-hardening script — it is **not**
run automatically by `npm run db:migrate` or wired into the local
`DATABASE_URL` connection. Apply it by hand once against a production
database (after setting real passwords in place of the `CHANGE_ME_*`
placeholders):

```bash
psql "$DATABASE_URL" -f db/roles.sql
```

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
