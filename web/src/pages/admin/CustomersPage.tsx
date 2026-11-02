import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Avatar, Badge, Button, Card, cx, ErrorState, Field, Input, PageLoader, Select, Skeleton } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { dateTime, money, shortDate } from '../../lib/format';
import { STATUS_META } from '../../lib/status';
import { toast } from '../../lib/toast';
import type { Address, Level, OrderSummary, Role, User, WalletItem } from '../../lib/types';
import { PageHeader, Td, Th, useIsAdmin } from './common';

type Row = User & { signupSource: string | null; level: Level; orderCount: number; spentCents: number; lastOrderAt: string | null };

export function CustomersPage() {
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const navigate = useNavigate();
  const params = new URLSearchParams();
  if (q.trim()) params.set('q', q.trim());
  if (role) params.set('role', role);
  const list = useQuery({ queryKey: ['admin', 'customers', q.trim(), role], queryFn: () => api<{ customers: Row[]; total: number }>(`/admin/customers?${params}`), placeholderData: (p) => p });

  return (
    <div>
      <PageHeader title="Customers" subtitle={list.data ? `${list.data.total} accounts` : undefined} />
      <div className="mb-4 flex flex-wrap gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, @username, phone" className="max-w-72 py-2" />
        <Select value={role} onChange={(e) => setRole(e.target.value)} className="max-w-40 py-2">
          <option value="">Everyone</option><option value="customer">Customers</option><option value="staff">Staff</option><option value="admin">Admins</option>
        </Select>
      </div>
      {list.isLoading ? <Skeleton className="h-96" /> : list.error ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-line"><tr><Th>Customer</Th><Th className="hidden md:table-cell">Phone</Th><Th>Points</Th><Th className="hidden sm:table-cell">Orders</Th><Th className="hidden lg:table-cell">Spent</Th><Th className="hidden lg:table-cell">Joined</Th></tr></thead>
            <tbody className="divide-y divide-line">
              {list.data!.customers.map((c) => (
                <tr key={c.id} className="cursor-pointer hover:bg-surface-2/60" onClick={() => navigate(`/admin/customers/${c.id}`)}>
                  <Td>
                    <div className="flex items-center gap-3">
                      <Avatar name={`${c.firstName} ${c.lastName ?? ''}`} url={c.photoUrl} size={36} />
                      <div className="min-w-0">
                        <div className="font-semibold">{c.firstName} {c.lastName} {c.role !== 'customer' && <Badge className="ml-1 bg-violet-100 capitalize text-violet-800">{c.role}</Badge>}</div>
                        <div className="text-xs text-muted">{c.username ? `@${c.username}` : 'no username'}</div>
                      </div>
                    </div>
                  </Td>
                  <Td className="hidden md:table-cell">{c.phone ?? <span className="text-muted">—</span>} {c.phoneVerified && '✓'}</Td>
                  <Td><span className="font-bold">{c.pointsBalance}</span> <span className="text-xs text-muted">{c.level.emoji} {c.level.name}</span></Td>
                  <Td className="hidden sm:table-cell">{c.orderCount}</Td>
                  <Td className="hidden lg:table-cell">{money(c.spentCents)}</Td>
                  <Td className="hidden lg:table-cell"><div>{shortDate(c.createdAt)}</div><div className="text-xs text-muted">via {c.signupSource ?? 'direct'}</div></Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

interface Detail {
  customer: Row & { privacyAcceptedAt: string | null; lastSeenAt: string | null; spentCents: number; completed: number };
  addresses: Address[];
  orders: OrderSummary[];
  pointsHistory: { id: number; delta: number; balanceAfter: number; type: string; orderId: number | null; note: string | null; createdAt: string }[];
  wallet: WalletItem[];
}

export function CustomerDetail() {
  const id = Number(useParams().id);
  const isAdmin = useIsAdmin();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'customer', id], queryFn: () => api<Detail>(`/admin/customers/${id}`) });
  const [delta, setDelta] = useState('');
  const [note, setNote] = useState('');
  const adjust = useMutation({
    mutationFn: () => api<{ applied: boolean; balance: number }>(`/admin/customers/${id}/points`, { body: { delta: Number(delta), note, idempotencyKey: crypto.randomUUID() } }),
    onSuccess: (r) => {
      toast(`Balance is now ${r.balance} points`, 'success');
      setDelta('');
      setNote('');
      qc.invalidateQueries({ queryKey: ['admin', 'customer', id] });
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const setRole = useMutation({
    mutationFn: (role: Role) => api(`/admin/customers/${id}/role`, { method: 'PUT', body: { role } }),
    onSuccess: () => {
      toast('Role updated ✓', 'success');
      qc.invalidateQueries({ queryKey: ['admin', 'customer', id] });
      qc.invalidateQueries({ queryKey: ['admin', 'customers'] });
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  if (q.isLoading) return <PageLoader />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const { customer: c, orders, pointsHistory, wallet, addresses } = q.data;

  return (
    <div>
      <Link to="/admin/customers" className="mb-3 inline-block text-sm font-semibold text-muted">← All customers</Link>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4">
          <Card>
            <div className="flex items-center gap-3">
              <Avatar name={`${c.firstName} ${c.lastName ?? ''}`} url={c.photoUrl} size={56} />
              <div>
                <h1 className="text-xl font-extrabold">{c.firstName} {c.lastName}</h1>
                {c.username && <a href={`https://t.me/${c.username}`} target="_blank" rel="noreferrer" className="text-sm font-semibold text-brand">@{c.username}</a>}
              </div>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-xs text-muted">Points</dt><dd className="text-2xl font-black">{c.pointsBalance}</dd></div>
              <div><dt className="text-xs text-muted">Level</dt><dd className="font-bold">{c.level.emoji} {c.level.name}</dd></div>
              <div><dt className="text-xs text-muted">Completed orders</dt><dd className="font-bold">{c.completed}</dd></div>
              <div><dt className="text-xs text-muted">Spent</dt><dd className="font-bold">{money(c.spentCents)}</dd></div>
              <div><dt className="text-xs text-muted">Phone</dt><dd className="font-semibold">{c.phone ?? '—'} {c.phoneVerified && <Badge className="bg-emerald-100 text-emerald-800">✓ Telegram</Badge>}</dd></div>
              <div><dt className="text-xs text-muted">Joined</dt><dd className="font-semibold">{shortDate(c.createdAt)} · {c.signupSource ?? 'direct'}</dd></div>
            </dl>
            {c.privacyAcceptedAt && <p className="mt-3 text-xs text-muted">Privacy notice accepted {dateTime(c.privacyAcceptedAt)}</p>}
          </Card>

          {isAdmin && (
            <Card className="space-y-3">
              <h2 className="font-bold">Adjust points</h2>
              <p className="text-xs text-muted">For goodwill gestures or corrections. Logged with your name and shown in the customer's history.</p>
              <div className="grid grid-cols-[100px_1fr] gap-2">
                <Input inputMode="numeric" value={delta} onChange={(e) => setDelta(e.target.value)} placeholder="+50" />
                <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason, e.g. Sorry for the late delivery" />
              </div>
              <Button block variant="secondary" loading={adjust.isPending} disabled={!Number.isInteger(Number(delta)) || Number(delta) === 0 || note.trim().length < 3} onClick={() => adjust.mutate()}>Apply</Button>
              <Field label="Account role" hint="Staff can run orders and the catalog; admins can also change loyalty and settings.">
                <Select value={c.role} onChange={(e) => setRole.mutate(e.target.value as Role)}>
                  <option value="customer">Customer</option><option value="staff">Staff</option><option value="admin">Admin</option>
                </Select>
              </Field>
            </Card>
          )}

          <Card>
            <h2 className="mb-2 font-bold">Addresses</h2>
            {addresses.length === 0 ? <p className="text-sm text-muted">None saved.</p> : addresses.map((a) => (
              <p key={a.id} className="text-sm"><b>{a.label}:</b> {[a.line1, a.line2, a.city].filter(Boolean).join(', ')}</p>
            ))}
          </Card>
        </div>

        <div className="space-y-4 lg:col-span-2">
          <Card>
            <h2 className="mb-3 font-bold">Rewards wallet</h2>
            {wallet.length === 0 ? <p className="text-sm text-muted">No rewards yet.</p> : (
              <div className="flex flex-wrap gap-2">
                {wallet.map((w) => (
                  <Badge key={w.id} className={cx('px-3 py-1 text-sm', w.status === 'available' ? 'bg-amber-100 text-amber-900' : 'bg-surface-2 text-muted')}>
                    {w.emoji} {w.title} · {w.status}
                  </Badge>
                ))}
              </div>
            )}
          </Card>
          <Card className="overflow-x-auto p-0">
            <h2 className="px-4 pt-4 font-bold">Orders</h2>
            <table className="mt-2 w-full text-sm">
              <tbody className="divide-y divide-line">
                {orders.map((o) => (
                  <tr key={o.id}>
                    <Td><Link className="font-semibold text-brand" to={`/admin/orders/${o.id}`}>{o.code}</Link></Td>
                    <Td className="text-muted">{shortDate(o.placedAt)}</Td>
                    <Td><Badge className={STATUS_META[o.status].tone}>{STATUS_META[o.status].label}</Badge></Td>
                    <Td className="text-right font-semibold">{money(o.totalCents)}</Td>
                  </tr>
                ))}
                {orders.length === 0 && <tr><Td className="text-muted">No orders yet.</Td></tr>}
              </tbody>
            </table>
          </Card>
          <Card className="overflow-x-auto p-0">
            <h2 className="px-4 pt-4 font-bold">Points history</h2>
            <table className="mt-2 w-full text-sm">
              <thead className="border-b border-line"><tr><Th>Date</Th><Th>Type</Th><Th>Note</Th><Th className="text-right">Change</Th><Th className="text-right">Balance</Th></tr></thead>
              <tbody className="divide-y divide-line">
                {pointsHistory.map((h) => (
                  <tr key={h.id}>
                    <Td className="whitespace-nowrap text-muted">{dateTime(h.createdAt)}</Td>
                    <Td>{h.type.replace(/_/g, ' ')}</Td>
                    <Td className="text-muted">{h.note}{h.orderId ? ` (#${String(h.orderId).padStart(4, '0')})` : ''}</Td>
                    <Td className={cx('text-right font-bold', h.delta > 0 ? 'text-emerald-600' : 'text-rose-600')}>{h.delta > 0 ? '+' : ''}{h.delta}</Td>
                    <Td className="text-right">{h.balanceAfter}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      </div>
    </div>
  );
}
