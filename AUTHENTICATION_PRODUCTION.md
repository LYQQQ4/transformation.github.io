# Production Authentication and Migration

## Required production configuration

Set these values in the deployment environment or an untracked `.env` file:

```dotenv
NODE_ENV=production
MYSQL_ROOT_PASSWORD=<unique-random-database-password>
DB_PASSWORD=<same-password-or-app-db-password>
USER_DB_PASSWORD=<database-password-or-dedicated-user-db-password>
CORS_ORIGIN=https://orders.example.com
ALLOW_NULL_ORIGIN=false
SESSION_COOKIE_NAME=transport_session
SESSION_TTL_MS=28800000
TRUST_PROXY=true
```

Use the same HTTPS origin that serves the frontend. Keep the application port private behind the HTTPS reverse proxy. Set `TRUST_PROXY=true` only when requests can reach the application exclusively through a trusted proxy that overwrites forwarded headers. Production startup rejects a missing database password and wildcard CORS.

The session cookie is HttpOnly, Secure in production, and SameSite=Lax. TLS must terminate at a trusted proxy, and that proxy should forward `X-Forwarded-Proto: https`.

## Existing accounts

The migration does not delete or recreate users. Existing rows and IDs remain unchanged. Accounts with a legacy plaintext `password` are upgraded on their first successful login: bcrypt hash is written to `password_hash`, then the plaintext column value is set to NULL. Existing bcrypt hashes remain usable. The `password` column is retained only as nullable migration compatibility; newly created and updated passwords are bcrypt-hashed.

Before deployment, take a verified database backup. After upgrading, test each of the 2-3 known internal accounts and confirm its role. If a legacy password was weak or previously exposed, reset it through the administrator account or a controlled deployment process before enabling production access. Never recreate users by dropping the users table.

## Migration

The app startup runs the idempotent auth migration automatically after confirming both databases are reachable. To run it separately during a maintenance window:

```bash
node scripts/migrate_auth_sessions.js
```

It ensures `users.password_hash`, makes a legacy `users.password` nullable, and creates the MySQL-backed `sessions` table and indexes if missing. It does not delete business data, users, or existing session records. The Docker Compose startup runs the existing schema setup followed by this migration; do not remove database volumes.

## Account provisioning

Public registration is disabled. `POST /api/users` requires an administrator session; the request role is only honored from that administrator-controlled path. For first-time installation, use the deployment provisioning script with environment variables:

```powershell
$env:NEW_USERNAME = "operator"
$env:NEW_USER_PASSWORD = "<strong-unique-password>"
$env:NEW_USER_ROLE = "admin"
node add_user.js
```

Do not put the password in shell history, source control, a test fixture, or command-line arguments. Prefer a protected secret manager or an interactive process to set it. The script stores only a bcrypt hash.

## Login limits and operational notes

Login throttling currently uses a bounded, expiring in-process map. It provides IP- and username-based limits on one app process only. Keep PM2 at one instance; for multiple app replicas, replace the limiter with shared Redis or MySQL-backed storage before scaling.

Rotate database and fixed-account credentials if they may have appeared in repository history, logs, backups, or deployment artifacts. Rebuild deployment images after removing any exposed secret from tracked files, and review access logs without recording request bodies, cookies, or tokens.
