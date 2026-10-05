-- Same file, same prompt/model generation: the model already answered once,
-- so a repeat upload (retry after a timeout, a second import of the same
-- export) can be served without another provider call. The version key is a
-- fingerprint of prompt + schema + model, so any generation change misses
-- the cache and re-parses; rows are per owner (timetables are personal).
CREATE TABLE course_import_parse_cache (
  owner_id uuid NOT NULL,
  source_sha256 text NOT NULL,
  prompt_version text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, source_sha256, prompt_version)
);
