'use client';

import { useCartStore } from '@/lib/cartStore';
import { useState } from 'react';

export default function CartPage() {
  const { items, increaseQty, decreaseQty, removeItem, totalPrice } = useCartStore();
  const [loading, setLoading] = useState(false);

  async function handleCheckout() {
    setLoading(true);
    const res = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    });
    const data = await res.json();
    if (data.url) window.location.href = data.url;
    setLoading(false);
  }

  if (items.length === 0) {
    return <main className="max-w-3xl mx-auto px-4 py-10">Your cart is empty.</main>;
  }

  return (
    <main className="max-w-3xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-semibold mb-6">Cart</h1>
      <div className="space-y-4">
        {items.map((item) => (
          <div key={item.id} className="flex items-center justify-between border-b pb-3">
            <div className="flex items-center gap-3">
              <img src={item.image} alt={item.name} className="w-16 h-16 object-cover rounded" />
              <div>
                <p className="font-medium">{item.name}</p>
                <p className="text-neutral-600">${item.price}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => decreaseQty(item.id)} className="border px-2 rounded">-</button>
              <span>{item.quantity}</span>
              <button onClick={() => increaseQty(item.id)} className="border px-2 rounded">+</button>
              <button onClick={() => removeItem(item.id)} className="text-red-600 ml-3">Remove</button>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 flex justify-between items-center">
        <p className="text-xl font-bold">Total: ${totalPrice().toFixed(2)}</p>
        <button
          onClick={handleCheckout}
          disabled={loading}
          className="bg-black text-white px-6 py-3 rounded-lg hover:bg-neutral-800"
        >
          {loading ? 'Redirecting...' : 'Checkout'}
        </button>
      </div>
    </main>
  );
}