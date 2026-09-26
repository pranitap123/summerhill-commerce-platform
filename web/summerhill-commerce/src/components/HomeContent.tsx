'use client';

import { motion } from 'framer-motion';

export default function HomeContent({ categories, products }: { categories: any[]; products: any[] }) {
  return (
    <main className="min-h-screen">
      <section className="relative overflow-hidden bg-[#1F3A2E] text-[#FAF6EE] px-6 py-24 md:py-32">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="max-w-3xl relative z-10"
        >
          <p className="text-[#C9962C] font-medium mb-3 tracking-wide">Summerhill Market</p>
          <h1 className="font-display text-5xl md:text-7xl font-semibold leading-[1.05] mb-6">
            Fresh groceries, grown with care.
          </h1>
          <p className="text-[#DCE5D8] text-lg max-w-md">
            Locally sourced produce, pantry staples, and everyday essentials, delivered to your door.
          </p>
        </motion.div>
        <div className="absolute -right-20 -bottom-20 w-96 h-96 rounded-full bg-[#C9962C]/20 blur-3xl" />
      </section>

      <section className="max-w-6xl mx-auto px-6 py-16">
        <h2 className="font-display text-3xl mb-6 text-[#1F3A2E]">Shop by category</h2>
        <div className="flex flex-wrap gap-3">
          {categories.map(function (c: any) {
            return (
              <a key={c.id} href={"/shop?category=" + encodeURIComponent(c.name)} className="px-5 py-2.5 bg-[#DCE5D8] text-[#1F3A2E] rounded-full font-medium hover:bg-[#C9962C] hover:text-white transition-colors duration-200">
                {c.name}
              </a>
            );
          })}
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 pb-24">
        <h2 className="font-display text-3xl mb-8 text-[#1F3A2E]">Featured this week</h2>
        <motion.div
          initial="hidden"
          animate="show"
          variants={{ hidden: {}, show: { transition: { staggerChildren: 0.06 } } }}
          className="grid grid-cols-2 md:grid-cols-3 gap-6"
        >
          {products.map(function (p: any) {
            return (
              <motion.a
                key={p.id}
                variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } }}
                href={"/products/" + encodeURIComponent(p.id)}
                className="group bg-white rounded-2xl p-4 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300"
              >
                <div className="overflow-hidden rounded-xl mb-3">
                  <img src={p.images && p.images[0]} alt={p.name} className="h-36 w-full object-cover group-hover:scale-105 transition-transform duration-300" />
                </div>
                <p className="font-medium text-[#211F1C]">{p.name}</p>
                <p className="text-[#C9962C] font-semibold">${p.price}</p>
              </motion.a>
            );
          })}
        </motion.div>
      </section>
    </main>
  );
}
