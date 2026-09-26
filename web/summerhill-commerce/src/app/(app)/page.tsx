import HomeContent from '@/components/HomeContent';

async function getCategories() {
  const res = await fetch(`${process.env.NEXT_PUBLIC_SERVER_URL}/api/categories`, { cache: 'no-store' });
  return res.json();
}

async function getFeaturedProducts() {
  const res = await fetch(`${process.env.NEXT_PUBLIC_SERVER_URL}/api/products?limit=6`, { cache: 'no-store' });
  return res.json();
}

export default async function HomePage() {
  const { categories } = await getCategories();
  const { products } = await getFeaturedProducts();

  return <HomeContent categories={categories} products={products} />;
}
