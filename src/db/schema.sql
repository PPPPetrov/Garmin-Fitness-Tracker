-- Garmin Fitness Tracker schema.
-- Every table keeps enough provenance to trace a number on screen back to a ride.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Normalized ride records. One row per Garmin activity.
CREATE TABLE IF NOT EXISTS activity (
  activity_id            INTEGER PRIMARY KEY,
  activity_name          TEXT,
  activity_type          TEXT    NOT NULL,
  -- start_time_local is Garmin's own local wall clock; local_date is what we group days by.
  start_time_local       TEXT    NOT NULL,
  start_time_gmt         TEXT,
  local_date             TEXT    NOT NULL,
  time_zone              TEXT,

  -- Garmin reports three different durations and they disagree. Keep all three.
  duration_s             REAL,
  moving_duration_s      REAL,
  elapsed_duration_s     REAL,

  distance_m             REAL,
  elevation_gain_m       REAL,
  elevation_loss_m       REAL,
  calories               REAL,

  avg_hr                 INTEGER,
  max_hr                 INTEGER,
  avg_cadence            REAL,
  avg_temperature        REAL,

  -- Power fields. NULL on mountain-bike rides: no power meter, not a zero.
  avg_power              REAL,
  max_power              REAL,
  normalized_power       REAL,
  max_power_20min        REAL,
  ftp_at_ride            REAL,
  intensity_factor       REAL,
  training_stress_score  REAL,

  -- Present on every ride regardless of power meter. The primary load series.
  activity_training_load REAL,
  training_effect        REAL,
  anaerobic_training_effect REAL,
  training_effect_label  TEXT,

  location_name          TEXT,
  uploaded_at            TEXT,
  last_updated_at        TEXT,
  imported_at            TEXT    NOT NULL,
  detail_fetched         INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_activity_local_date ON activity(local_date);
CREATE INDEX IF NOT EXISTS idx_activity_type       ON activity(activity_type);

-- Original API responses, kept verbatim so reprocessing never needs another round trip.
CREATE TABLE IF NOT EXISTS activity_raw (
  activity_id INTEGER PRIMARY KEY REFERENCES activity(activity_id) ON DELETE CASCADE,
  list_json   TEXT,
  detail_json TEXT,
  fetched_at  TEXT NOT NULL
);

-- Peak mean power per duration, parsed from the FIT file.
-- Only exists for rides with a power meter.
CREATE TABLE IF NOT EXISTS power_curve (
  activity_id INTEGER NOT NULL REFERENCES activity(activity_id) ON DELETE CASCADE,
  duration_s  INTEGER NOT NULL,
  watts       REAL    NOT NULL,
  PRIMARY KEY (activity_id, duration_s)
);

-- FIT download and parse state, so an interrupted backfill can resume.
CREATE TABLE IF NOT EXISTS fit_file (
  activity_id   INTEGER PRIMARY KEY REFERENCES activity(activity_id) ON DELETE CASCADE,
  status        TEXT    NOT NULL CHECK (status IN ('pending','downloaded','parsed','skipped','failed')),
  byte_size     INTEGER,
  record_count  INTEGER,
  power_records INTEGER,
  sample_rate_s REAL,
  error         TEXT,
  updated_at    TEXT    NOT NULL
);

-- Daily load model output. Recomputed wholesale; cheap at this data volume.
CREATE TABLE IF NOT EXISTS daily_load (
  local_date      TEXT PRIMARY KEY,
  load_points     REAL    NOT NULL,
  ride_count      INTEGER NOT NULL,
  fitness         REAL    NOT NULL,
  fatigue         REAL    NOT NULL,
  form            REAL    NOT NULL,
  -- 1 while inside the 42-day seeding window, where the curve is not yet meaningful.
  is_warmup       INTEGER NOT NULL DEFAULT 0,
  -- Rides on this day that Garmin gave no training load. They are real training that
  -- the curve cannot see, so the day understates the work done.
  unmeasured_rides INTEGER NOT NULL DEFAULT 0,
  -- 1 when any day in the preceding 42 days had an unmeasured ride, so this day's
  -- fitness value is built on an incomplete window.
  is_estimated    INTEGER NOT NULL DEFAULT 0,
  formula_version TEXT    NOT NULL,
  computed_at     TEXT    NOT NULL
);

-- One row per sync attempt.
CREATE TABLE IF NOT EXISTS sync_run (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at       TEXT NOT NULL,
  finished_at      TEXT,
  mode             TEXT NOT NULL,
  activities_seen  INTEGER NOT NULL DEFAULT 0,
  activities_added INTEGER NOT NULL DEFAULT 0,
  activities_updated INTEGER NOT NULL DEFAULT 0,
  details_fetched  INTEGER NOT NULL DEFAULT 0,
  fit_downloaded   INTEGER NOT NULL DEFAULT 0,
  coverage_start   TEXT,
  coverage_end     TEXT,
  status           TEXT NOT NULL CHECK (status IN ('running','ok','failed')),
  error            TEXT
);
