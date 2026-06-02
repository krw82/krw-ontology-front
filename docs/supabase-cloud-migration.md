# Supabase Cloud Migration

This project uses local Supabase for development and a separate Supabase Cloud
project for deployed environments.

## Current Local State

- Local project id: `krw-ontology-front`
- Local API URL: `http://127.0.0.1:54321`
- Local DB port: `54322`
- App migrations live in `supabase/migrations`.

## Cloud Project

- Project name: `krw-ontology-prod`
- Project ref: `bdiuvhdklcnuskrmuejs`
- API URL: `https://bdiuvhdklcnuskrmuejs.supabase.co`
- Region: `ap-northeast-2`

This repo is linked to the cloud project for deployment migrations. Use
`supabase db reset --local` for local resets, and `supabase db push` only when
you intend to apply migrations to the linked cloud project.

Do not point local development at production keys. Keep local `.env.local` for
local Supabase and set production secrets only in the deployment platform.

## One-Time Cloud Setup

Authenticate the Supabase CLI:

```bash
npm run supabase:login
```

If browser login is inconvenient, create a Supabase access token in the dashboard
and run:

```bash
SUPABASE_CLI=/absolute/path/to/supabase scripts/supabase-cli.sh login --token "$SUPABASE_ACCESS_TOKEN"
```

Check the organization id:

```bash
npm run supabase:orgs
```

Create the cloud project:

```bash
scripts/supabase-cli.sh projects create krw-ontology-prod \
  --org-id "<org-id>" \
  --region "<region>" \
  --db-password "<strong-db-password>"
```

Recommended region: choose the closest Supabase region to your deployed users.
For Korea, prefer Seoul if available in your Supabase organization; otherwise
Tokyo or Singapore are reasonable fallbacks.

List projects and copy the new project ref:

```bash
npm run supabase:projects
```

Link this repo to the cloud project:

```bash
npm run supabase:link -- --project-ref "<project-ref>" --password "<strong-db-password>"
```

Preview the migrations that will run:

```bash
npm run supabase:db:push:dry
```

Apply migrations to the cloud project:

```bash
npm run supabase:db:push
```

## Production Environment Variables

Set these in the deployment platform, not in committed files:

```bash
NEXT_PUBLIC_SUPABASE_URL="https://<project-ref>.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="<anon-key>"
SUPABASE_URL="https://<project-ref>.supabase.co"
SUPABASE_ANON_KEY="<anon-key>"
SUPABASE_SERVICE_ROLE_KEY="<service-role-key>"
```

A local ignored helper file has been generated at `.env.cloud.local` with the
cloud Supabase URL and API keys. Use it as a copy source for deployment secrets,
not for local development.

Also set the app-specific runtime values:

```bash
KRW_ONTOLOGY_PLUGIN_PATH="<server-path-to-krw-ontology-plugin>"
CLAUDE_CODE_EXECUTABLE="<server-path-to-claude-or-claude-krw>"
CLAUDE_AGENT_CWD="<server-working-directory>"
ANTHROPIC_API_KEY="<anthropic-api-key>"
```

## Google Auth Setup

In Supabase Dashboard:

1. Authentication -> Providers -> Google -> Enable.
2. Enter the Google OAuth Client ID and Client Secret.
3. Authentication -> URL Configuration:
   - Site URL: deployed app URL.
   - Redirect URLs:
     - `http://localhost:3000/auth/callback`
     - `https://<deployed-domain>/auth/callback`

In Google Cloud Console, add Supabase's callback URL as an authorized redirect
URI:

```text
https://<project-ref>.supabase.co/auth/v1/callback
```

## Data Migration Policy

The default deployment flow migrates schema only. Local Auth users and local chat
history are treated as development data and should not be copied to production by
default.

If production needs seed data later, add a reviewed seed or a dedicated data
migration instead of dumping local dev data wholesale.
