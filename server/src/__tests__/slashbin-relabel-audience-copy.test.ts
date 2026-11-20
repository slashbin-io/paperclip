// Slashbin patch (migration 0296): relabel only the revisions the EM's audience-copy script wrote, so the
// mirror gate (assertMirrorHistory) stops refusing those documents. Never loosens the gate.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { caseDocuments, cases, companies, createDb, documentRevisions, documents } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { assertMirrorHistory } from "../slashbin/protected-cases.js";
import { blobSha } from "../slashbin/git-source-ref.js";

const support = await getEmbeddedPostgresTestSupport();
const describePg = support.supported ? describe.sequential : describe.skip;

const MIGRATION = new URL("../../../packages/db/src/migrations/0296_relabel_audience_copy_revisions.sql", import.meta.url);
const PATH = "xrgarcia/slashbin-engineering-manager/docs/architecture.md";
const KEY = "xrgarcia:slashbin-engineering-manager:docs:architecture.md";
const BODY = "# Architecture\n\nunicode: café ✓\n";

describePg("migration 0296 relabels audience-copy revisions", () => {
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let db!: ReturnType<typeof createDb>;
  let companyId = "";
  let n = 0;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-relabel-audience-");
    db = createDb(tempDb.connectionString);
    const [company] = await db.insert(companies).values({ name: "Co", issuePrefix: "REL" }).returning();
    companyId = company!.id;
  }, 120_000);
  afterAll(async () => { await tempDb?.cleanup(); });

  async function seed(opts: { caseType: string; key: string; revisions: Array<{ summary: string | null; body: string }> }) {
    n += 1;
    const [kase] = await db.insert(cases).values({
      companyId, caseNumber: n, identifier: `REL-C${n}`, caseType: opts.caseType, key: `k${n}`, title: `Case ${n}`,
    }).returning();
    const [doc] = await db.insert(documents).values({ companyId, title: opts.key, latestBody: opts.revisions.at(-1)!.body }).returning();
    await db.insert(caseDocuments).values({ companyId, caseId: kase!.id, documentId: doc!.id, key: opts.key });
    let rev = 0;
    for (const r of opts.revisions) {
      rev += 1;
      await db.insert(documentRevisions).values({ companyId, documentId: doc!.id, revisionNumber: rev, body: r.body, changeSummary: r.summary });
    }
    return doc!.id;
  }

  async function history(documentId: string) {
    return db.select({ changeSummary: documentRevisions.changeSummary, body: documentRevisions.body, n: documentRevisions.revisionNumber })
      .from(documentRevisions).where(sql`${documentRevisions.documentId} = ${documentId}`).orderBy(documentRevisions.revisionNumber);
  }

  async function runMigration() {
    for (const statement of readFileSync(MIGRATION, "utf8").split("--> statement-breakpoint")) {
      if (statement.trim()) await db.execute(sql.raw(statement));
    }
  }

  // assertMirrorHistory reads this document's revisions through db.select().from().where().
  const reader = (rows: Array<{ changeSummary: string | null; body: string }>) =>
    ({ select: () => ({ from: () => ({ where: async () => rows }) }) }) as never;
  const row = { id: "case-id", caseType: "company-policy" } as never;

  it("relabels an audience-copy revision so the history passes, leaves a hand edit refused, and is idempotent", async () => {
    const importRev = { summary: `import ${PATH}@${blobSha("# old\n")}`, body: "# old\n" };
    const poisoned = await seed({
      caseType: "company-policy", key: KEY,
      revisions: [importRev, { summary: `audience copy of SLA-C1/${PATH}`, body: BODY }],
    });
    const handEdit = await seed({
      caseType: "company-policy", key: "o:r:hand.md",
      revisions: [{ summary: "fixed a typo", body: "# hand\n" }],
    });
    const handEditAfterCopy = await seed({
      caseType: "company-policy", key: KEY + "-2",
      revisions: [{ summary: `audience copy of SLA-C1/${PATH}-2`, body: BODY }, { summary: "edited by a person", body: BODY + "x" }],
    });
    const wrongKey = await seed({
      caseType: "company-policy", key: "some:other:key.md",
      revisions: [{ summary: `audience copy of SLA-C1/${PATH}`, body: BODY }],
    });
    const unprotected = await seed({
      caseType: "bug", key: KEY,
      revisions: [{ summary: `audience copy of SLA-C1/${PATH}`, body: BODY }],
    });
    const before = { poisoned: await history(poisoned), handEdit: await history(handEdit), handEditAfterCopy: await history(handEditAfterCopy), wrongKey: await history(wrongKey), unprotected: await history(unprotected) };
    await expect(assertMirrorHistory(reader(before.poisoned), row, poisoned, KEY)).rejects.toThrow(/not a git import/);

    await runMigration();

    const after = await history(poisoned);
    expect(after[1]!.changeSummary).toBe(`import ${PATH}@${blobSha(BODY)}`);
    expect(after.map((r) => r.body)).toEqual(before.poisoned.map((r) => r.body));
    expect(after[0]).toEqual(before.poisoned[0]);
    await expect(assertMirrorHistory(reader(after), row, poisoned, KEY)).resolves.toBeUndefined();

    // Nothing else is touched, and an untouched hand edit still fails the gate.
    expect(await history(handEdit)).toEqual(before.handEdit);
    expect(await history(handEditAfterCopy)).toEqual([
      { ...before.handEditAfterCopy[0]!, changeSummary: `import ${PATH}-2@${blobSha(BODY)}` },
      before.handEditAfterCopy[1],
    ]);
    expect(await history(wrongKey)).toEqual(before.wrongKey);
    expect(await history(unprotected)).toEqual(before.unprotected);
    await expect(assertMirrorHistory(reader(await history(handEdit)), row, handEdit, "o:r:hand.md")).rejects.toThrow(/not a git import/);
    await expect(assertMirrorHistory(reader(await history(handEditAfterCopy)), row, handEditAfterCopy, KEY + "-2")).rejects.toThrow(/not a git import/);

    // Idempotent: a rerun changes nothing.
    await runMigration();
    expect(await history(poisoned)).toEqual(after);
  });
});
