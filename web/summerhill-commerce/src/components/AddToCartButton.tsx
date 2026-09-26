'use client';

import { useCartStore } from '@/lib/cartStore';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export default function AddToCartButton({ product }: { product: any }) {
  const addItem = useCartStore((s) => s.addItem);
  const [added, setAdded] = useState(false);

  function handleClick() {
    addItem({
      id: product.id,
      name: product.name,
      price: parseFloat(product.price),
      image: product.images?.[0] || '',
    });
    setAdded(true);
    setTimeout(() => setAdded(false), 1500);
  }

  return (
    <motion.button
      onClick={handleClick}
      whileTap={{ scale: 0.96 }}
      className="bg-[#1F3A2E] text-white px-8 py-3.5 rounded-full font-medium hover:bg-[#16291F] transition-colors relative overflow-hidden"
    >
      <AnimatePresence mode="wait">
        {added ? (
          <motion.span key="added" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
            Added ✓
          </motion.span>
        ) : (
          <motion.span key="add" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
            Add to Cart
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
}