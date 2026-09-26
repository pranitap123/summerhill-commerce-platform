import stripe from '@/lib/stripe';

export default async function SuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  const { session_id } = await searchParams;

  if (!session_id) {
    return <main className="max-w-xl mx-auto px-4 py-10">Missing session ID.</main>;
  }

  const session = await stripe.checkout.sessions.retrieve(session_id);

  return (
    <main className="max-w-xl mx-auto px-4 py-10 text-center">
      <h1 className="text-2xl font-semibold mb-4">Order Confirmed 🎉</h1>
      <p className="mb-2">Payment status: <strong>{session.payment_status}</strong></p>
      <p className="mb-2">Amount paid: ${(session.amount_total! / 100).toFixed(2)} {session.currency?.toUpperCase()}</p>
      <p className="text-neutral-500">Session ID: {session.id}</p>
    </main>
  );
}