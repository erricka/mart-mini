import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Avatar, Badge, Button, Card, Field, Input, Notice, SectionTitle, Sheet, Toggle } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { shortDate } from '../../lib/format';
import { useAddresses, useHome, useShop } from '../../lib/queries';
import { isStaff, useSession } from '../../lib/session';
import { canRequestContact, confirmDialog, inTelegram, requestTelegramContact } from '../../lib/telegram';
import { toast } from '../../lib/toast';
import type { Address, User } from '../../lib/types';

export function Profile() {
  const { user, setUser, signOut } = useSession();
  const home = useHome();
  const shop = useShop();
  const addresses = useAddresses();
  const qc = useQueryClient();
  const [editName, setEditName] = useState(false);
  const [editPhone, setEditPhone] = useState(false);
  const [editAddress, setEditAddress] = useState<Partial<Address> | null>(null);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  if (!user) return null;

  return (
    <div>
      <div className="flex flex-col items-center pt-2 text-center">
        <Avatar name={`${user.firstName} ${user.lastName ?? ''}`} url={user.photoUrl} size={88} />
        <h1 className="mt-3 text-2xl font-extrabold">{user.firstName} {user.lastName}</h1>
        {user.username && <p className="text-sm text-muted">@{user.username}</p>}
        <div className="mt-2 flex gap-2">
          {home.data && <Badge className="bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">{home.data.level.emoji} {home.data.level.name} · {home.data.balance} pts</Badge>}
          <Badge className="bg-surface-2">Member since {shortDate(user.createdAt)}</Badge>
        </div>
      </div>

      <SectionTitle>My details</SectionTitle>
      <Card className="divide-y divide-line p-0">
        <Row label="Name" value={`${user.firstName} ${user.lastName ?? ''}`} onEdit={() => setEditName(true)} />
        <Row
          label="Phone"
          value={user.phone ? <span>{user.phone} {user.phoneVerified && <Badge className="ml-1 bg-emerald-100 text-emerald-800">✓ Telegram</Badge>}</span> : <span className="text-muted">Not added yet</span>}
          onEdit={() => setEditPhone(true)}
        />
      </Card>

      <SectionTitle action={<button className="text-sm font-semibold text-brand" onClick={() => setEditAddress({ label: 'Home' })}>+ Add</button>}>Delivery addresses</SectionTitle>
      <div className="space-y-2">
        {addresses.data?.length === 0 && <Card className="text-sm text-muted">No saved addresses. You can add one now or at checkout.</Card>}
        {addresses.data?.map((a) => (
          <Card key={a.id} className="flex items-start gap-3">
            <span className="text-xl">{a.label.toLowerCase() === 'work' ? '🏢' : '🏠'}</span>
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{a.label} {a.isDefault && <Badge className="ml-1 bg-surface-2">Default</Badge>}</div>
              <div className="text-sm text-muted">{[a.line1, a.line2, a.city].filter(Boolean).join(', ')}</div>
              {a.instructions && <div className="text-xs text-muted">“{a.instructions}”</div>}
            </div>
            <button className="text-sm font-semibold text-brand" onClick={() => setEditAddress(a)}>Edit</button>
          </Card>
        ))}
      </div>

      <SectionTitle>More</SectionTitle>
      <Card className="divide-y divide-line p-0">
        <LinkRow to="/orders" icon="📦" label="My orders" />
        <LinkRow to="/rewards" icon="🎁" label="Rewards & points history" />
        <button className="flex w-full items-center gap-3 px-4 py-3.5 text-left font-semibold" onClick={() => setPrivacyOpen(true)}>🔒 Privacy notice</button>
        {shop.data?.supportPhone && <a href={`tel:${shop.data.supportPhone}`} className="flex items-center gap-3 px-4 py-3.5 font-semibold">📞 Call the shop · {shop.data.supportPhone}</a>}
        {isStaff(user) && <LinkRow to="/admin" icon="🧑‍💼" label="Staff dashboard" />}
      </Card>

      {!inTelegram && (
        <Button variant="ghost" block className="mt-6" onClick={signOut}>Switch dev user</Button>
      )}

      <NameSheet open={editName} onClose={() => setEditName(false)} user={user} onSaved={setUser} />
      <PhoneSheet open={editPhone} onClose={() => setEditPhone(false)} onSaved={setUser} />
      <AddressSheet
        address={editAddress}
        onClose={() => setEditAddress(null)}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ['addresses'] });
          setEditAddress(null);
        }}
      />
      <Sheet open={privacyOpen} onClose={() => setPrivacyOpen(false)} title="Privacy notice">
        <div className="space-y-3 text-sm">
          <p><b>What we keep:</b> your name, Telegram ID and photo, phone number (if you share it), delivery addresses, orders and loyalty points.</p>
          <p><b>Why:</b> to prepare and deliver your orders, contact you about them, and run your rewards.</p>
          <p><b>What we never do:</b> sell your data or send ads from other companies.</p>
          <p><b>Your control:</b> edit your details here any time. To delete your account, contact {shop.data?.supportPhone || 'the shop'}.</p>
        </div>
      </Sheet>
    </div>
  );
}

