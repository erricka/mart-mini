import { lazy, Suspense, useEffect } from 'react';
import { Route, Routes } from 'react-router-dom';
import { Toaster } from './components/Toaster';
import { Button, PageLoader } from './components/ui';
import { useShop } from './lib/queries';
import { useSession } from './lib/session';
import { CustomerLayout } from './pages/customer/Layout';
import { Home } from './pages/customer/Home';
import { Shop } from './pages/customer/Shop';
import { ProductPage } from './pages/customer/ProductPage';
import { Cart } from './pages/customer/Cart';
import { Checkout } from './pages/customer/Checkout';
import { Orders } from './pages/customer/Orders';
import { OrderPage } from './pages/customer/OrderPage';
import { PayPage } from './pages/customer/PayPage';
import { Rewards } from './pages/customer/Rewards';
import { Profile } from './pages/customer/Profile';
import { NotFound } from './pages/customer/NotFound';
import { Onboarding } from './pages/onboarding/Onboarding';
import { DevLogin, OutsideTelegram, Splash } from './pages/onboarding/Entry';

// The seller dashboard is a separate bundle — customers never download it.
const AdminApp = lazy(() => import('./pages/admin/AdminApp'));

export function App() {
  const { state, retry } = useSession();
  const shop = useShop();
  useEffect(() => {
    if (shop.data) document.title = shop.data.shopName;
  }, [shop.data]);

  let content;
  if (state.phase === 'booting') content = <Splash />;
  else if (state.phase === 'onboarding') content = <Onboarding token={state.onboardingToken} prefill={state.prefill} />;
  else if (state.phase === 'devlogin') content = <DevLogin />;
  else if (state.phase === 'outside') content = <OutsideTelegram />;
  else if (state.phase === 'error')
    content = (
      <div className="flex min-h-screen flex-col items-center justify-center p-8 text-center">
        <div className="mb-3 text-5xl">🔌</div>
        <h1 className="text-lg font-bold">We couldn't open the shop</h1>
        <p className="mt-1 max-w-xs text-sm text-muted">{state.message}</p>
        <Button className="mt-5" onClick={retry}>
          Try again
        </Button>
      </div>
    );
  else
    content = (
      <Routes>
        <Route
          path="/admin/*"
          element={
            <Suspense fallback={<PageLoader label="Opening dashboard…" />}>
              <AdminApp />
            </Suspense>
          }
        />
        <Route element={<CustomerLayout />}>
          <Route index element={<Home />} />
          <Route path="shop" element={<Shop />} />
          <Route path="product/:id" element={<ProductPage />} />
          <Route path="cart" element={<Cart />} />
          <Route path="checkout" element={<Checkout />} />
          <Route path="orders" element={<Orders />} />
          <Route path="orders/:id" element={<OrderPage />} />
          <Route path="orders/:id/pay" element={<PayPage />} />
          <Route path="rewards" element={<Rewards />} />
          <Route path="profile" element={<Profile />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    );

  return (
    <>
      {content}
      <Toaster />
    </>
  );
}
