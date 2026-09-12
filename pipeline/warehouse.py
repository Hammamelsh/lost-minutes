"""DuckDB history for Lost Minutes: raw inputs, runs, observations and publications.

Table grain, stated plainly:
  raw_source          one row per distinct raw response *content* (SHA-256 of the bytes).
  pipeline_run        one row per pipeline run.
  source_processing   one row per (run, raw source) attempt. This is the restart checkpoint.
  observation         one row per accepted observation identity:
                      (operator, vehicle, route, direction, journey_ref, observed_at_ms).
  observation_conflict one row per identity/source pair that disagreed on coordinates.
  rejection           one row per (run, source, reason) with a record count.
  publication         one row per publication attempt, successful or not.
  validation_check    one row per named check per publication.

Nothing here infers stop arrivals, punctuality or delay. It records what arrived, what was
kept, what was refused and what was served.
"""
from __future__ import annotations

import hashlib
import json
import os
import secrets
from datetime import datetime, timezone
from pathlib import Path

try:
    import duckdb
except ModuleNotFoundError as error:  # pragma: no cover - environment guard
    raise ModuleNotFoundError(
        'DuckDB is required for the pipeline history. Install it with '
        '"python3 -m venv .venv && .venv/bin/pip install -r requirements.txt" '
        'and run the pipeline with .venv/bin/python.'
    ) from error

from .core import redact_url, timestamp, utc_now

SCHEMA_VERSION = 1
DEFAULT_DB = Path('data/warehouse/lost-minutes.duckdb')

# The observation identity. Same key + same coordinates is a repeat. Same key + different
# coordinates is a conflict. A new timestamp is always a different identity, so a bus that
# has not moved still produces a new observation.
IDENTITY = ('operator', 'vehicle', 'route', 'direction', 'journey_ref', 'observed_at_ms')
IDENTITY_SQL = ', '.join(IDENTITY)

