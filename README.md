# GitHub Radar

Editorial discovery analytics for open-source repositories surfaced by a public Telegram channel.

Telegram discovery history + public GitHub metadata + growth snapshots + discovery timing.

## Stack

- **Next.js** (App Router) + TypeScript + Tailwind + shadcn/ui + Recharts
- **Supabase PostgreSQL**
- **Python** + Telethon (Telegram) + httpx/BeautifulSoup (public GitHub HTML enrichment)
- **GitHub Actions** daily incremental ingestion (`posted_at` watermark)

## Quick start

### 1. Environment

```bash
cp .env.example .env.local
```

Fill in:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Supabase Postgres URL (URL-encode special chars in password) |
| `SUPABASE_URL` | Project URL |
| `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | Optional for client features |
| `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` | From https://my.telegram.org |
| `TELEGRAM_SESSION` | Telethon session base name (default `telegram_scraper`) |

Never commit `.env.local` or `*.session`.

### 2. Database migrations

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python scripts/migrate.py
```

### 3. Historical import

Your `telegram_links.csv` already includes `message_id`, `date`, `url`, `text`:

```bash
python scripts/import_historical.py
# or
python scripts/import_historical.py --dry-run
```

If you need to rebuild from Telegram itself:

```bash
python scripts/backfill_telegram_history.py --dry-run
python scripts/backfill_telegram_history.py
```

### 4. Enrichment (public GitHub pages — no API token)

```bash
python scripts/github_enricher.py --dry-run
python scripts/github_enricher.py --limit 50
python scripts/classify_categories.py
```

### 5. Daily delta scrape (local)

Scrapes multiple channels by default (`githubtrending`, `github_repos`,
`github_repositories_bds`). Repositories are deduplicated by `github_url`.

Uses `ingestion_state.last_posted_at` per channel as the watermark:

```bash
python telegram_scraper.py --dry-run
python telegram_scraper.py --backfill-missing   # first-time full history for new channels
python telegram_scraper.py
python telegram_scraper.py --channels github_repos,github_repositories_bds
python telegram_scraper.py --skip-enrich
```

Unique repos query:

```sql
SELECT COUNT(*) FROM repositories;
```

Or call the lower-level scripts directly:

```bash
python scripts/telegram_ingest.py --dry-run
python scripts/github_enricher.py --limit 50
```

### 6. Web app

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## GitHub Actions (daily)

Workflow: `.github/workflows/telegram-ingest.yml`

- **Schedule:** daily at 06:00 UTC (`0 6 * * *`)
- **Manual:** Actions → “Daily Telegram scrape & enrich” → Run workflow
- **Command:** `python telegram_scraper.py --enrich-limit 80`

Add these repository secrets:

| Secret | Notes |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key |
| `TELEGRAM_API_ID` | Integer API id |
| `TELEGRAM_API_HASH` | API hash |
| `TELEGRAM_SESSION` | **Base64** of the Telethon `.session` file |

Encode the session locally:

```bash
base64 -i telegram_scraper.session | pbcopy
```

The workflow restores the session non-interactively, runs delta ingest + enrichment into Supabase, then deletes the session file.

## Discovery Score

Documented in `db/migrations/002_analytics_views.sql`:

```
0.30 · log1p(stars_gained_7d)
+ 0.20 · log1p(mention_count)
+ 0.15 · recency_boost
+ 0.15 · early_discovery_boost
+ 0.10 · growth_since_discovery
+ 0.10 · inverse size penalty
```

## Project layout

```
db/migrations/          SQL schema + analytics views
scripts/                Python ingest / enrich / import
src/app/                Next.js e-paper UI
tests/                  Pytest suite
.github/workflows/      Scheduled ingestion
```

## Production deploy

1. Apply migrations against Supabase.
2. Import historical CSV once.
3. Deploy the Next.js app (Vercel recommended) with `DATABASE_URL` set.
4. Enable the GitHub Actions workflow with secrets above.
5. Let enrichment catch up gradually (do not blast all repos).

## Testing

```bash
pytest -q
```
