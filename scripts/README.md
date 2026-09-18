# Scripts for Cheltenham Top Tipster

These scripts use [RapidAPI Horse Racing](https://rapidapi.com/ortegalex/api/horse-racing) (`horse-racing.p.rapidapi.com`). **50 requests/day** and **10 per minute** on free tier. Racecards are well released by 5pm; we pull at **5pm and 6pm UK time** (second run is backup). Competitions for the following day must be created before 8pm UK. Cron is in UTC: 17:00, 18:00 = 5pm/6pm GMT; in BST = 6pm/7pm UK.

### Request count per day (example)

- **Pull races (once):** 1× racecards + 1× per race. e.g. 3 meetings × 7 races = **1 + 21 = 22 requests**.
- **Results (every 20 min, 13:00–18:00):** one GET /race/{id} per race when we poll for results = **21 requests** (same 21 races).
- **Total:** **22 + 21 = 43 requests/day**, under the 50/day limit.

**Delay between race-detail calls:** Limit is 10/min, so minimum spacing = 6 seconds. We use **6s** by default (fastest within limit). 21 races → 20 × 6s = **~2 min** for the race-detail phase. Doing “9 then wait a minute” would be slower (only 9/min). Set **`RACE_FETCH_DELAY_MS`** (ms) in env to override; minimum 6000 for 10/min.

## Scripts used by this project

| Script | Purpose | When to run |
|--------|---------|-------------|
| **pull-races.ts** | 1) DB: Competitions where tomorrow ∈ [festival_start_date, festival_end_date]; get their **course** (one per competition). 2) API: One call GET /racecards for tomorrow; filter by those courses. 3) API: One call per race GET /race/{id} for runners (with delay). Each race gets an extra **FAV** option (SP favourite). 4) DB: One bulk upload – upsert race_days, insert races, insert horses, upsert competition_race_days. | **5pm, 6pm UK** – cron `0 17,18 * * *` UTC (5/6 GMT; 6/7 BST). Second run is backup. Competitions for the following day must be created **before 8pm UK** to get races that night. |
| **update-race-results.ts** | Gets races where `scheduled_time_utc` + 15 min < now and `is_finished = false`. Calls GET /race/{id}. Updates **horses** (position, sp, is_fav, etc.), **races.is_finished**. Replaces non-runner selections with FAV via RPC. FAV backfill (missing selections after deadline) is done by Supabase cron (migration 030). | **30 min after each race**; cron every 10–12 min. |
| **remove-old-races.ts** | Deletes **race_days** where `race_date` is older than **5 days** (cascade deletes `races` and `horses`). Keeps DB small. | Daily, e.g. **18:00 UTC** – cron `0 18 * * *`. |
| **sync-lms-football.ts** | Syncs Premier League **teams + fixtures/results** from [football-data.org](https://www.football-data.org/) into `lms_teams` / `lms_gameweeks` / `lms_fixtures`, then auto-settles finished gameweeks via `lms_settle_gameweek_internal`. Stores **live** scores when matches are in play; settlement still waits for `finished`. Uses 2 football-data API calls per run; only writes changed fixture rows and only processes live/past-deadline gameweeks. | Every 6 hours (GitHub Action); matchdays ~every 15 min via cron. |
| **lms-auto-assign-missed-picks.ts** | Calls `lms_auto_assign_missed_picks` for every open gameweek past its deadline. Lightweight — no football API. | Manual via GitHub Action `lms-auto-assign-picks.yml`, or cron every 10–15 min on match days. |
| **send-lms-deadline-reminders.ts** | Web Push + Expo to subscribers who have not picked before an LMS deadline (includes predicted auto-assign team). See [docs/WEB_PUSH.md](../docs/WEB_PUSH.md). | Every 15 min via GitHub Action `lms-deadline-reminders.yml`. |
| **send-lms-deadline-email-reminders.ts** | Resend email ~1 hour before kick-off to **active** LMS players who still have no pick (confirmed email). Soft daily cap (default 90). Needs migration `126_lms_deadline_email_reminders.sql`. | Same workflow, after push step. |
| **sync-football-players-bbs.ts** | Syncs Premier League **player roster** from Big Balls API into `football_players` (linked to `lms_teams`). Owner can also trigger via edge function `sync-football-players-bbs`. | Weekly Monday 06:00 UTC (`sync-football-players-bbs.yml`). |
| **sync-football-fpl-daily.ts** | Daily FPL `bootstrap-static` — updates `picker_stats` / news on `football_players`. Auto-excludes (`owner_flagged`) when status is unavailable, unknown return + 0% this/next GW, or expected return ≥ 4 weeks. Re-checks every run; clears prior *auto* flags when rules no longer apply (manual flags kept). | Daily 06:00 UTC (`sync-football-fpl-daily.yml`). |
| **sync-football-goals.ts** | FPL `event/{gw}/live` — upserts `football_player_gameweek_goals`, then calls `f2t_apply_gameweek_goals`. Chained after LMS football sync. | Same cadence as LMS sync (15 min matchday windows). |

## Database tables (migrations 010–011)

- **race_days**: one row per (course, race_date); course, race_date, first_race_utc. Races derived from races + horses.
- **competition_courses**: competition ↔ courses (admin sets 1+ courses per competition).
- **competition_race_days**: bridge linking competitions to race_days.
- **races**: id, race_day_id, api_race_id, name, scheduled_time_utc, distance, is_handicap, **is_finished** (default false; true when results applied).
- **horses**: id, race_id, api_horse_id, name, jockey, trainer, age, weight, number, last_ran_days_ago, non_runner, form, owner, odds_decimal, **sp**, **position** (finishing position), **is_fav** (true for horse(s) with lowest SP in race), **pos_points**, **sp_points** (scoring, when rules applied).

## Place rules (update-race-results)

- **Handicap** (title contains "Handicap"): **≥ 16** runners → 1, 2, 3, 4; **8–15** → 1, 2, 3; **5–7** → 1, 2; **< 5** → win only (1st).
- **Not Handicap**: **≥ 8** → 1, 2, 3; **5–7** → 1, 2; **< 5** → win only (1st).
- **Bonus points**: Place bonus is capped at 8 pts (top range 23.01–999 in `points_system`). Win bonus uses ranges from the DB (top range 26.01–999, 15 pts).

## Environment variables

- **SUPABASE_URL**, **SUPABASE_SERVICE_KEY** (or SUPABASE_SERVICE_ROLE_KEY)
- **RAPIDAPI_KEY** (for pull-races and update-race-results)
- **Football_API** – football-data.org token for **sync-lms-football.ts** (GitHub Secret name: `Football_API`)
- **BIG_BALLS_API** – Big Balls Sports API key for **sync-football-players-bbs.ts** (GitHub Secret name: `BIG_BALLS_API`)
- **RACE_FETCH_DELAY_MS** (optional) – delay in ms between each GET /race/{id} in pull-races. Default 6000 (6s = 10/min, fastest). Increase if you hit rate limits.
- **COURSE_FILTER** – ignored; courses are taken from active competitions in the DB (one course per competition).
- **RESEND_API_KEY** (optional) – if set with **PULL_RACES_NOTIFICATION_EMAIL**, pull-races will email a short report after each run (includes **API calls made**; success: courses and races added; skipped: already had data; errors: message). Same key can be used for update-race-results if **UPDATE_RESULTS_NOTIFICATION_EMAIL** is set, and for **LMS pick email reminders** (`send-lms-deadline-email-reminders.ts`) when migration 126 is applied. Sign up at [resend.com](https://resend.com), create an API key, and add to your env or GitHub Secrets. Admin report emails may use `onboarding@resend.dev` (test sender). Player pick reminders default to `Top Tipster <reminder@toptipster.ie>` (verified `toptipster.ie` domain in Resend).
- **UPDATE_RESULTS_NOTIFICATION_EMAIL** (optional) – if set with **RESEND_API_KEY**, update-race-results will email after each run with API calls made, races updated, and status.

## Running locally

```bash
# Pull tomorrow's races (5pm / 6pm UK)
SUPABASE_URL=... SUPABASE_SERVICE_KEY=... RAPIDAPI_KEY_PULL_RACES=... npx tsx scripts/pull-races.ts

# Update results for latest race due (30+ min after start)
SUPABASE_URL=... SUPABASE_SERVICE_KEY=... RAPIDAPI_KEY_UPDATE_RESULTS=... npx tsx scripts/update-race-results.ts

# Remove race_days older than 5 days
SUPABASE_URL=... SUPABASE_SERVICE_KEY=... npx tsx scripts/remove-old-races.ts
```

## GitHub Actions

Secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `RAPIDAPI_KEY_PULL_RACES`, `RAPIDAPI_KEY_UPDATE_RESULTS`. Optional: `RESEND_API_KEY`, `PULL_RACES_NOTIFICATION_EMAIL`, `UPDATE_RESULTS_NOTIFICATION_EMAIL` to receive email reports (including API call counts) after each run.

- **Pull-races** is capped at **50 API calls per run** (1 racecards + up to 49 race details). Each run’s email reports how many calls were made.
- **Update-race-results** is capped at **2 races per run** (max 32/day over 16 runs). Each run’s email reports API calls made and races updated.

- **17:00, 18:00 UTC** – pull-races (following day) = 5pm, 6pm UK (GMT) / 6pm, 7pm UK (BST). Second run is backup. Competitions for tomorrow must be created before 8pm UK.
- **Every 30 min 13:30–21:00 UTC** – update-race-results (30 min after race + retry).
- **18:00 UTC** – remove-old-races.

## API (RapidAPI Horse Racing)

- **GET /racecards?date=YYYY-MM-DD** – list of races (id_race, title, course, date, distance, …).
- **GET /race/{id_race}** – race detail; **horses**: horse, id_horse, jockey, trainer, age, weight, number, last_ran_days_ago, non_runner, form, owner, odds, sp, **position** (after race).