DDL = f"""
CREATE TABLE IF NOT EXISTS schema_meta (
    schema_version INTEGER NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS raw_source (
    source_sha256     TEXT PRIMARY KEY,
    source_kind       TEXT NOT NULL,
    source_url        TEXT,            -- redacted; never credential-bearing
    stored_path       TEXT,
    byte_size         BIGINT,
    captured_at       TIMESTAMPTZ,     -- when the upstream archive/feed produced it
    retrieved_at      TIMESTAMPTZ,     -- when we read or fetched it
    first_seen_run_id TEXT,
    first_seen_at     TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS pipeline_run (
    run_id            TEXT PRIMARY KEY,
    mode              TEXT NOT NULL,   -- archive_import | live_capture | reprocess
    status            TEXT NOT NULL,   -- running | succeeded | failed | interrupted
    is_historical     BOOLEAN NOT NULL,
    started_at        TIMESTAMPTZ NOT NULL,
    finished_at       TIMESTAMPTZ,
    sources_seen      INTEGER DEFAULT 0,
    sources_processed INTEGER DEFAULT 0,
    resumed_from      TEXT,
    error_class       TEXT,
    error_detail      TEXT,            -- redacted message, never a URL with a key
    note              TEXT
);

CREATE TABLE IF NOT EXISTS source_processing (
    run_id                   TEXT NOT NULL,
    source_sha256            TEXT NOT NULL,
    source_label             TEXT,
    outcome                  TEXT NOT NULL,   -- pending | succeeded | failed
    started_at               TIMESTAMPTZ,
    finished_at              TIMESTAMPTZ,
    cache_hit                BOOLEAN,
    activities_total         INTEGER DEFAULT 0,
    activities_in_area       INTEGER DEFAULT 0,
    outside_area             INTEGER DEFAULT 0,
    new_observations         INTEGER DEFAULT 0,
    repeat_observations      INTEGER DEFAULT 0,
    conflicting_observations INTEGER DEFAULT 0,
    rejected_records         INTEGER DEFAULT 0,
    error_class              TEXT,
    error_detail             TEXT,
    PRIMARY KEY (run_id, source_sha256)
);

CREATE TABLE IF NOT EXISTS observation (
    operator          TEXT NOT NULL,
    vehicle           TEXT NOT NULL,
    route             TEXT NOT NULL,
    direction         TEXT NOT NULL,
    journey_ref       TEXT NOT NULL,
    observed_at_ms    BIGINT NOT NULL,
    observed_at       TIMESTAMPTZ NOT NULL,
    recorded_at_text  TEXT NOT NULL,   -- exact source string, original offset preserved
    lat               DOUBLE NOT NULL,
    lon               DOUBLE NOT NULL,
    destination       TEXT,
    origin            TEXT,
    aimed_departure   TEXT,
    source_sha256     TEXT NOT NULL,   -- lineage: the source that first supplied this row
    source_member     TEXT,
    retrieved_at      TIMESTAMPTZ,
    first_seen_run_id TEXT,
    first_seen_at     TIMESTAMPTZ,
    PRIMARY KEY ({IDENTITY_SQL})
);

CREATE TABLE IF NOT EXISTS observation_conflict (
    operator            TEXT NOT NULL,
    vehicle             TEXT NOT NULL,
    route               TEXT NOT NULL,
    direction           TEXT NOT NULL,
    journey_ref         TEXT NOT NULL,
    observed_at_ms      BIGINT NOT NULL,
    kind                TEXT NOT NULL,   -- within_batch | with_stored
    stored_lat          DOUBLE,
    stored_lon          DOUBLE,
    stored_source       TEXT,
    incoming_lat        DOUBLE,
    incoming_lon        DOUBLE,
    incoming_source     TEXT NOT NULL,
    detected_run_id     TEXT,
    detected_at         TIMESTAMPTZ,
    PRIMARY KEY ({IDENTITY_SQL}, incoming_source)
);

CREATE TABLE IF NOT EXISTS rejection (
    run_id        TEXT NOT NULL,
    source_sha256 TEXT NOT NULL,
    reason        TEXT NOT NULL,
    record_count  INTEGER NOT NULL,
    PRIMARY KEY (run_id, source_sha256, reason)
);

CREATE TABLE IF NOT EXISTS quarantined_record (
    quarantine_id  TEXT PRIMARY KEY,   -- hash of source + reason + raw fields
    run_id         TEXT,
    source_sha256  TEXT NOT NULL,
    reason         TEXT NOT NULL,      -- a source-quality problem, not a pipeline failure
    detail         TEXT,
    source_member  TEXT,
    -- Raw field text exactly as supplied. Never repaired, rounded or reinterpreted.
    recorded_at_raw TEXT,
    latitude_raw   TEXT,
    longitude_raw  TEXT,
    operator_raw   TEXT,
    vehicle_raw    TEXT,
    route_raw      TEXT,
    direction_raw  TEXT,
    journey_ref_raw TEXT,
    first_seen_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS collection_cycle (
    run_id              TEXT NOT NULL,
    cycle_no            INTEGER NOT NULL,
    requested_at        TIMESTAMPTZ NOT NULL,
    completed_at        TIMESTAMPTZ,
    outcome             TEXT NOT NULL,  -- succeeded | repeat_payload | http_error
                                        -- | transport_error | malformed
    http_status         INTEGER,
    source_sha256       TEXT,
    byte_size           BIGINT,
    payload_changed     BOOLEAN,
    observations_loaded INTEGER DEFAULT 0,
    error_class         TEXT,
    error_detail        TEXT,           -- redacted; never a credential-bearing URL
    PRIMARY KEY (run_id, cycle_no)
);

CREATE TABLE IF NOT EXISTS timetable_version (
    content_sha256        TEXT PRIMARY KEY,
    source_url            TEXT,         -- redacted
    stored_path           TEXT,
    byte_size             BIGINT,
    retrieved_at          TIMESTAMPTZ,
    -- Declared by the file where present. Absent is recorded as NULL, never assumed.
    effective_from        DATE,
    effective_to          DATE,
    modification_datetime TEXT,
    dataset_label         TEXT,
    first_seen_run_id     TEXT,
    note                  TEXT
);

CREATE TABLE IF NOT EXISTS publication (
    publication_id    TEXT PRIMARY KEY,
    run_id            TEXT,
    snapshot_id       TEXT,
    kind              TEXT DEFAULT 'replay',   -- replay | live
    status            TEXT NOT NULL,   -- published | failed_validation | held_back
    built_at          TIMESTAMPTZ,
    published_at      TIMESTAMPTZ,
    observation_count INTEGER,
    journey_count     INTEGER,
    source_count      INTEGER,
    window_start_ms   BIGINT,
    window_end_ms     BIGINT,
    snapshot_sha256   TEXT,
    snapshot_bytes    BIGINT,
    target_path       TEXT,
    archived_path     TEXT,
    failure_reason    TEXT
);

CREATE TABLE IF NOT EXISTS validation_check (
    publication_id TEXT NOT NULL,
    check_name     TEXT NOT NULL,
    passed         BOOLEAN NOT NULL,
    detail         TEXT,
    PRIMARY KEY (publication_id, check_name)
);
"""

