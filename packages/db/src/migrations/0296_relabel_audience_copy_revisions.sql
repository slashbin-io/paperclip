-- Slashbin (EM#1284 follow-up): relabel the revisions the EM's one-shot audience-copy script wrote.
-- That script saved each audience copy of a mirrored document with the summary
-- "audience copy of <case>/<owner>/<repo>/<path>" instead of the import form, so the mirror gate
-- (assertMirrorHistory: every stored revision must be a byte-verified git import) refused the key forever.
--
-- Narrow by construction: only a revision whose change_summary starts with "audience copy of ", on a document
-- held by a company-policy Case (always protected), whose key derives from the path the summary names (the
-- generator's assignKeys rule, git-source-ref.ts keyMatchesPath), is touched. Only change_summary is set,
-- to "import <path>@<git blob sha1 of the body>". Bodies are unchanged. A rerun finds no row left to match.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint
DO $$
DECLARE
  relabeled integer;
BEGIN
  WITH candidate AS (
    SELECT
      r.id AS revision_id,
      cd.key AS doc_key,
      substring(r.change_summary FROM '^audience copy of [^/]+/(.+)$') AS path,
      convert_to(r.body, 'UTF8') AS bytes
    FROM document_revisions r
    JOIN case_documents cd ON cd.document_id = r.document_id
    JOIN cases c ON c.id = cd.case_id
    WHERE r.change_summary LIKE 'audience copy of %'
      AND c.case_type = 'company-policy'
  ), derived AS (
    SELECT
      revision_id,
      doc_key,
      path,
      bytes,
      regexp_replace(replace(path, '/', ':'), '[^A-Za-z0-9_.:-]', '-', 'g') AS plain
    FROM candidate
    WHERE path IS NOT NULL
      AND array_length(string_to_array(path, '/'), 1) >= 3
      AND path !~ '(^/|//|/$)'
  ), matched AS (
    SELECT revision_id, path, bytes
    FROM derived
    WHERE doc_key = plain
       OR doc_key = substr(plain, 1, 103) || '-' || substr(encode(digest(path, 'sha1'), 'hex'), 1, 16)
  ), updated AS (
    UPDATE document_revisions r
    SET change_summary = 'import ' || m.path || '@' ||
      encode(digest(convert_to('blob ' || octet_length(m.bytes)::text, 'UTF8') || '\x00'::bytea || m.bytes, 'sha1'), 'hex')
    FROM matched m
    WHERE r.id = m.revision_id
    RETURNING r.id
  )
  SELECT count(*) INTO relabeled FROM updated;
  RAISE NOTICE 'relabel_audience_copy_revisions: % revision(s) relabeled to the import form', relabeled;
END $$;
