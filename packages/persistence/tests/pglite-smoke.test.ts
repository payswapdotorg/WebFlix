import { describe, expect, it } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

describe("pglite smoke", () => {
  it("boots wasm postgres and runs sql", async () => {
    const db = new PGlite();
    const res = await db.query<{ ok: number }>("select 1 as ok");
    expect(res.rows[0]?.ok).toBe(1);
    await db.query("create table t (id text primary key, v jsonb)");
    await db.query("insert into t values ($1, $2)", ["a", JSON.stringify({ x: 1 })]);
    const back = await db.query<{ id: string; v: { x: number } }>("select * from t");
    expect(back.rows[0]?.v.x).toBe(1);
    // transaction + skip locked
    await db.query("create table o (id text primary key, status text)");
    await db.query("insert into o values ('1','pending')");
    const claimed = await db.query<{ id: string }>(
      "update o set status='in-flight' where id in (select id from o where status='pending' for update skip locked limit 1) returning id",
    );
    expect(claimed.rows[0]?.id).toBe("1");
    await db.close();
  });
});