# Conflicted identities stay in `observation` as evidence but are withheld from anything
# published. Suppression is recorded, never silent.
VIEWS = f"""
CREATE OR REPLACE VIEW v_publishable_observation AS
SELECT o.* FROM observation o
WHERE NOT EXISTS (
    SELECT 1 FROM observation_conflict c
    WHERE {' AND '.join(f'c.{col} = o.{col}' for col in IDENTITY)}
);

CREATE OR REPLACE VIEW v_run_totals AS
SELECT r.run_id, r.mode, r.status, r.is_historical, r.started_at, r.finished_at,
       r.resumed_from, r.error_class, r.error_detail,
       r.sources_seen, r.sources_processed,
       COALESCE(SUM(p.activities_total), 0)         AS activities_total,
       COALESCE(SUM(p.activities_in_area), 0)       AS activities_in_area,
       COALESCE(SUM(p.outside_area), 0)             AS outside_area,
       COALESCE(SUM(p.new_observations), 0)         AS new_observations,
       COALESCE(SUM(p.repeat_observations), 0)      AS repeat_observations,
       COALESCE(SUM(p.conflicting_observations), 0) AS conflicting_observations,
       COALESCE(SUM(p.rejected_records), 0)         AS rejected_records
FROM pipeline_run r
LEFT JOIN source_processing p ON p.run_id = r.run_id
GROUP BY ALL;
"""


def new_run_id(mode):
    return f"{datetime.now(timezone.utc):%Y%m%dT%H%M%S}-{mode}-{secrets.token_hex(3)}"


