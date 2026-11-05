import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { parse } from '../../lib/validate.js';
import { makeGuards } from '../../plugins/auth.js';
import { getSettings } from '../../services/settings.js';

const rows = <T>(r: { rows: unknown[] }) => r.rows as T[];

export async function adminInsightRoutes(app: FastifyInstance) {
  const guard = makeGuards(app);
  app.addHook('preHandler', guard.staff);

  app.get('/stats', async (req) => {
    const { days } = parse(z.object({ days: z.coerce.number().int().min(1).max(90).default(14) }), req.query);
    const since = sql`now() - make_interval(days => ${days})`;
    const settings = await getSettings();

    const [kpi] = rows<{
      revenue_cents: number;
      completed: number;
      placed: number;
      cancelled: number;
      avg_basket_cents: number;
      new_customers: number;
      points_issued: number;
      rewards_used: number;
    }>(
      await db.execute(sql`
        select
          (select coalesce(sum(total_cents),0)::int from orders where status in ('delivered','collected') and payment_status <> 'refunded' and completed_at >= ${since}) as revenue_cents,
          (select count(*)::int from orders where status in ('delivered','collected') and payment_status <> 'refunded' and completed_at >= ${since}) as completed,
          (select count(*)::int from orders where placed_at >= ${since}) as placed,
          (select count(*)::int from orders where status = 'cancelled' and placed_at >= ${since}) as cancelled,
          (select coalesce(round(avg(total_cents)),0)::int from orders where status in ('delivered','collected') and payment_status <> 'refunded' and completed_at >= ${since}) as avg_basket_cents,
          (select count(*)::int from users where role = 'customer' and created_at >= ${since}) as new_customers,
          (select coalesce(sum(delta),0)::int from points_transactions where delta > 0 and created_at >= ${since}) as points_issued,
          (select count(*)::int from customer_rewards where status = 'used' and used_at >= ${since}) as rewards_used`),
    );

    const daily = rows<{ day: string; orders: number; revenue_cents: number }>(
      await db.execute(sql`
        with d as (select generate_series((now() - make_interval(days => ${days - 1}))::date, now()::date, interval '1 day')::date as day)
        select to_char(d.day, 'YYYY-MM-DD') as day,
          (select count(*)::int from orders o where o.placed_at::date = d.day) as orders,
          (select coalesce(sum(o.total_cents),0)::int from orders o where o.completed_at::date = d.day and o.status in ('delivered','collected') and o.payment_status <> 'refunded') as revenue_cents
        from d order by d.day`),
    );

    const topProducts = rows<{ product_id: number | null; name: string; emoji: string; quantity: number; revenue_cents: number }>(
      await db.execute(sql`
        select oi.product_id, max(oi.name) as name, max(oi.emoji) as emoji, sum(oi.quantity)::int as quantity, sum(oi.line_total_cents)::int as revenue_cents
        from order_items oi join orders o on o.id = oi.order_id
        where o.status in ('delivered','collected') and o.payment_status <> 'refunded' and not oi.is_gift and o.completed_at >= ${since}
        group by oi.product_id, case when oi.product_id is null then oi.name end order by quantity desc, revenue_cents desc limit 8`),
    );

    const openByStatus = rows<{ status: string; n: number }>(
      await db.execute(sql`select status, count(*)::int as n from orders where status in ('placed','confirmed','preparing','out_for_delivery','ready_for_pickup') group by status`),
    );

    const fulfillmentMix = rows<{ fulfillment_type: string; n: number }>(
      await db.execute(sql`select fulfillment_type, count(*)::int as n from orders where placed_at >= ${since} and status <> 'cancelled' group by fulfillment_type`),
    );

    const signups = rows<{ source: string; n: number }>(
      await db.execute(sql`select coalesce(signup_source,'direct') as source, count(*)::int as n from users where role = 'customer' and created_at >= ${since} group by 1 order by 2 desc`),
    );

    const lowStock = rows<{ id: number; name: string; emoji: string; stock: number }>(
      await db.execute(sql`select id, name, emoji, stock from products where active and stock <= 5 order by stock asc, name limit 10`),
    );

    return { days, currency: settings.currency, kpi, daily, topProducts, openByStatus, fulfillmentMix, signups, lowStock };
  });
}
