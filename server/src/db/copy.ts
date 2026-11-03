/**
 * One-time copy of every table from another PostgreSQL database into this (empty, freshly migrated)
 * one — used to move the shop to a new database host without losing anything.
 *
 * Runs only when the target has no users and no products. Everything happens in ONE transaction:
 * if anything fails, nothing is written and start-up stops (the previous deploy keeps running).
 * Rows travel as JSON produced by Postgres itself (row_to_json → json_populate_recordset), so dates,
 * numbers and binary data keep their exact values.
 */
import pg from 'pg';
import { normalizeDatabaseUrl, pool } from './client.js';

type Log = (msg: string) => void;
interface Fk {
  table: string;
  column: string;
  parent: string;
  nullable: boolean;
}

const q = (id: string) => `"${id.replace(/"/g, '""')}"`;
const BATCH_BYTES = 2_000_000;

export async function copyDatabaseFrom(sourceUrl: string, log: Log = console.log) {
  const target = await pool.connect();
  try {
    const { rows: [state] } = await target.query<{ users: number; products: number }>(
      'select (select count(*) from users)::int as users, (select count(*) from products)::int as products',
    );
    if (state.users > 0 || state.products > 0) {
      log('ℹ️ COPY_FROM_DATABASE_URL is set but this database already has data — skipping the copy. You can remove that setting now.');
      return { copied: false as const };
    }

    const source = new pg.Pool({ connectionString: normalizeDatabaseUrl(sourceUrl), max: 2 });
    try {
      log('📦 Copying all data from the old database…');
      const tables = (
        await target.query<{ t: string }>(
          `select table_name as t from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`,
        )
      ).rows.map((r) => r.t);
      const sourceTables = new Set(
        (await source.query<{ t: string }>(`select table_name as t from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`)).rows.map(
          (r) => r.t,
        ),
      );
      const fks = (
        await target.query<{ table: string; column: string; parent: string; nullable: string }>(`
          select tc.table_name as "table", kcu.column_name as "column", ccu.table_name as parent, c.is_nullable as nullable
          from information_schema.table_constraints tc
          join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
          join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
          join information_schema.columns c on c.table_schema = tc.table_schema and c.table_name = tc.table_name and c.column_name = kcu.column_name
          where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'`)
      ).rows.map((r): Fk => ({ table: r.table, column: r.column, parent: r.parent, nullable: r.nullable === 'YES' }));

      // Order tables so parents come first. In a cycle, a nullable link is filled in after all inserts.
      const done = new Set<string>();
      const order: { table: string; deferred: Fk[] }[] = [];
      const pending = new Set(tables);
      while (pending.size) {
        const parentsOf = (t: string) => fks.filter((f) => f.table === t && f.parent !== t);
        let next = [...pending].find((t) => parentsOf(t).every((f) => done.has(f.parent)));
        let deferred: Fk[] = [];
        if (!next) {
          next = [...pending].find((t) => parentsOf(t).every((f) => done.has(f.parent) || f.nullable));
          if (!next) throw new Error(`Cannot order tables for copying: ${[...pending].join(', ')}`);
          deferred = parentsOf(next).filter((f) => !done.has(f.parent));
        }
        order.push({ table: next, deferred });
        done.add(next);
        pending.delete(next);
      }

      await target.query('begin');
      const later: { table: string; columns: string[]; rows: Record<string, unknown>[] }[] = [];
      let total = 0;
      for (const { table, deferred } of order) {
        if (!sourceTables.has(table)) continue;
        const json = (await source.query<{ j: string }>(`select row_to_json(t)::text as j from ${q(table)} t`)).rows.map((r) => r.j);
        if (!json.length) continue;
        const deferCols = deferred.map((f) => f.column);
        // Rows stay exactly as Postgres wrote them, except tables with held-back links.
        let rows = json;
        if (deferCols.length) {
          const objects = json.map((j) => JSON.parse(j) as Record<string, unknown>);
          later.push({ table, columns: deferCols, rows: objects.map((o) => Object.fromEntries([['id', o.id], ...deferCols.map((c) => [c, o[c]])])) });
          for (const o of objects) for (const c of deferCols) o[c] = null;
          rows = objects.map((o) => JSON.stringify(o));
        }
        // Batches of ~2 MB of JSON.
        let batch: string[] = [];
        let size = 0;
        const flush = async () => {
          if (!batch.length) return;
          await target.query(`insert into ${q(table)} select * from json_populate_recordset(null::${q(table)}, $1::json)`, [`[${batch.join(',')}]`]);
          batch = [];
          size = 0;
        };
        for (const r of rows) {
          if (size + r.length > BATCH_BYTES) await flush();
          batch.push(r);
          size += r.length;
        }
        await flush();
        total += rows.length;
        log(`   ${table}: ${rows.length}`);
      }
      // Fill in the links that were held back to break cycles.
      for (const l of later) {
        const sets = l.columns.map((c) => `${q(c)} = d.${q(c)}`).join(', ');
        await target.query(`update ${q(l.table)} t set ${sets} from json_populate_recordset(null::${q(l.table)}, $1::json) d where t.id = d.id`, [
          JSON.stringify(l.rows),
        ]);
      }
      // Continue id sequences after the copied rows.
      const serials = (
        await target.query<{ t: string; c: string }>(
          `select table_name as t, column_name as c from information_schema.columns where table_schema = 'public' and column_default like 'nextval(%'`,
        )
      ).rows;
      for (const s of serials) {
        await target.query(
          `select setval(pg_get_serial_sequence($1, $2), coalesce((select max(${q(s.c)}) from ${q(s.t)}), 1), (select count(*) > 0 from ${q(s.t)}))`,
          [s.t, s.c],
        );
      }
      await target.query('commit');
      log(`✅ Copied ${total} rows from the old database. Remove COPY_FROM_DATABASE_URL now.`);
      return { copied: true as const, rows: total };
    } catch (err) {
      await target.query('rollback').catch(() => {});
      throw err;
    } finally {
      await source.end();
    }
  } finally {
    target.release();
  }
}
