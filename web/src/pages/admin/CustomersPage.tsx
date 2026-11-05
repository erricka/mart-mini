import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Avatar, Badge, Button, Card, cx, ErrorState, Field, Input, PageLoader, Select, Skeleton } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { dateTime, money, shortDate } from '../../lib/format';
import { translate, useT, type TKey } from '../../lib/i18n';
import { STATUS_META } from '../../lib/status';
import { confirmDialog } from '../../lib/telegram';
import { toast } from '../../lib/toast';
import type { Address, Level, OrderSummary, Role, User, WalletItem } from '../../lib/types';
import { PageHeader, Td, Th, useIsAdmin } from './common';

type Row = User & { signupSource: string | null; level: Level; orderCount: number; spentCents: number; lastOrderAt: string | null };

const sourceLabel = (s: string | null) => {
  const key = `aq.src_${s ?? 'direct'}` as TKey;
  const label = translate(key);
  return label === key ? (s ?? '') : label;
};

export function CustomersPage() {
  const { t } = useT();
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const navigate = useNavigate();
  const params = new URLSearchParams();
  if (q.trim()) params.set('q', q.trim());
  if (role) params.set('role', role);
  const list = useQuery({ queryKey: ['admin', 'customers', q.trim(), role], queryFn: () => api<{ customers: Row[]; total: number }>(`/admin/customers?${params}`), placeholderData: (p) => p });

  return (
    <div>
      <PageHeader title={t('ac.title')} subtitle={list.data ? t('ac.accounts', { n: list.data.total }) : undefined} />
      <div className="mb-4 flex flex-wrap gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('ac.search')} className="max-w-72 py-2" />
        <Select value={role} onChange={(e) => setRole(e.target.value)} className="max-w-44 py-2">
          <option value="">{t('ac.everyone')}</option><option value="customer">{t('ac.customers')}</option><option value="staff">{t('ac.staff')}</option><option value="admin">{t('ac.admins')}</option>
        </Select>
      </div>
      {list.isLoading ? <Skeleton className="h-96" /> : list.error ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-line"><tr><Th>{t('ac.col_customer')}</Th><Th className="hidden md:table-cell">{t('ac.col_phone')}</Th><Th>{t('ac.col_points')}</Th><Th className="hidden sm:table-cell">{t('ac.col_orders')}</Th><Th className="hidden lg:table-cell">{t('ac.col_spent')}</Th><Th className="hidden lg:table-cell">{t('ac.col_joined')}</Th></tr></thead>
            <tbody className="divide-y divide-line">
              {list.data!.customers.map((c) => (
                <tr key={c.id} className="cursor-pointer hover:bg-surface-2/60" onClick={() => navigate(`/admin/customers/${c.id}`)}>
                  <Td>
                    <div className="flex items-center gap-3">
                      <Avatar name={`${c.firstName} ${c.lastName ?? ''}`} url={c.photoUrl} size={36} />
                      <div className="min-w-0">
                        <div className="font-semibold">{c.firstName} {c.lastName} {c.role !== 'customer' && <Badge className="ml-1 bg-violet-100 text-violet-800">{t(`ad.role_${c.role}` as TKey)}</Badge>}</div>
                        <div className="text-xs text-muted">{c.username ? `@${c.username}` : t('ac.no_username')}{c.languageCode ? ` · ${c.languageCode === 'km' ? 'ខ្មែរ' : 'EN'}` : ''}</div>
                      </div>
                    </div>
                  </Td>
                  <Td className="hidden md:table-cell">{c.phone ?? <span className="text-muted">—</span>} {c.phoneVerified && '✓'}</Td>
                  <Td><span className="font-bold">{c.pointsBalance}</span> <span className="text-xs text-muted">{c.level.emoji} {c.level.name}</span></Td>
                  <Td className="hidden sm:table-cell">{c.orderCount}</Td>
                  <Td className="hidden lg:table-cell">{money(c.spentCents)}</Td>
                  <Td className="hidden lg:table-cell"><div>{shortDate(c.createdAt)}</div><div className="text-xs text-muted">{t('ac.via', { source: sourceLabel(c.signupSource) })}</div></Td>
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
  const { t } = useT();
  const isAdmin = useIsAdmin();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'customer', id], queryFn: () => api<Detail>(`/admin/customers/${id}`) });
  const [delta, setDelta] = useState('');
  const [note, setNote] = useState('');
  const adjust = useMutation({
    mutationFn: () => api<{ applied: boolean; balance: number }>(`/admin/customers/${id}/points`, { body: { delta: Number(delta), note, idempotencyKey: crypto.randomUUID() } }),
    onSuccess: (r) => {
      toast(t('ac.balance_now', { n: r.balance }), 'success');
      setDelta('');
      setNote('');
      qc.invalidateQueries({ queryKey: ['admin', 'customer', id] });
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const navigate = useNavigate();
  const remove = useMutation({
    mutationFn: () => api(`/admin/customers/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast(t('ac.removed'), 'success');
      qc.invalidateQueries({ queryKey: ['admin', 'customers'] });
      navigate('/admin/customers', { replace: true });
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const setRole = useMutation({
    mutationFn: (role: Role) => api(`/admin/customers/${id}/role`, { method: 'PUT', body: { role } }),
    onSuccess: () => {
      toast(t('ac.role_updated'), 'success');
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
      <Link to="/admin/customers" className="mb-3 inline-block text-sm font-semibold text-muted">{t('ac.all')}</Link>
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
              <div><dt className="text-xs text-muted">{t('ac.points')}</dt><dd className="text-2xl font-black">{c.pointsBalance}</dd></div>
              <div><dt className="text-xs text-muted">{t('ac.level')}</dt><dd className="font-bold">{c.level.emoji} {c.level.name}</dd></div>
              <div><dt className="text-xs text-muted">{t('ac.completed')}</dt><dd className="font-bold">{c.completed}</dd></div>
              <div><dt className="text-xs text-muted">{t('ac.spent')}</dt><dd className="font-bold">{money(c.spentCents)}</dd></div>
              <div><dt className="text-xs text-muted">{t('ac.phone')}</dt><dd className="font-semibold">{c.phone ?? '—'} {c.phoneVerified && <Badge className="bg-emerald-100 text-emerald-800">✓ Telegram</Badge>}</dd></div>
              <div><dt className="text-xs text-muted">{t('ac.joined')}</dt><dd className="font-semibold">{shortDate(c.createdAt)} · {sourceLabel(c.signupSource)}</dd></div>
              <div><dt className="text-xs text-muted">{t('ac.language')}</dt><dd className="font-semibold">{c.languageCode === 'en' ? 'English' : 'ភាសាខ្មែរ'}</dd></div>
            </dl>
            {c.privacyAcceptedAt && <p className="mt-3 text-xs text-muted">{t('ac.privacy_accepted', { date: dateTime(c.privacyAcceptedAt) })}</p>}
          </Card>

          {isAdmin && (
            <Card className="space-y-3">
              <h2 className="font-bold">{t('ac.adjust')}</h2>
              <p className="text-xs text-muted">{t('ac.adjust_hint')}</p>
              <div className="grid grid-cols-[100px_1fr] gap-2">
                <Input inputMode="numeric" value={delta} onChange={(e) => setDelta(e.target.value)} placeholder="+50" />
                <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('ac.reason_ph')} />
              </div>
              <Button block variant="secondary" loading={adjust.isPending} disabled={!Number.isInteger(Number(delta)) || Number(delta) === 0 || note.trim().length < 3} onClick={() => adjust.mutate()}>{t('ac.apply')}</Button>
              <Field label={t('ac.role')} hint={t('ac.role_hint')}>
                <Select value={c.role} onChange={(e) => setRole.mutate(e.target.value as Role)}>
                  <option value="customer">{t('ad.role_customer')}</option><option value="staff">{t('ad.role_staff')}</option><option value="admin">{t('ad.role_admin')}</option>
                </Select>
              </Field>
            </Card>
          )}

          {isAdmin && c.role === 'customer' && (
            <Card className="space-y-2 ring-1 ring-rose-200 dark:ring-rose-500/30">
              <h2 className="font-bold text-rose-700 dark:text-rose-300">{t('ac.remove_title')}</h2>
              <p className="text-xs text-muted">{t('ac.remove_text')}</p>
              <Button
                block
                variant="danger"
                loading={remove.isPending}
                onClick={async () => {
                  if (await confirmDialog(t('ac.remove_confirm', { name: `${c.firstName} ${c.lastName ?? ''}`.trim() }))) remove.mutate();
                }}
              >
                {t('ac.remove_button')}
              </Button>
            </Card>
          )}

          <Card>
            <h2 className="mb-2 font-bold">{t('ac.addresses')}</h2>
            {addresses.length === 0 ? <p className="text-sm text-muted">{t('ac.none_saved')}</p> : addresses.map((a) => (
              <p key={a.id} className="text-sm"><b>{['Home', 'Work', 'Other'].includes(a.label) ? t(`pf.label_${a.label}` as TKey) : a.label}:</b> {[a.line1, a.line2, a.city].filter(Boolean).join(', ')}</p>
            ))}
          </Card>
        </div>

        <div className="space-y-4 lg:col-span-2">
          <Card>
            <h2 className="mb-3 font-bold">{t('ac.wallet')}</h2>
            {wallet.length === 0 ? <p className="text-sm text-muted">{t('ac.no_rewards')}</p> : (
              <div className="flex flex-wrap gap-2">
                {wallet.map((w) => (
                  <Badge key={w.id} className={cx('px-3 py-1 text-sm', w.status === 'available' ? 'bg-amber-100 text-amber-900' : 'bg-surface-2 text-muted')}>
                    {w.emoji} {w.title} · {t(`ac.w_${w.status}` as TKey)}
                  </Badge>
                ))}
              </div>
            )}
          </Card>
          <Card className="overflow-x-auto p-0">
            <h2 className="px-4 pt-4 font-bold">{t('ac.orders')}</h2>
            <table className="mt-2 w-full text-sm">
              <tbody className="divide-y divide-line">
                {orders.map((o) => (
                  <tr key={o.id}>
                    <Td><Link className="font-semibold text-brand" to={`/admin/orders/${o.id}`}>{o.code}</Link></Td>
                    <Td className="text-muted">{shortDate(o.placedAt)}</Td>
                    <Td><Badge className={STATUS_META[o.status].tone}>{t(`status.${o.status}` as TKey)}</Badge></Td>
                    <Td className="text-right font-semibold">{money(o.totalCents)}</Td>
                  </tr>
                ))}
                {orders.length === 0 && <tr><Td className="text-muted">{t('ac.no_orders')}</Td></tr>}
              </tbody>
            </table>
          </Card>
          <Card className="overflow-x-auto p-0">
            <h2 className="px-4 pt-4 font-bold">{t('ac.history')}</h2>
            <table className="mt-2 w-full text-sm">
              <thead className="border-b border-line"><tr><Th>{t('ac.col_date')}</Th><Th>{t('ac.col_type')}</Th><Th>{t('ac.col_note')}</Th><Th className="text-right">{t('ac.col_change')}</Th><Th className="text-right">{t('ac.col_balance')}</Th></tr></thead>
              <tbody className="divide-y divide-line">
                {pointsHistory.map((h) => (
                  <tr key={h.id}>
                    <Td className="whitespace-nowrap text-muted">{dateTime(h.createdAt)}</Td>
                    <Td>{t(`rw.h_${h.type}` as TKey)}</Td>
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