def connect(db_path=DEFAULT_DB):
    """Open (creating if needed) the local warehouse. Single process, single file."""
    path = Path(db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(str(path))
    con.execute('BEGIN')
    con.execute(DDL)
    con.execute(VIEWS)
    # Additive migration for warehouses created before the live milestone.
    try:
        con.execute("ALTER TABLE publication ADD COLUMN IF NOT EXISTS kind TEXT DEFAULT 'replay'")
    except Exception:  # pragma: no cover - already present on a fresh schema
        pass
    if con.execute('SELECT count(*) FROM schema_meta').fetchone()[0] == 0:
        con.execute('INSERT INTO schema_meta VALUES (?, now())', [SCHEMA_VERSION])
    con.execute('COMMIT')
    return con


# --------------------------------------------------------------------------- runs

def start_run(con, mode, is_historical=True, note=None, resumed_from=None):
    run_id = new_run_id(mode)
    con.execute(
        'INSERT INTO pipeline_run (run_id, mode, status, is_historical, started_at, note, resumed_from)'
        " VALUES (?, ?, 'running', ?, now(), ?, ?)",
        [run_id, mode, is_historical, note, resumed_from])
    return run_id


def finish_run(con, run_id, status, error_class=None, error_detail=None):
    con.execute(
        'UPDATE pipeline_run SET status = ?, finished_at = now(), error_class = ?, error_detail = ?,'
        ' sources_processed = (SELECT count(*) FROM source_processing'
        "  WHERE run_id = ? AND outcome = 'succeeded')"
        ' WHERE run_id = ?',
        [status, error_class, (error_detail or None) and redact_url(str(error_detail))[:500], run_id, run_id])


def abandoned_runs(con):
    """Runs left 'running' by a kill, a crash or a closed laptop lid."""
    return [row[0] for row in con.execute(
        "SELECT run_id FROM pipeline_run WHERE status = 'running' ORDER BY started_at").fetchall()]


def mark_interrupted(con, run_id):
    con.execute("UPDATE pipeline_run SET status = 'interrupted', finished_at = now() WHERE run_id = ?", [run_id])


def unfinished_sources(con, run_id):
    """Sources this run claimed but never finished. Redoing them is safe and idempotent."""
    return [row[0] for row in con.execute(
        "SELECT source_label FROM source_processing WHERE run_id = ? AND outcome = 'pending'"
        ' ORDER BY source_label', [run_id]).fetchall()]


def claim_source(con, run_id, source_sha256, source_label, cache_hit):
    """Write the checkpoint *before* doing the work, so an interruption is visible."""
    con.execute(
        'INSERT INTO source_processing (run_id, source_sha256, source_label, outcome, started_at, cache_hit)'
        " VALUES (?, ?, ?, 'pending', now(), ?)"
        " ON CONFLICT (run_id, source_sha256) DO UPDATE SET outcome = 'pending', started_at = now(),"
        ' cache_hit = excluded.cache_hit, error_class = NULL, error_detail = NULL',
        [run_id, source_sha256, source_label, cache_hit])


def record_raw_source(con, run_id, *, sha256, kind, url, stored_path, byte_size, captured_at, retrieved_at):
    con.execute(
        'INSERT INTO raw_source (source_sha256, source_kind, source_url, stored_path, byte_size,'
        ' captured_at, retrieved_at, first_seen_run_id, first_seen_at)'
        ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, now()) ON CONFLICT (source_sha256) DO NOTHING',
        [sha256, kind, redact_url(url) if url else None, str(stored_path) if stored_path else None,
         byte_size, captured_at, retrieved_at, run_id])


def fail_source(con, run_id, source_sha256, error):
    con.execute(
        "UPDATE source_processing SET outcome = 'failed', finished_at = now(),"
        ' error_class = ?, error_detail = ? WHERE run_id = ? AND source_sha256 = ?',
        [type(error).__name__, redact_url(str(error))[:500], run_id, source_sha256])


# ------------------------------------------------------------------ observations

STAGING_DDL = """
CREATE OR REPLACE TEMP TABLE staging_obs (
    operator TEXT, vehicle TEXT, route TEXT, direction TEXT, journey_ref TEXT,
    observed_at_ms BIGINT, recorded_at_text TEXT, lat DOUBLE, lon DOUBLE,
    destination TEXT, origin TEXT, aimed_departure TEXT,
    source_sha256 TEXT, source_member TEXT, retrieved_at_text TEXT
);
"""

# One representative row per identity in this batch, plus how many input rows that identity
# arrived on and how many distinct coordinate pairs it arrived with. More than one pair means
# this batch disagrees with itself about where the bus was.
BATCH_SQL = f"""
CREATE OR REPLACE TEMP TABLE batch_obs AS
WITH ranked AS (
    SELECT *,
           row_number() OVER ordered AS rn,
           count(*) OVER grouped AS input_rows,
           count(DISTINCT lat::TEXT || ',' || lon::TEXT) OVER grouped AS coord_variants
    FROM staging_obs
    WINDOW grouped AS (PARTITION BY {IDENTITY_SQL}),
           ordered AS (PARTITION BY {IDENTITY_SQL} ORDER BY source_member, lat, lon)
)
SELECT * EXCLUDE (rn) FROM ranked WHERE rn = 1;
"""