function Row({ label, value, onEdit }: { label: string; value: React.ReactNode; onEdit: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3.5">
      <div className="min-w-0">
        <div className="text-xs text-muted">{label}</div>
        <div className="truncate font-semibold">{value}</div>
      </div>
      <button onClick={onEdit} className="text-sm font-semibold text-brand">Edit</button>
    </div>
  );
}

const LinkRow = ({ to, icon, label }: { to: string; icon: string; label: string }) => (
  <Link to={to} className="flex items-center justify-between px-4 py-3.5 font-semibold">
    <span>{icon} {label}</span>
    <span className="text-muted">›</span>
  </Link>
);

function NameSheet({ open, onClose, user, onSaved }: { open: boolean; onClose: () => void; user: User; onSaved: (u: User) => void }) {
  const [first, setFirst] = useState(user.firstName);
  const [last, setLast] = useState(user.lastName ?? '');
  const save = useMutation({
    mutationFn: () => api<{ user: User }>('/me', { method: 'PATCH', body: { firstName: first.trim(), lastName: last.trim() || null } }),
    onSuccess: (r) => {
      onSaved(r.user);
      toast('Saved ✓', 'success');
      onClose();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  return (
    <Sheet open={open} onClose={onClose} title="Your name">
      <div className="space-y-3">
        <Field label="First name"><Input value={first} onChange={(e) => setFirst(e.target.value)} /></Field>
        <Field label="Last name (optional)"><Input value={last} onChange={(e) => setLast(e.target.value)} /></Field>
        <Button block loading={save.isPending} disabled={!first.trim()} onClick={() => save.mutate()}>Save</Button>
      </div>
    </Sheet>
  );
}

function PhoneSheet({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: (u: User) => void }) {
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (body: { phone?: string | null; contactResponse?: string }) => api<{ user: User }>('/me/phone', { method: 'PUT', body }),
    onSuccess: (r) => {
      onSaved(r.user);
      toast('Phone updated ✓', 'success');
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Sheet open={open} onClose={onClose} title="Phone number">
      <div className="space-y-3">
        {canRequestContact() && (
          <Button
            block
            variant="secondary"
            onClick={async () => {
              const r = await requestTelegramContact();
              if (r) save.mutate({ contactResponse: r.response });
            }}
          >
            📱 Share my Telegram number
          </Button>
        )}
        <Field label={canRequestContact() ? 'Or type it' : 'Phone number'} error={error}>
          <Input type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+855 12 345 678" />
        </Field>
        <Button block loading={save.isPending} disabled={phone.trim().length < 7} onClick={() => save.mutate({ phone: phone.trim() })}>Save number</Button>
        <button className="w-full text-sm text-muted underline" onClick={() => save.mutate({ phone: null })}>Remove my number</button>
      </div>
    </Sheet>
  );
}

function AddressSheet({ address, onClose, onSaved }: { address: Partial<Address> | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<Partial<Address>>({});
  const [loadedFor, setLoadedFor] = useState<Partial<Address> | null>(null);
  if (address !== loadedFor) {
    setLoadedFor(address);
    setForm(address ?? {});
  }
  const save = useMutation({
    mutationFn: () => {
      const body = { label: form.label || 'Home', line1: form.line1 ?? '', line2: form.line2 || null, city: form.city ?? '', postalCode: form.postalCode || null, instructions: form.instructions || null, isDefault: !!form.isDefault };
      return form.id ? api(`/me/addresses/${form.id}`, { method: 'PUT', body }) : api('/me/addresses', { body });
    },
    onSuccess: () => {
      toast('Address saved ✓', 'success');
      onSaved();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const remove = useMutation({
    mutationFn: () => api(`/me/addresses/${form.id}`, { method: 'DELETE' }),
    onSuccess: onSaved,
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const set = (k: keyof Address) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  return (
    <Sheet open={!!address} onClose={onClose} title={form.id ? 'Edit address' : 'New address'}>
      <div className="space-y-3">
        <div className="flex gap-2">
          {['Home', 'Work', 'Other'].map((l) => (
            <button key={l} onClick={() => setForm({ ...form, label: l })} className={`rounded-full px-4 py-1.5 text-sm font-semibold ${form.label === l ? 'bg-ink text-bg' : 'bg-surface-2'}`}>{l}</button>
          ))}
        </div>
        <Field label="Street address"><Input value={form.line1 ?? ''} onChange={set('line1')} /></Field>
        <Field label="Apartment, floor (optional)"><Input value={form.line2 ?? ''} onChange={set('line2')} /></Field>
        <Field label="City / district"><Input value={form.city ?? ''} onChange={set('city')} /></Field>
        <Field label="Directions for the driver (optional)"><Input value={form.instructions ?? ''} onChange={set('instructions')} /></Field>
        <Toggle checked={!!form.isDefault} onChange={(v) => setForm({ ...form, isDefault: v })} label="Use as default" />
        <Button block loading={save.isPending} disabled={(form.line1?.trim().length ?? 0) < 3 || (form.city?.trim().length ?? 0) < 2} onClick={() => save.mutate()}>Save address</Button>
        {form.id && (
          <Button variant="ghost" block className="text-rose-600" onClick={async () => { if (await confirmDialog('Delete this address?')) remove.mutate(); }}>Delete address</Button>
        )}
        {save.error && <Notice tone="error">{errorMessage(save.error)}</Notice>}
      </div>
    </Sheet>
  );
}
