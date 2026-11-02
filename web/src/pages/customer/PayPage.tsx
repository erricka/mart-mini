import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Badge, Button, Card, celebrate, ErrorState, Notice, PageLoader } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { confirmDialog } from '../../lib/telegram';
import { toast } from '../../lib/toast';
import type { PaymentSession } from '../../lib/types';

function useCountdown(until: string | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!until) return null;
  const left = Math.max(0, Math.floor((new Date(until).getTime() - now) / 1000));
  return { left, label: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` };
}

/** QR payment screen. The order reaches the shop only once the payment is confirmed. */
export function PayPage() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const session = useQuery({
    queryKey: ['payment', id],
    queryFn: () => api<{ payment: PaymentSession }>(`/orders/${id}/payment`).then((r) => r.payment),
    refetchInterval: (q) => (q.state.data?.status === 'awaiting_payment' ? 3000 : false),
  });
  const p = session.data;
  const countdown = useCountdown(p?.status === 'awaiting_payment' ? p.expiresAt : null);
  const celebrated = useRef(false);

  const paid = !!p && p.paymentStatus === 'paid';
  useEffect(() => {
    if (paid && !celebrated.current) {
      celebrated.current = true;
      celebrate();
      for (const k of ['orders', 'home', 'order']) qc.invalidateQueries({ queryKey: [k] });
    }
  }, [paid, qc]);

  const action = useMutation({
    mutationFn: (kind: 'simulate' | 'cash' | 'cancel') =>
      kind === 'cancel'
        ? api(`/orders/${id}/cancel`, { body: { reason: 'Cancelled at payment' } })
        : api<{ payment: PaymentSession }>(`/orders/${id}/payment/${kind}`, { body: {} }),
    onSuccess: (_r, kind) => {
      qc.invalidateQueries({ queryKey: ['payment', id] });
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['home'] });
      if (kind === 'cash') navigate(`/orders/${id}?placed=1`, { replace: true });
      if (kind === 'cancel') {
        toast('Order cancelled');
        navigate(`/orders/${id}`, { replace: true });
      }
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  if (session.isLoading) return <PageLoader label="Preparing your payment…" />;
  if (session.error || !p) return <ErrorState error={session.error} onRetry={() => session.refetch()} />;

  if (paid) {
    return (
      <div className="animate-rise flex flex-col items-center pt-10 text-center">
        <div className="animate-wiggle text-7xl">✅</div>
        <h1 className="mt-4 text-2xl font-extrabold">Payment received!</h1>
        <p className="mt-1 max-w-xs text-muted">Order {p.code} ({p.amountLabel}) is now with the shop. We'll message you in Telegram as it moves along.</p>
        <Button size="lg" className="mt-8" onClick={() => navigate(`/orders/${id}`, { replace: true })}>Track my order</Button>
      </div>
    );
  }

  if (p.status !== 'awaiting_payment') {
    return (
      <div className="flex flex-col items-center pt-10 text-center">
        <div className="text-6xl">{p.status === 'cancelled' ? '⌛' : '📦'}</div>
        <h1 className="mt-4 text-xl font-extrabold">{p.status === 'cancelled' ? 'This payment has closed' : 'Nothing to pay here'}</h1>
        <p className="mt-1 max-w-xs text-muted">{p.status === 'cancelled' ? 'The order was cancelled and the items went back on the shelf.' : 'This order is already with the shop.'}</p>
        <div className="mt-6 flex gap-2">
          <Link to={`/orders/${id}`}><Button variant="secondary">View order</Button></Link>
          <Link to="/shop"><Button>Back to shop</Button></Link>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-rise">
      <div className="text-center">
        <p className="text-sm font-semibold text-muted">Order {p.code}</p>
        <h1 className="mt-1 text-4xl font-black">{p.amountLabel}</h1>
        <div className="mt-2 flex justify-center gap-2">
          <Badge className="bg-surface-2">{p.providerLabel}</Badge>
          {countdown && <Badge className={countdown.left < 120 ? 'bg-rose-100 text-rose-800' : 'bg-orange-100 text-orange-900'}>⏱ {countdown.label} left</Badge>}
        </div>
      </div>

      {p.simulated && (
        <Notice tone="warn" className="mt-4 text-center font-semibold">SIMULATED PAYMENT — demo only, no money moves. Connect ABA PayWay to take real payments.</Notice>
      )}

      <Card className="mt-4 flex flex-col items-center">
        {p.qrImageUrl ? (
          <img src={p.qrImageUrl} alt={`Payment QR code for ${p.amountLabel}`} className="aspect-square w-full max-w-72 rounded-2xl bg-white p-2" />
        ) : (
          <div className="grid aspect-square w-full max-w-72 place-items-center rounded-2xl bg-surface-2 p-6 text-center text-sm text-muted">
            {p.providerError ? `The payment QR couldn't be created: ${p.providerError}` : 'Loading your QR…'}
          </div>
        )}
        {p.reference && <p className="mt-3 text-sm text-muted">Reference <span className="font-mono font-bold text-ink">{p.reference}</span></p>}
        <p className="mt-2 text-center text-sm text-muted">{p.instructions}</p>
        {p.appLink && (
          <a href={p.appLink} className="mt-4 w-full">
            <Button block size="lg">Open in ABA Mobile</Button>
          </a>
        )}
        {p.qrImageUrl && (
          <a href={p.qrImageUrl} download={`payment-${p.code}.png`} className="mt-3 text-sm font-semibold text-brand">
            ⬇ Save QR image
          </a>
        )}
      </Card>

      <div className="mt-3 flex items-center justify-center gap-2 text-sm text-muted">
        <span className="h-2 w-2 animate-pulse rounded-full bg-brand" /> Waiting for payment — this page updates automatically
      </div>

      <div className="mt-6 grid gap-2">
        {p.simulated && (
          <Button block size="lg" variant="sun" loading={action.isPending && action.variables === 'simulate'} onClick={() => action.mutate('simulate')}>
            Simulate successful payment (demo)
          </Button>
        )}
        {p.cashEnabled && (
          <Button
            block
            variant="secondary"
            onClick={async () => {
              if (await confirmDialog('Pay with cash on delivery / at pickup instead?')) action.mutate('cash');
            }}
          >
            💵 Pay with cash instead
          </Button>
        )}
        <Button
          block
          variant="ghost"
          onClick={async () => {
            if (await confirmDialog('Cancel this order? The items go back on the shelf.')) action.mutate('cancel');
          }}
        >
          Cancel order
        </Button>
      </div>
    </div>
  );
}