CLASSIFY_SQL = f"""
CREATE OR REPLACE TEMP TABLE classified_obs AS
SELECT b.*,
       o.lat AS stored_lat, o.lon AS stored_lon, o.source_sha256 AS stored_source,
       CASE
           WHEN b.coord_variants > 1              THEN 'conflict_within_batch'
           WHEN o.operator IS NULL                THEN 'new'
           WHEN o.lat = b.lat AND o.lon = b.lon   THEN 'repeat'
           ELSE 'conflict_with_stored'
       END AS classification
FROM batch_obs b
LEFT JOIN observation o USING ({IDENTITY_SQL});
"""


def load_observations(con, run_id, source_sha256, records, rejected, activities_total,
                      outside_area, quarantined=()):
    """Load one source's parsed records. Idempotent: re-loading changes no analytical row.

    Returns the reconciled counts for this source.
    """
    con.execute(STAGING_DDL)
    if records:
        con.executemany(
            'INSERT INTO staging_obs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [(r['operator'], r['vehicle'], r['route'], r['direction'], r['journeyRef'],
              r['time'], r['recordedAt'], r['lat'], r['lon'], r['destination'], r['origin'],
              r['aimedDeparture'], r['sourceHash'], r['sourceMember'], r['retrievedAt'])
             for r in records])
    con.execute(BATCH_SQL)
    con.execute(CLASSIFY_SQL)

    con.execute(f"""
        INSERT INTO observation ({IDENTITY_SQL}, observed_at, recorded_at_text, lat, lon,
            destination, origin, aimed_departure, source_sha256, source_member, retrieved_at,
            first_seen_run_id, first_seen_at)
        SELECT {IDENTITY_SQL}, to_timestamp(observed_at_ms / 1000.0), recorded_at_text, lat, lon,
               destination, origin, aimed_departure, source_sha256, source_member,
               try_cast(retrieved_at_text AS TIMESTAMPTZ), ?, now()
        FROM classified_obs WHERE classification = 'new'
        ON CONFLICT DO NOTHING
    """, [run_id])

    con.execute(f"""
        INSERT INTO observation_conflict ({IDENTITY_SQL}, kind, stored_lat, stored_lon,
            stored_source, incoming_lat, incoming_lon, incoming_source, detected_run_id, detected_at)
        SELECT {IDENTITY_SQL},
               CASE WHEN classification = 'conflict_within_batch' THEN 'within_batch' ELSE 'with_stored' END,
               stored_lat, stored_lon, stored_source, lat, lon, source_sha256, ?, now()
        FROM classified_obs
        WHERE classification IN ('conflict_within_batch', 'conflict_with_stored')
        ON CONFLICT DO NOTHING
    """, [run_id])

    # inputs_in_area = new + repeats + conflicting_input_rows, by construction.
    # A repeat is either an identity we already stored with the same coordinates, or an extra
    # copy of an identity inside this batch. Every input row belonging to a conflicting
    # identity is counted as conflicting, never quietly as a repeat.
    new, repeat, conflicts = con.execute("""
        SELECT
          COALESCE(sum(CASE WHEN classification = 'new' THEN 1 ELSE 0 END), 0),
          COALESCE(sum(CASE WHEN classification IN ('new', 'repeat')
                            THEN input_rows - 1 ELSE 0 END), 0)
            + COALESCE(sum(CASE WHEN classification = 'repeat' THEN 1 ELSE 0 END), 0),
          COALESCE(sum(CASE WHEN classification LIKE 'conflict%' THEN input_rows ELSE 0 END), 0)
        FROM classified_obs
    """).fetchone()
    new, repeat, conflicts = int(new), int(repeat), int(conflicts)
    rejected_total = sum(rejected.values())
    record_quarantine(con, run_id, source_sha256, quarantined)

    for reason, count in (rejected or {}).items():
        con.execute(
            'INSERT INTO rejection VALUES (?, ?, ?, ?)'
            ' ON CONFLICT (run_id, source_sha256, reason) DO UPDATE SET record_count = excluded.record_count',
            [run_id, source_sha256, reason, count])

    con.execute(
        "UPDATE source_processing SET outcome = 'succeeded', finished_at = now(),"
        ' activities_total = ?, activities_in_area = ?, outside_area = ?,'
        ' new_observations = ?, repeat_observations = ?, conflicting_observations = ?,'
        ' rejected_records = ? WHERE run_id = ? AND source_sha256 = ?',
        [activities_total, len(records), outside_area, new, repeat, conflicts,
         rejected_total, run_id, source_sha256])
    return {'new': new, 'repeats': repeat, 'conflicts': conflicts,
            'rejected': rejected_total, 'inArea': len(records)}


