'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';

function ShopContent() {
  const searchParams = useSearchParams();
  const initialCategory = searchParams.get('category') || '';
  const [category, setCategory] = useState(initialCategory);
  const [query, setQuery] = useState('');
  const [products, setProducts] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(function () {
    fetch('/api/categories').then(function (r) { return r.json(); }).then(function (d) { setCategories(d.categories); });
  }, []);

  useEffect(function () {
    setLoading(true);
    let url;
    if (query.trim()) {
      url = '/api/products/search?q=' + encodeURIComponent(query);
    } else if (category) {
      url = '/api/products?category=' + encodeURIComponent(category) + '&limit=50';
    } else {
      url = '/api/products?limit=50';
    }
    fetch(url)
      .then(function (r) { return r.json(); })
      .then(function (d) { setProducts(d.products || d.results); })
      .finally(function () { setLoading(false); });
  }, [category, query]);

  return (
    <main className="max-w-6xl mx-auto px-6 py-16">
      <motion.h1
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="font-display text-4xl mb-8 text-[#1F3A2E]"
      >
        Shop
      </motion.h1>

      <div className="flex flex-col md:flex-row gap-4 mb-10">
        <input
          type="text"
          value={query}
          onChange={function (e) { setQuery(e.target.value); }}
          placeholder="Search products..."
          className="flex-1 border border-[#DCE5D8] rounded-full px-5 py-2.5 bg-white text-[#1F3A2E] focus:outline-none focus:ring-2 focus:ring-[#C9962C]"
        />
        <select
          value={category}
          onChange={function (e) { setCategory(e.target.value); }}
          disabled={!!query.trim()}
          className="border border-[#DCE5D8] rounded-full px-5 py-2.5 bg-white text-[#1F3A2E] font-medium disabled:opacity-50"
        >
          <option value="">All Categories</option>
          {categories.map(function (c: any) {
            return <option key={c.id} value={c.name}>{c.name}</option>;
          })}
        </select>
      </div>

      {loading ? (
        <p className="text-[#211F1C]">Loading...</p>
      ) : (
        <motion.div
          initial="hidden"
          animate="show"
          variants={{ hidden: {}, show: { transition: { staggerChildren: 0.04 } } }}
          className="grid grid-cols-2 md:grid-cols-4 gap-6"
        >
          {products.map(function (p: any) {
            return (
              <motion.a
                key={p.id}
                variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } }}
                href={"/products/" + encodeURIComponent(p.id)}
                className="group bg-white rounded-2xl p-3 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300"
              >
                <div className="overflow-hidden rounded-xl mb-2">
                  <img src={p.images && p.images[0]} alt={p.name} className="h-28 w-full object-cover group-hover:scale-105 transition-transform duration-300" />
                </div>
                <p className="text-sm font-medium text-[#211F1C]">{p.name}</p>
                <p className="text-[#C9962C] text-sm font-semibold">${p.price}</p>
              </motion.a>
            );
          })}
        </motion.div>
      )}
    </main>
  );
}

export default function ShopPage() {
  return (
    <Suspense fallback={<p>Loading...</p>}>
      <ShopContent />
    </Suspense>
  );
}
