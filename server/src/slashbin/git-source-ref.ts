// Slashbin patch (EM#642, paperclip#24): proof that a document revision is git-sourced.
// The importer sends `changeSummary: "import <owner>/<repo>/<path>@<40-hex blob sha>"`
// and the destination key is derived from that path (generate-document-manifest.mjs
// assignKeys). A mirror key may write only content whose summary, key and bytes agree.
// Pure functions, no I/O.
import { createHash } from "node:crypto";

const IMPORT_SUMMARY = /^import (.+)@([0-9a-f]{40})$/;

/** `import <owner>/<repo>/<path>@<40hex>` -> { path, sha }, or null when it is anything else. */
export function parseImportSummary(summary: string | null | undefined): { path: string; sha: string } | null {
  if (typeof summary !== "string") return null;
  const m = IMPORT_SUMMARY.exec(summary);
  if (!m) return null;
  const path = m[1]!;
  // owner/repo/path at least, no empty segments.
  if (path.split("/").length < 3 || path.split("/").some((s) => s === "")) return null;
  return { path, sha: m[2]! };
}

/** The git blob sha1 of `content`: sha1("blob " + byteLength + "\0" + bytes). */
export function blobSha(content: string | Uint8Array): string {
  const bytes = typeof content === "string" ? Buffer.from(content, "utf8") : Buffer.from(content);
  return createHash("sha1")
    .update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`, "utf8"), bytes]))
    .digest("hex");
}

/** True when `key` is the destination key the manifest generator derives for `path`. */
export function keyMatchesPath(key: string, path: string): boolean {
  const plain = path.replace(/\//g, ":").replace(/[^A-Za-z0-9_.:-]/g, "-");
  if (key === plain) return true;
  const hashed = `${plain.slice(0, 103)}-${createHash("sha1").update(path).digest("hex").slice(0, 16)}`;
  return key === hashed;
}