def record_quarantine(con, run_id, source_sha256, entries):
    """Keep questionable records with their reason. Nothing is silently discarded."""
    if not entries:
        return 0
    rows = []
    for entry in entries:
        identity = '|'.join([source_sha256, entry['reason'], entry.get('sourceMember') or '',
                             entry.get('recordedAt') or '', entry.get('vehicle') or '',
                             entry.get('latitude') or '', entry.get('longitude') or ''])
        rows.append((hashlib.sha256(identity.encode()).hexdigest()[:32], run_id, source_sha256,
                     entry['reason'], entry.get('detail'), entry.get('sourceMember'),
                     entry.get('recordedAt'), entry.get('latitude'), entry.get('longitude'),
                     entry.get('operator'), entry.get('vehicle'), entry.get('route'),
                     entry.get('direction'), entry.get('journeyRef')))
    con.executemany(
        'INSERT INTO quarantined_record (quarantine_id, run_id, source_sha256, reason, detail,'
        ' source_member, recorded_at_raw, latitude_raw, longitude_raw, operator_raw, vehicle_raw,'
        ' route_raw, direction_raw, journey_ref_raw, first_seen_at)'
        ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, now())'
        ' ON CONFLICT (quarantine_id) DO NOTHING', rows)
    return len(rows)


def record_cycle(con, run_id, cycle_no, requested_at, outcome, **fields):
    con.execute(
        'INSERT INTO collection_cycle (run_id, cycle_no, requested_at, completed_at, outcome,'
        ' http_status, source_sha256, byte_size, payload_changed, observations_loaded,'
        ' error_class, error_detail) VALUES (?, ?, ?, now(), ?, ?, ?, ?, ?, ?, ?, ?)'
        ' ON CONFLICT (run_id, cycle_no) DO UPDATE SET outcome = excluded.outcome,'
        ' completed_at = excluded.completed_at, http_status = excluded.http_status,'
        ' source_sha256 = excluded.source_sha256, byte_size = excluded.byte_size,'
        ' payload_changed = excluded.payload_changed,'
        ' observations_loaded = excluded.observations_loaded,'
        ' error_class = excluded.error_class, error_detail = excluded.error_detail',
        [run_id, cycle_no, requested_at, outcome, fields.get('http_status'),
         fields.get('source_sha256'), fields.get('byte_size'), fields.get('payload_changed'),
         fields.get('observations_loaded', 0), fields.get('error_class'),
         (fields.get('error_detail') or None) and redact_url(str(fields['error_detail']))[:500]])


