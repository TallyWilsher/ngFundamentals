# Brace Buddy — Prototype Plan

*A single-user, local-first app to track and reward brace-wearing for one child. Built to test one thesis before it becomes a product: **does a reward loop actually increase brace adherence?***

> **Revision note (refined):** This version folds in review refinements R1–R7.
> Changes from the first draft: an onboarding recall-baseline + trend-based
> thesis measurement (no silent control period — rewards start immediately);
> notifications deferred out of P1; a Jest unit-test suite for the core logic;
> stored timezone; streak state treated as a deterministic recompute (cache, not
> a mutated counter); a single standardized reward-unlock mechanism; and named
> P2 hardware realities. Each change is tagged inline as **[R#]**.

---

## 0. Scope & Guardrails

**What this is:** A personal prototype for one child (yours). Local-only. No cloud, no accounts, no other users' data.

**What this is deliberately NOT (yet):**
- Not a distributed product → **HIPAA does not apply** (you're not a covered entity tracking others).
- Not an online service collecting data from children → **COPPA does not apply** (no operator, no service).
- Not marketed with medical claims → **FDA does not apply** (it's a behavior tracker, not the brace).

**The framing that keeps it out of regulation later** (Whoop/Oura model):
- ✅ Report **behavior**: "worn 11.5 hrs today," "5-day streak." (General-wellness claim.)
- ❌ Never claim **treatment**: "corrects the curve," "improves scoliosis outcomes." (Medical claim.)
- Track **temperature only** (= "is she wearing it"). Avoid pressure/correction sensing (= "is the treatment working"), which drifts toward the medical line.

**Sequencing principle:** Prove the *motivation* with manual tap-to-track first. Add the Bluetooth sensor only once the reward loop is shown to work. The sensor answers a question we already know is solvable ("can we detect wear"); it does not answer the actual thesis ("will rewards change behavior").

---

## 1. Build Phases

| Phase | Goal | Ship when |
|---|---|---|
| **P1 — Reward loop** | Three modes (Parent/Child/Teen), manual brace on/off, hours, streak, points, rewards, Child character screen. Local only. | This week |
| **P2 — Calibration + BLE** | ESP32 temp sensor over Bluetooth, calibration routine to derive threshold, auto session detection feeding the same data model. | After she's hooked on P1 |
| **P3 — Polish** | Parent report/export, multiple reward tiers, backup/restore, refinements from real use. | Once it's part of the routine |

Everything in P1 is designed so P2 plugs a sensor in *underneath* it without rewriting the app — the reward/streak/UI layer never learns where a reading came from.

---

## 2. Tech Stack (prototype)

| Layer | Choice | Why |
|---|---|---|
| App | **React Native + Expo (TypeScript)** | One codebase iOS/Android; Expo handles BLE, local storage, notifications without native build pain. |
| Local storage | **SQLite** (`expo-sqlite`) | Relational data (sessions → days → rewards), survives restarts, queryable. No server needed. |
| State | **Zustand** or React Context | Lightweight; prototype doesn't need Redux. |
| Tests | **Jest + ts-jest** | Unit-tests the pure core-logic functions (see §7.5). No native deps needed to run. **[R3]** |
| Charts | **victory-native** or **react-native-svg** | For the calibration histogram + parent view. |
| BLE (P2) | **react-native-ble-plx** | Mature BLE library; reads the ESP32 temperature characteristic. |
| Firmware (P2) | **ESP32 + Arduino/PlatformIO** | ~$10, BLE built in, fully hackable, no gatekeeper. |

No backend. No auth. All data lives on the device. A single "Export / Backup" button (P3) writes a JSON+CSV file you can save.

**Notifications:** the Expo notifications capability is available but **intentionally deferred past P1 [R2]** — see §4.6/§8. Keeping P1 free of reminders means the reward loop is the *only* intervention under test, so any adherence change is attributable to it and not confounded by nudges.

---

## 3. Data Model (local SQLite)

Designed once, used by all phases. Manual taps and sensor readings both resolve into `wear_sessions`.

```sql
-- The child (just one, but structured for clarity)
child (
  id            INTEGER PRIMARY KEY,
  name          TEXT,
  mode          TEXT,            -- 'child' | 'teen' — the WEARER surface (see §4.0).
                                 -- Parent Mode is separate, PIN-gated, not a child.mode value.
  character_id  TEXT,            -- chosen from the 15-character roster (see section 4.3)
  timezone      TEXT,            -- [R4] IANA name, e.g. 'America/Chicago'. Captured at onboarding
                                 -- (defaults to device tz), editable in Parent Mode. ALL local-time
                                 -- math (logical day, streaks) takes this tz EXPLICITLY, so travel or
                                 -- a device-tz change can't silently reassign a night to another day.
  day_start_hour INTEGER,        -- 0-23, parent-set "logical day" cutoff (see §4.2.1).
                                 -- Default 0 (midnight). For a NIGHTTIME wearer set to
                                 -- e.g. 17 (5pm) so a whole night counts as ONE day.
  avatar_config TEXT             -- JSON blob for character state (level, accessories, etc.)
)
-- NOTE: daily goal is NOT stored here — it's a versioned, adjustable feature.
-- See goal_history below and section 4.4.

-- Free-form app settings / notes (key-value). [R1]
settings (
  key        TEXT PRIMARY KEY,   -- e.g. 'recall_baseline_hours', 'recall_baseline_note'
  value      TEXT,
  created_at TEXT
)
-- SEEDED at onboarding: a one-time parent RECALL BASELINE — roughly how many
-- hours/night she wore the brace BEFORE the app (a number + free-text note).
-- This is soft, self-reported evidence (labeled as such), used as the informal
-- "before" for the trend read in §4.6.

-- Adjustable prescribed-hours history (append-only; never edit past rows)
goal_history (
  id             INTEGER PRIMARY KEY,
  goal_min       INTEGER,         -- e.g. 720 (12h), 960 (16h), 1380 (23h), 480 (nighttime)
  effective_from TEXT,            -- 'YYYY-MM-DD' local; goal applies from this date forward
  label          TEXT,            -- optional, e.g. "Post-op nighttime", "Dr. Cooley 16hr Rx"
  created_at     TEXT
)
-- The "current goal" is the row with the latest effective_from <= today.
-- Daily rollups look up the goal that was in effect ON that date, so changing
-- the prescription never retroactively breaks past streaks.
--
-- SEEDED row 1 (from onboarding): goal_min = 720, label = "Nighttime 12h",
--   effective_from = <setup date>. This is a STARTING value only — the parent
--   adds new rows anytime her Rx changes; old rows are never overwritten.

-- Raw sensor samples (P2 only; P1 leaves this empty)
readings (
  id         INTEGER PRIMARY KEY,
  ts         TEXT,               -- ISO 8601, UTC
  temp_c     REAL,
  source     TEXT DEFAULT 'ble'
)

-- The core truth: a period the brace was worn
wear_sessions (
  id          INTEGER PRIMARY KEY,
  start_ts    TEXT,              -- ISO 8601, UTC
  end_ts      TEXT,
  minutes     INTEGER,           -- computed, stored for speed
  source      TEXT,              -- 'manual' | 'sensor' | 'override'
  note        TEXT               -- optional, e.g. reason for a manual edit
)

-- Materialized daily rollup (rebuilt when sessions change)
daily_totals (
  date        TEXT PRIMARY KEY,  -- LOGICAL-DAY key 'YYYY-MM-DD' (the date the logical
                                 -- day STARTS; boundary = child.day_start_hour, not midnight)
  worn_min    INTEGER,
  goal_min    INTEGER,
  met_goal    INTEGER            -- 0/1
)

-- Append-only points log (idempotent on reason+ref)
points_ledger (
  id         INTEGER PRIMARY KEY,
  delta      INTEGER,
  reason     TEXT,               -- 'daily_goal' | 'streak_bonus' | 'redeem'
  ref        TEXT,               -- e.g. the date, so it can't double-award
  created_at TEXT,
  UNIQUE(reason, ref)
)

-- Streak state (single row) — TREATED AS A CACHE, NOT THE SOURCE OF TRUTH. [R5]
-- Recomputed deterministically from daily_totals whenever sessions change
-- (including retroactive parent edits). See §4.2.
streak (
  current_days INTEGER,
  longest_days INTEGER,
  freeze_tokens INTEGER,          -- "rest day" grace, so one miss ≠ total reset
  last_qualifying_date TEXT
)

-- Rewards you stock yourself (ships seeded with mode-aware mock samples — see §4.5)
rewards (
  id          INTEGER PRIMARY KEY,
  title       TEXT,              -- "Ulta lip balm", "$10 Sephora gift card", "Five Below pick"
  mode        TEXT,              -- 'child' | 'teen' — which wearer surface shows it
  cost_points INTEGER,           -- used when unlock_type='points'
  tier        TEXT,              -- 'small' | 'medium' | 'big'
  unlock_type TEXT,              -- 'points' | 'streak_days'. Seeded milestones use 'streak_days' [R6]
  unlock_value INTEGER,          -- e.g. 7 / 14 / 30 (days) or a point cost
  is_sample   INTEGER,           -- 1 = seeded mock (editable), 0 = real reward you stocked
  claimed_at  TEXT               -- null until redeemed
)
```

**Key rule carried over from the product design:** a manual override never mutates `readings`. It writes a `wear_sessions` row with `source='override'`. Sensor truth stays intact underneath — matters if you ever show data to her orthotist.

**Timezone rule:** store everything UTC, compute "days" and streaks in *local* time using the **explicitly stored `child.timezone` [R4]** — and bucket by the **logical-day boundary** (`child.day_start_hour`), not calendar midnight (see §4.2.1). A streak that breaks over a DST change, or a nighttime session split across midnight, would both be motivation-killers; the logical-day model + wall-clock bucketing avoid both.

---

## 4. P1 — Reward Loop (the part that proves the thesis)

### 4.0 Three modes (Parent / Child / Teen)

The app has **three distinct modes**. Two are *wearer surfaces* (how the tracking looks to the kid) and one is the *administrator surface* (how you manage it). Separating them cleanly is what lets one app serve a 4-year-old and a 15-year-old without feeling wrong for either.

| | **Parent Mode** | **Child Mode** | **Teen Mode** |
|---|---|---|---|
| **Who** | You / caregiver | Young child (~4–9) | Older child / teen (~10–18) |
| **Entry** | PIN-gated | Default open surface | Default open surface |
| **Purpose** | Administer & verify | Play & be rewarded | Self-manage with autonomy |
| **Wear data shown** | Exact numbers, week/month charts, session list | None — just a character "filling up" | Streak, points, hours, progress bars |
| **Track brace on/off** | Yes (+ edit/override) | Yes (big friendly toggle) | Yes |
| **Manual time edits** | Yes, full control + audit | No | **Request only** → parent approves |
| **Set prescribed hours** | Yes (versioned, §4.4) | No | No (view only) |
| **Pick character** | Yes (for the child) | Yes | N/A (or minimal theme) |
| **Manage rewards** | Yes (stock, set costs, approve redemptions) | No | Browse + redeem (parent approves) |
| **Points/streak logic** | Sees & can adjust | Hidden mechanics, visible character | Fully visible — points *are* the game |
| **Tone/visuals** | Clinical, dense, functional | Big, animated, no numbers, zero anxiety | Clean, game-like (Duolingo/Finch), not childish |

**How mode is determined:**
- Each `child` has a **`mode` field = `'child'` or `'teen'`** — this picks the wearer surface. **Chosen during onboarding** via a "Who's using this?" step (not preset), and changeable anytime from Parent Mode. Guidance: roughly `'child'` under ~10, `'teen'` 10+, but fully a judgment call — a mature 9-year-old can be `'teen'`, a young-at-heart 11-year-old can stay `'child'`.
- **Parent Mode is not a `child.mode`** — it's a separate administrator view reached by **PIN** from anywhere. The wearer surface (child/teen) is what's shown by default; the parent taps a corner + enters a PIN to drop into Parent Mode, then returns to the wearer surface.
- **Mode transition over time:** your daughter starts in Child Mode at 4. Years later, still bracing at 11, the parent flips her to Teen Mode. Same account, same history, same streak — the surface grows up with her. That continuity across a decade of one kid's brace journey is genuinely the thing no other app does.

**Why Parent is a mode, not just a screen:** it holds the powers that must *not* live on the wearer surface — editing wear time, changing the goal, approving rewards. Gating those behind a PIN keeps a motivated kid from "adjusting" yesterday's hours to unlock a prize, which would make the whole reward signal meaningless. The child can *request*; only the parent can *authorize*.


### 4.1 Screens (by mode)

**Child Mode**
1. **Home:** Big animated character (her pick from the roster) wearing a brace that "fills up" as hours accrue toward the daily goal. Sticker/streak flame. **No numbers, no percentages, no anxiety.** Tap character → encouragement line.
2. **Track:** One giant **Brace ON / Brace OFF** button. Friendly, obvious, hard to misfire.
3. **Rewards:** Picture grid of prizes; a prize "lights up" when unlocked. Tapping a locked one shows the character cheering her toward it (no point math shown).

**Teen Mode**
1. **Home:** Streak flame, points balance, reward shelf with progress bars ("340 / 500 pts → lip balm"), today's hours vs. goal.
2. **Track:** Brace ON/OFF toggle + elapsed time today; clean and quick.
3. **Rewards:** Shelf with costs and progress; redeem sends a request to the parent for approval.
4. **Request edit:** "I wore it but forgot to log" → submits a time-adjustment request to Parent Mode (never a direct edit).

**Parent Mode** (PIN-gated, reachable from either wearer surface)
1. **Dashboard:** Real numbers — today's hours, week/month chart, current streak, session list with source badges (manual/sensor/override).
2. **Sessions:** View/edit/override any session (audited, with reason), approve pending teen edit-requests.
3. **Prescribed hours:** The adjustable, versioned goal control (§4.4).
4. **Rewards admin:** Stock prizes, set point costs, approve/deny redemptions.
5. **Child settings:** Set `mode` (child/teen), pick/change character, timezone, freeze-token leniency, PIN.

### 4.2 Core logic

**Session tracking (manual):**
- "Brace ON" → open a session (`start_ts = now`).
- "Brace OFF" → close it (`end_ts = now`, compute minutes), rebuild that day's total, re-run reward checks.
- Guard against a session left open overnight: if a session exceeds goal+buffer or crosses ~18 hrs, prompt "Is she still wearing it?" on next open.

**Daily rollup (by *logical day*, not calendar midnight):**
```
goal_for(day)   = goal_history row with latest effective_from <= day
worn_min(day)   = sum(session.minutes where session overlaps [day, day+1),
                      split at the LOGICAL-DAY boundary — see §4.2.1)
met_goal(day)   = worn_min >= goal_for(day).goal_min
```
Because each day is judged against the goal that was in effect *on that day*, re-prescribing hours (e.g. stepping down from 23h to nighttime-only) never rewrites history or retroactively breaks a past streak.

**Streak as a deterministic recompute [R5]:** `current_days`, `longest_days`,
`freeze_tokens`, and `last_qualifying_date` are **never incremented in place** as
the source of truth. They are regenerated by replaying `recomputeStreak()` over
the ordered `daily_totals`. Any change to sessions — including a **retroactive
parent override that flips a past missed day to met** — triggers: rebuild the
affected `daily_totals` rows → replay `recomputeStreak()` from the last stable
point forward. This makes freeze-token accounting reproducible (a re-earned day
re-earns the streak correctly) instead of leaving a mutated counter wrong. Points
stay safe independently via the `UNIQUE(reason, ref)` ledger, so replay never
double-awards.

#### 4.2.1 Logical days & the parent-set day-start hour (critical for nighttime wear)

**The problem:** a nighttime brace is worn *across midnight every night*. If "brace on 9pm Sat → off 7am Sun" is bucketed by calendar date, it splits into ~3h on Saturday + ~7h on Sunday — and with a 12h goal, **neither day passes**, even though she wore it a perfect 10 hours in one continuous stretch. A naive midnight boundary makes a compliant kid look like she's failing every single day. This is a correctness bug, not a nicety.

**The fix:** the "day" is a **logical day** that starts at a **parent-chosen hour** (`child.day_start_hour`, 0–23), not at midnight. Set the cutoff to a time the brace is *never* on — for a nighttime wearer, mid-to-late afternoon (e.g. **5pm**). Then:
- A logical day runs from `day_start_hour` on date D to `day_start_hour` on date D+1.
- **All of Saturday night's sleep** — 9pm Sat through 7am Sun — falls inside the single logical day that began 5pm Saturday. It counts as **one 10-hour day.** ✅

**Labeling convention (documented, consistent):** a logical day is labeled by the calendar date on which it *starts*. So the 5pm-Sat → 5pm-Sun window is **"Saturday."** Saturday-night wear counts toward Saturday. (This is a deliberate choice; the alternative — labeling by wake date — is equally valid but we pick start-date and stick to it everywhere.)

**Mapping a timestamp to its logical day (tz explicit [R4]):**
```
logicalDay(ts, day_start_hour, tz):
    local = ts converted into `tz`      # tz is child.timezone, passed in — never implicit device-local
    if local.hour < day_start_hour:
        return (local.date - 1 day)     # belongs to yesterday's logical day
    else:
        return local.date
```

**Session splitting:** sessions are split at logical-day boundaries exactly as they were conceptually split at midnight — just at `day_start_hour` instead of 00:00. A session spanning the cutoff contributes its pre-cutoff minutes to one logical day and its post-cutoff minutes to the next. (For a well-chosen cutoff in the brace's "dead zone," this rarely even triggers, because she's not wearing it at 5pm.)

**Defaults & modes:**
- **Default `day_start_hour = 0`** (midnight) — correct for daytime wearers, so nothing changes for them.
- **Seeded for this build: prompt to set it during onboarding right after prescribed hours.** Since her Rx is *nighttime* 12h, onboarding should suggest an afternoon cutoff (default suggestion **5pm / `17`**) and explain why in one line ("so a full night counts as one day").
- Fully adjustable anytime in Parent Mode, same as the goal.

**Choosing a good cutoff:** the ideal `day_start_hour` sits in the window when the brace is reliably *off* and she's awake — for nighttime wear, afternoon is safest. Avoid setting it during typical wear hours, or a real session gets split across two logical days (still counted correctly in total, but spread across two days' goals). A short helper in Parent Mode can suggest a cutoff by looking at when she's *least* often wearing it once there's data.

**DST caveat:** `day_start_hour` is a wall-clock local hour, so a logical day is occasionally 23 or 25 hours long across a DST change. We bucket by wall-clock and accept the rare off-length day — far less disruptive than splitting nights. (The `logicalDay` DST cases are explicitly covered by tests, §7.5.)

**Streak (lenient by default):**
- On each **logical day** that `met_goal` flips true → `current_days++`, award daily points.
- A missed day spends a `freeze_token` if available (streak survives), else resets `current_days = 0`.
- **Lenient config:** start with **2 freeze tokens**, refill **+1 per 5 met-goal days**, cap at **3**. This means an occasional off day almost never nukes her progress — chosen deliberately to avoid early discouragement, which is the #1 way a young kid abandons a streak.
- All of the above is expressed inside the pure `recomputeStreak()` function (§4.2, §7.5), so it stays deterministic and testable.

**Points (idempotent):**
- `daily_goal` → +10, keyed on the date (UNIQUE prevents double-award on recompute).
- `streak_bonus` → +N at milestones (7/30/90 days).
- `redeem` → negative delta when a reward is claimed.
- Balance = `SUM(delta)`.

### 4.3 Character roster (Child Mode picker)

On first run (and re-selectable any time from Parent Mode / settings), she picks her buddy from a roster of 15. The chosen character is the "fills up" avatar on the Child Mode Home screen, levels up with streaks, and delivers the encouragement lines. Let *her* pick — ownership of the character is a real motivator at this age. (Teen Mode uses a minimal theme rather than the character, though a teen who likes it can keep one.)

| # | Character | Vibe / why it's in |
|---|---|---|
| 1 | **Axolotl** ⭐ *(default)* | Cute, regenerates — quietly perfect "healing/getting stronger" symbolism. Pre-selected default. |
| 2 | **Bear** | Cozy, strong, protective. |
| 3 | **Tiger** | Bold, brave, "strong core." |
| 4 | **Dragon** | Powerful, magical, grows fierce as it levels. |
| 5 | **Fox** | Clever, spunky. |
| 6 | **Owl** | Wise, calm — good for kids who like quiet. |
| 7 | **Unicorn** | Magic + sparkle tier. |
| 8 | **Penguin** | Silly, waddly, huggable. |
| 9 | **Cat** | Universally beloved, sassy. |
| 10 | **Wolf** | Loyal, pack-strong. |
| 11 | **Bunny** | Gentle, soft, encouraging. |
| 12 | **Panda** | Chill, cuddly, funny. |
| 13 | **Dolphin** | Playful, smart, water-world theming. |
| 14 | **Koala** | Sleepy, sweet, low-key. |
| 15 | **Phoenix** | Rises/renews — strong comeback symbolism after a hard day. |

Implementation: store `character_id` on `child` (e.g. `'axolotl'`, the default). Each character is a small set of art states keyed to level/goal-progress (empty → filling → full → celebrating). **Start with emoji-style placeholders** per character (🐉 🐻 🐯 🦊 🦉 🦄 🐧 🐱 🐺 🐰 🐼 🐬 🐨 🔥 for phoenix, and an axolotl stand-in); swap in real sprites once the loop proves out. The roster is a config array so adding a 16th is a one-line change.

### 4.4 Adjustable prescribed hours (a real feature, not a setup value)

Brace prescriptions change over treatment — post-op nighttime-only, then 16h, then 23h, then weaning back down — so the daily goal is a first-class, editable setting with history, not a number you enter once.

**In the parent screen:**
- A **"Prescribed hours"** control: set hours/day (or pick a preset: *Nighttime ~8h*, *Nighttime 12h*, *12h*, *16h*, *20h*, *23h*, *Custom*). *(Seeded starting value for this build: **12h nighttime** = 720 min.)*
- Optional label + effective date (defaults to today).
- Saving writes a new `goal_history` row; it does **not** overwrite the old one.
- A small history list shows past prescriptions ("Nighttime 12h from Jul 18 → 16h from Oct 1"), so the change log doubles as a treatment timeline you could show the orthotist.

**Why history matters:** past days keep being judged by the goal that applied then. Change the Rx today and yesterday's "met goal" stays true. Streaks, points, and the progress chart all stay honest across a prescription change — which *will* happen during a multi-year brace course.

### 4.5 Seeded mock rewards (starter shelf, by mode)

To make the reward shelf real from day one — and to see the actual payoff screen she'd get — the app ships with a **starter set of mock rewards** tied to the streak milestones you named: **weekly (7 met-goal days), two-week (14), monthly (~30).** These are placeholders you can edit, delete, or re-cost in Parent Mode; they exist so the loop is testable immediately without you having to build a catalog first.

**Milestone → reward mapping is mode-aware**, because a 6-year-old and a 15-year-old are motivated by completely different prizes:

**Teen Mode — beauty rewards (Sephora / Ulta):**

| Milestone | Mock reward | Notes |
|---|---|---|
| 7-day streak | **Ulta or Sephora lip balm** (small named item) | Lip balm is a real low-cost item at both — a believable "first unlock." |
| 14-day streak | **$10 Sephora / Ulta gift card** | $10 is the actual minimum denomination at both retailers. |
| 30-day streak | **Beauty gift/value set (under ~$35)** | Both stores carry sub-$35 value sets — a bigger "monthly" payoff. |

**Child Mode — small-prize rewards (Dollar Store / Five Below):**

| Milestone | Mock reward | Notes |
|---|---|---|
| 7-day streak | **Dollar store prize pick** (sticker sheet, small toy, candy) | Immediate, tangible, age-right. |
| 14-day streak | **Five Below item (~$5)** | Squishmallow-style mini, fidget, craft kit — the ~$5 tier. |
| 30-day streak | **Five Below "big" pick (~$10–15)** | A larger toy/game as the monthly headline prize. |

**How it's modeled — one standardized unlock mechanism [R6]:**
- **Seeded milestone rewards use `unlock_type='streak_days'`** with `unlock_value` = 7 / 14 / 30. The milestone → reward tie is then *exact* ("hit 7 met-goal days → lip balm unlocks") and trivial for a parent to reason about. This resolves the earlier draft's ambiguity between points-priced and streak-gated unlocks.
- `unlock_type='points'` **stays in the schema as a supported-but-unused option** for any ad-hoc reward the parent adds later and wants priced in points; the seeded shelf does not use it.
- **Mock vs. real:** these are labeled clearly as samples in Parent Mode ("Sample reward — tap to edit or replace"). When you actually stock a real lip balm or gift card, you edit the row. The redemption flow still routes through parent approval (you physically hand over the prize / gift card).
- **Nothing is auto-purchased.** A "redeem" just marks the reward claimed and notifies Parent Mode; you provide the real-world item. (This also keeps the prototype free of any real payment/commerce surface — important for staying in the safe wellness-app lane.)

Schema recap (already reflected in §3's `rewards` table):
```sql
rewards (
  ... existing columns ...
  mode         TEXT,   -- 'child' | 'teen' — which surface shows it
  unlock_type  TEXT,   -- 'points' | 'streak_days'  (seeded milestones = 'streak_days')
  unlock_value INTEGER,-- e.g. 7, 14, 30 (days) or a point cost
  is_sample    INTEGER -- 1 = seeded mock, 0 = real reward you stocked
)
```

### 4.6 What to measure (this is the experiment) [R1]

The reward loop is **on from day one** — no silent baseline period (motivation
now beats a clean control for a personal prototype). Because there is no true
"before" window, the experiment is designed to still yield honest signal:

- **Recall baseline at onboarding:** capture a one-time parent estimate of "how
  many hours/night before the app" (number + free-text note), stored in
  `settings`. Soft, self-reported evidence — labeled as such, not treated as a
  measured control.
- **Measure the trend, not a clean A/B:** the honest read is *does daily hours
  rise over the first few weeks as the loop takes hold, and do the jumps track
  reward events?* Keep the parent-view chart of daily hours over time and
  **annotate it with reward-redemption markers**, so you can eyeball whether
  rises follow payoffs.
- Also log: which reward tiers she actually pushes for; whether streaks or points
  seem to drive more behavior.

**Stated limitation (write this into any conclusion):** without a control period
this shows **correlation** (adherence trending up alongside rewards), not
causal **proof**. That's an acceptable bar for a one-child prototype — just don't
over-claim it. If a cleaner causal read is ever wanted, that's a future,
deliberately-designed on/off phase, not something to bolt on mid-stream.

---

## 5. P2 — Calibration + Bluetooth

### 5.1 Hardware (the cheap, ungated path)
- **ESP32** dev board (~$10) — BLE built in.
- **DS18B20** digital temp probe *or* a small thermistor, tucked flush against the inside of the brace (Cor-Esc-25 and the Cricket both place the sensor at the brace–skin interface).
- ESP32 firmware broadcasts temperature as a BLE characteristic every N seconds (start 60s; the clinical Cricket sampled every 10 min, but denser is fine for a prototype).
- App uses `react-native-ble-plx` to subscribe to the characteristic, write each sample to `readings`.

**Wearable realities to solve when P2 starts (named now so they're not a surprise) [R7]:** a small LiPo + charging path (battery life target), an enclosure small enough to sit comfortably at the brace–skin interface, and a wipe-clean / removable-for-wash story. All acceptable to defer past P1, but they gate a genuinely wearable sensor.

### 5.2 Session detection from readings
Once a threshold `T` is known (see calibration), convert raw samples to sessions:
- Sample is "worn" if `temp_c >= T`.
- Bridge short gaps (bathroom/shower) up to `maxGapMin` (~30 min).
- Ignore blips shorter than `minSessionMin` (~20 min).
- Emit `wear_sessions` rows with `source='sensor'`.

This is the same session-emitting step as manual tracking — so the reward/streak/UI layer from P1 doesn't change at all.

---

## 6. Calibration Feature (the threshold, done properly)

**Goal:** Replace "eyeball the gap" with a short guided routine that collects labeled data and computes a suggested threshold using **several independent methods**, then reconciles them into a recommended value + range. One child, one home — so this can be simple *and* rigorous.

### 6.1 Data collection wizard
A guided flow in the app that produces labeled temperature samples:

1. **Ambient baseline (OFF):** "Place the sensor where the brace normally rests when it's off (dresser/shelf). Leave it 15 minutes." → collect `readings` labeled `off`.
2. **Worn baseline (ON):** "Put the brace on as normal. Wear 20–30 minutes doing normal activity." → collect `readings` labeled `on`.
3. *(Optional but recommended)* **Repeat once more** at a different time of day (evening vs. midday) so ambient variation across the day is captured.
4. **Edge captures (optional):** a few minutes right after taking it off (cooling curve) and a "worn while active/warm" sample, to see the messy boundary.

The wizard timestamps and labels every sample, so we end with two distributions: `T_off[]` and `T_on[]`.

### 6.2 Threshold methods (compute all, then reconcile)

Each method proposes a candidate threshold from the labeled data.

**Method A — Midpoint of means.**
```
T_A = (mean(T_on) + mean(T_off)) / 2
```
Simple, robust when the two clusters are clean and roughly symmetric.

**Method B — Gap split (max-separation).**
Sort all samples; find the largest temperature gap that lies between the on-cluster and off-cluster; put the threshold in the middle of that gap.
```
T_B = midpoint of the widest empty interval separating the clusters
```
Mirrors the "eyeball the gap" intuition, computed exactly.

**Method C — Std-dev buffer above ambient.**
Set the threshold a few standard deviations above ambient, so normal room-temp fluctuation never reads as "worn."
```
T_C = mean(T_off) + k * std(T_off)      // k ≈ 2–3
```
Conservative against false "worn" readings on a hot day.

**Method D — Equal-error / crossover point.**
Model each class as roughly normal; find the temperature where the two bell curves cross (the point minimizing combined false-on + false-off). This is the statistically "balanced" boundary.
```
T_D = temperature where P(temp | on) == P(temp | off)
```
If the distributions are clean this often lands near Otsu's threshold (below).

**Method E — Otsu's method (distribution-free).**
Treat the pooled samples as a histogram and find the threshold that maximizes between-class variance — the classic image-binarization trick, which works well for any clearly bimodal data without assuming normality.
```
T_E = argmax over t of between_class_variance(t)
```

### 6.3 Reconciliation → suggested range
- Compute `T_A..T_E`.
- **Recommended threshold** = **median** of the five (resistant to any single method misbehaving).
- **Suggested range** = `[min(T_*), max(T_*)]`, clamped into the clinically sane band (**28–32 °C**, per the literature) so a bad capture can't produce a silly value.
- **Confidence signal:** report the spread. If all five agree within ~1 °C → high confidence, auto-suggest. If they scatter >2 °C → flag "captures were noisy, recommend re-running the worn baseline," because it usually means the on/off samples overlapped (sensor not flush, very hot room, too-short wear).
- **Separation check:** if `mean(T_on) - mean(T_off) < ~3 °C`, warn that the clusters are too close to threshold reliably and suggest repositioning the sensor.

### 6.4 Output
The calibration screen shows:
- A histogram of `on` vs `off` samples (two colored distributions).
- The five candidate lines overlaid.
- The recommended threshold (median) as a bold line, with the suggested range shaded.
- A plain-language verdict: *"Recommended: 30.5 °C. Confident — all methods agree within 0.8 °C. Anything from 29.8 to 31.1 works for your setup."*
- A slider to accept the recommendation or nudge it, writing the chosen `T` to settings for session detection.

### 6.5 Pseudo-code
```ts
function calibrate(onSamples: number[], offSamples: number[]): CalibrationResult {
  const A = (mean(onSamples) + mean(offSamples)) / 2;
  const B = widestGapMidpoint(onSamples, offSamples);
  const C = mean(offSamples) + 2.5 * std(offSamples);
  const D = gaussianCrossover(onSamples, offSamples);
  const E = otsu([...onSamples, ...offSamples]);

  const candidates = [A, B, C, D, E];
  const recommended = clamp(median(candidates), 28, 32);
  const range: [number, number] = [
    clamp(Math.min(...candidates), 28, 32),
    clamp(Math.max(...candidates), 28, 32),
  ];

  const spread = Math.max(...candidates) - Math.min(...candidates);
  const separation = mean(onSamples) - mean(offSamples);
  const confidence =
    spread <= 1 && separation >= 3 ? 'high'
    : spread <= 2 ? 'medium'
    : 'low';

  return { candidates: { A, B, C, D, E }, recommended, range, confidence, separation, spread };
}
```

Re-runnable any time — seasons change, she grows, the sensor moves. It's a settings screen, not a one-time setup.

---

## 7. Suggested Build Order (concrete)

**Week 1 — P1 skeleton**
1. Expo app scaffold, SQLite schema (**incl. `child.timezone` and the `settings` table [R4][R1]**), Zustand store.
2. **Pure-function core-logic module + its Jest test suite (§7.5), green before UI [R3]:** `logicalDay`, `splitSessionByLogicalDay`, `rollupDay`, `recomputeStreak`, `applyPoints`.
3. Brace ON/OFF tracker + live timer + session write, wired to the tested core.
4. Rewards grid seeded with mode-aware mock samples (Teen: Sephora/Ulta lip balm → $10 card → gift set; Child: dollar-store → $5 Five Below → $10-15 Five Below), tied to 7/14/30-day streak milestones via **`unlock_type='streak_days'` [R6]**.
5. Mode routing (Child/Teen wearer surfaces + PIN-gated Parent Mode) + character picker (15-roster) + Child Mode character screen that "fills up" toward the daily goal.
6. PIN-gated parent view: daily-hours chart (**with reward-redemption markers [R1]**) + adjustable prescribed-hours control (seed the first `goal_history` row) + **recall-baseline capture at onboarding [R1]**.

**Week 2+ — live with it**
7. Use it daily with your daughter. Watch the annotated chart for an upward trend that tracks reward events. Tune reward costs. **No reminders [R2].**
8. Decide: is the loop working? (Thesis check — read as correlation, per §4.6.)

**Later — P2 when ready**
9. Flash ESP32, get temperature over BLE into `readings`.
10. Build the calibration wizard + the five-method reconciliation.
11. Flip session detection to sensor-driven; manual becomes the override.

### 7.5 Testing the core logic [R3]

Jest + `ts-jest`. The logic is written as **pure functions over inputs** (no
SQLite, no device), so it runs fast and deterministically in CI or locally.
These five are tested before being wired to the UI; no UI or BLE tests in P1.

- **`logicalDay(ts, dayStartHour, tz)`** — before/after cutoff; exact-boundary
  timestamp; midnight (`0`) default; the DST 23h and 25h days.
- **`splitSessionByLogicalDay(session, dayStartHour, tz)`** — a session spanning
  the cutoff splits into correct pre/post minute buckets; a session wholly inside
  one logical day is untouched.
- **`rollupDay(sessions, goalHistory, date)`** — `worn_min`; correct goal lookup
  (the goal in effect *on that date*, not today's); `met_goal`.
- **`recomputeStreak(dailyTotals, config)`** — clean run; single miss with a token
  available (survives); miss with no token (resets); token refill at the 5-day
  cadence; cap at 3; **retroactive insertion of a met day mid-history replays
  correctly**.
- **`applyPoints(ledger, event)`** — re-applying the same `(reason, ref)` is a
  no-op; balance = `SUM(delta)`.

---

## 8. Decisions (resolved) & experiment framing

**Resolved (all seed values known):**
- ✅ **Default character** — **Axolotl.** Pre-selected default in the roster (changeable).
- ✅ **Mode selection** — **Ask during onboarding.** Not preset; Parent Mode can change it later.
- ✅ **Streak forgiveness** — **Lenient.** 2 freeze tokens, refill +1 per 5 met-goal days, cap 3.
- ✅ **Character art** — **Emoji/placeholder to start;** swap real sprites in later.
- ✅ **Reward tiers & costs** — seeded mocks (§4.5): 7/14/30-day, mode-aware, **unlocked by `streak_days` [R6]**.
- ✅ **Starting prescribed hours** — **12h, nighttime.** Seeds `goal_history` row 1 = `goal_min = 720`, `label = "Nighttime 12h"`, `effective_from = <setup date>`. Starting value, not a fixed setting — see the adjustability guarantee below.
- ✅ **Logical-day cutoff (`day_start_hour`)** — **needed for nighttime wear; suggested 5pm (17).** Parent-set, defaults to midnight for daytime wearers, adjustable anytime.
- ✅ **Timezone** — **stored explicitly on `child` [R4]**, defaulting to device tz at setup, editable in Parent Mode.
- ✅ **Baseline / experiment design** — **rewards start immediately (no silent control) [R1].** Capture a recall baseline at onboarding; read results as a reward-annotated *trend* (correlation, not causal proof — §4.6).
- ✅ **Reminders** — **none in P1 [R2].** Notifications available but deferred, so the reward loop is the only intervention under test; any future reminders are a separate, logged experiment.
- ✅ **Testing** — **unit-test the core logic [R3]** (§7.5) before wiring UI.

**Adjustability guarantee (first-class, permanent feature — not one-time setup):**
The 12h goal is stored as *row 1 of a versioned history*, never a locked field. The parent can **change the goal at any time, forever**, and the app handles it correctly:
- Parent Mode → "Prescribed hours" → set a new value (preset or custom) + optional label + effective date → saves a **new `goal_history` row**. The old row is preserved, never overwritten.
- The current goal = the row with the latest `effective_from <= today`.
- Each past day is judged against the goal in effect *on that day*, so **changing the goal never retroactively alters past streaks, points, or the progress chart.**
- The history list becomes a treatment timeline (e.g. "Nighttime 12h from Jul 18 → 16h from Oct 1 → weaning 8h from Feb 2027"), which doubles as something you could show her orthotist.
- No code change, no reinstall, no data loss to adjust — it's a routine Parent Mode action.

**Onboarding flow (reflecting the above):**
1. Welcome → create child (name).
2. **Ask mode** — "Who's using this?" → Child surface or Teen surface.
3. Pick character (default **Axolotl** highlighted).
4. **Set prescribed hours** — starting goal (seeds `goal_history` row 1); presets + custom. **Defaults to 12h nighttime (720 min)** for this build; fully changeable later.
5. **Set day-start hour** — the logical-day cutoff (§4.2.1). Because her Rx is *nighttime*, suggest **5pm (17)** with a one-line why ("so a full night of wear counts as one day, not split across midnight"). Defaults to midnight for daytime wearers. Changeable anytime.
6. **Recall baseline [R1]** — one-line prompt: "Roughly how many hours/night was she wearing it before this app?" (number + optional note). Stored in `settings`; labeled as a self-reported estimate.
7. Confirm/set timezone (defaults to device) **[R4]**.
8. Set Parent PIN.
9. Land on the chosen wearer surface. Done.
