-- Migration to move set data into a dedicated match_sets table
BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS match_sets (
  match_id INTEGER NOT NULL,
  set_number INTEGER NOT NULL,
  sc_score TEXT DEFAULT '',
  opp_score TEXT DEFAULT '',
  sc_timeout_1 INTEGER DEFAULT 0,
  sc_timeout_2 INTEGER DEFAULT 0,
  opp_timeout_1 INTEGER DEFAULT 0,
  opp_timeout_2 INTEGER DEFAULT 0,
  finalized INTEGER,
  PRIMARY KEY (match_id, set_number),
  CONSTRAINT fk_match_sets_match
    FOREIGN KEY (match_id)
    REFERENCES matches(id)
    ON DELETE CASCADE
);

WITH RECURSIVE set_numbers(n) AS (
  SELECT 1
  UNION ALL
  SELECT n + 1 FROM set_numbers WHERE n < 5
)
INSERT OR IGNORE INTO match_sets (
  match_id,
  set_number,
  sc_score,
  opp_score,
  sc_timeout_1,
  sc_timeout_2,
  opp_timeout_1,
  opp_timeout_2,
  finalized
)
SELECT
  m.id AS match_id,
  sn.n AS set_number,
  COALESCE(json_extract(m.sets, '$."' || sn.n || '".sc'), '') AS sc_score,
  COALESCE(json_extract(m.sets, '$."' || sn.n || '".opp'), '') AS opp_score,
  CASE WHEN json_extract(m.sets, '$."' || sn.n || '".timeouts.sc[0]') = 1 THEN 1 ELSE 0 END AS sc_timeout_1,
  CASE WHEN json_extract(m.sets, '$."' || sn.n || '".timeouts.sc[1]') = 1 THEN 1 ELSE 0 END AS sc_timeout_2,
  CASE WHEN json_extract(m.sets, '$."' || sn.n || '".timeouts.opp[0]') = 1 THEN 1 ELSE 0 END AS opp_timeout_1,
  CASE WHEN json_extract(m.sets, '$."' || sn.n || '".timeouts.opp[1]') = 1 THEN 1 ELSE 0 END AS opp_timeout_2,
  CASE
    WHEN json_type(m.finalized_sets, '$."' || sn.n || '"') IS NULL THEN NULL
    WHEN json_extract(m.finalized_sets, '$."' || sn.n || '"') = 1 THEN 1
    ELSE 0
  END AS finalized
FROM matches m
CROSS JOIN set_numbers sn;

ALTER TABLE matches DROP COLUMN sets;
ALTER TABLE matches DROP COLUMN finalized_sets;

COMMIT;