def record_timetable(con, run_id, **fields):
    """A timetable we hold. Holding one proves nothing about journey matching."""
    con.execute(
        'INSERT INTO timetable_version (content_sha256, source_url, stored_path, byte_size,'
        ' retrieved_at, effective_from, effective_to, modification_datetime, dataset_label,'
        ' first_seen_run_id, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ' ON CONFLICT (content_sha256) DO NOTHING',
        [fields['content_sha256'], redact_url(fields['source_url']) if fields.get('source_url') else None,
         fields.get('stored_path'), fields.get('byte_size'), fields.get('retrieved_at'),
         fields.get('effective_from'), fields.get('effective_to'),
         fields.get('modification_datetime'), fields.get('dataset_label'), run_id,
         'Stored for future validation. No journey match has been established.'])


# ------------------------------------------------------------------- reading back

def warehouse_totals(con):
    """Totals that do not move when the same inputs are processed again.

    Per-source facts (activities seen, in area, out of area, rejected) are taken from the
    first successful pass over each distinct source, because parsing is deterministic.
    Repeats are then *derived*, so the identity
        inputs_in_area = retained + repeats + conflicting_input_rows
    holds no matter how many times a source is reprocessed.
    """
    row = con.execute(f"""
        WITH first_pass AS (
            SELECT * FROM (
                SELECT *, row_number() OVER (PARTITION BY source_sha256
                                             ORDER BY finished_at, run_id) AS rn
                FROM source_processing WHERE outcome = 'succeeded'
            ) WHERE rn = 1
        )
        SELECT
          (SELECT count(*) FROM raw_source),
          (SELECT count(*) FROM first_pass),
          (SELECT COALESCE(sum(activities_total), 0) FROM first_pass),
          (SELECT COALESCE(sum(activities_in_area), 0) FROM first_pass),
          (SELECT COALESCE(sum(outside_area), 0) FROM first_pass),
          (SELECT COALESCE(sum(rejected_records), 0) FROM first_pass),
          (SELECT count(*) FROM observation),
          (SELECT count(*) FROM (SELECT DISTINCT {IDENTITY_SQL} FROM observation_conflict)),
          (SELECT COALESCE(sum(conflicting_observations), 0) FROM first_pass),
          (SELECT count(*) FROM v_publishable_observation),
          (SELECT count(*) FROM observation o WHERE EXISTS (
               SELECT 1 FROM observation_conflict c
               WHERE c.operator = o.operator AND c.vehicle = o.vehicle AND c.route = o.route AND c.direction = o.direction AND c.journey_ref = o.journey_ref AND c.observed_at_ms = o.observed_at_ms))
    """).fetchone()
    keys = ['rawSources', 'sourcesProcessed', 'activitiesTotal', 'activitiesInArea',
            'outsideArea', 'rejectedRecords', 'storedObservations', 'conflictIdentities',
            'conflictingInputRows', 'publishableObservations', 'suppressedObservations']
    totals = dict(zip(keys, [int(v) for v in row]))
    totals['repeatObservations'] = (totals['activitiesInArea'] - totals['storedObservations']
                                    - totals['conflictingInputRows'])
    return totals


def capture_window(con):
    """The archive capture window, from the sources themselves."""
    row = con.execute('SELECT min(captured_at), max(captured_at) FROM raw_source'
                      " WHERE source_kind LIKE '%positions%'").fetchone()
    if not row or row[0] is None:
        return None, None
    to_ms = lambda dt: int(dt.timestamp() * 1000)
    return to_ms(row[0]), to_ms(row[1])


def active_publication(con):
    row = con.execute(
        "SELECT publication_id, snapshot_id, observation_count, journey_count, window_start_ms,"
        ' window_end_ms, snapshot_sha256, snapshot_bytes, published_at, target_path'
        " FROM publication WHERE status = 'published' AND COALESCE(kind, 'replay') = 'replay'"
        ' ORDER BY published_at DESC LIMIT 1').fetchone()
    if not row:
        return None
    keys = ['publicationId', 'snapshotId', 'observationCount', 'journeyCount', 'windowStartMs',
            'windowEndMs', 'sha256', 'bytes', 'publishedAt', 'targetPath']
    values = [v.isoformat() if isinstance(v, datetime) else v for v in row]
    return dict(zip(keys, values))
