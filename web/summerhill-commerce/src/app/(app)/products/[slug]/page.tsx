import AddToCartButton from '@/components/AddToCartButton';

async function getProduct(id: string) {
  try {
    const decodedId = decodeURIComponent(id);
    const url = `${process.env.NEXT_PUBLIC_SERVER_URL}/api/products/${encodeURIComponent(decodedId)}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      return null;
    }
    const product = await res.json();
    return product;
  } catch (err) {
    console.error('Error fetching product:', err);
    return null;
  }
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = await getProduct(slug);

  if (!product) {
    return <main className="max-w-3xl mx-auto px-6 py-10">Product not found.</main>;
  }

  return (
    <main className="max-w-3xl mx-auto px-6 py-10 grid md:grid-cols-2 gap-8">
      <img src={product.images && product.images[0]} alt={product.name} className="w-full rounded-lg" />
      <div>
        <h1 className="font-display text-3xl font-semibold mb-2 text-[#1F3A2E]">{product.name}</h1>
        <p className="text-[#211F1C] mb-2">{product.category} / {product.subcategory}</p>
        <p className="text-2xl font-bold text-[#C9962C] mb-4">${product.price} {product.currency}</p>
        <p className="mb-6 text-[#211F1C]">{product.description || 'No description available.'}</p>
        <AddToCartButton product={product} />
      </div>
    </main>
  );
}
