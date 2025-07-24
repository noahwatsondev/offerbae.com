// src/app/articles/[slug]/page.tsx
import { prisma } from '@/lib/prisma';
import { notFound } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import ProductCard from '@/components/ProductCard'; // For relevant deals section
import Header from '@/components/Header';
import Footer from '@/components/Footer';

export async function generateStaticParams() {
  const articles = await prisma.article.findMany({
    select: { slug: true },
    where: { published: true }
  });
  return articles.map(article => ({ slug: article.slug }));
}

export const revalidate = 3600; // Revalidate article pages every hour

export default async function ArticlePage({ params }: { params: { slug: string } }) {
  const article = await prisma.article.findUnique({
    where: { slug: params.slug },
    include: { author: true },
  });

  if (!article || !article.published) {
    notFound();
  }

  // Fetch related deals (e.g., from article keywords or categories mentioned in text)
  // This is a simplified example. In a real scenario, you might use AI or more complex text analysis.
  const relatedDeals = await prisma.product.findMany({
    where: {
      OR: [
        { category: { contains: article.keywords?.split(',')[0] || '', mode: 'insensitive' } },
        { name: { contains: article.keywords?.split(',')[0] || '', mode: 'insensitive' } },
        { description: { contains: article.keywords?.split(',')[0] || '', mode: 'insensitive' } },
      ],
      imageUrl: { not: null, not: '' },
    },
    take: 3,
    orderBy: { lastFetchedAt: 'desc' },
    include: { advertiser: true },
  });


  return (
    <>
      <Header />
      <main className="container mx-auto px-4 py-8 max-w-4xl">
        <article className="bg-white rounded-lg shadow-md p-6 border border-gray-200">
          {article.imageUrl && (
            <div className="relative w-full h-80 mb-6 rounded-lg overflow-hidden border border-gray-300">
              <Image
                src={article.imageUrl}
                alt={article.title}
                fill
                sizes="100vw"
                priority
                style={{ objectFit: 'cover' }}
                className="rounded-lg"
              />
            </div>
          )}
          <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">{article.title}</h1>
          <p className="text-gray-600 text-sm mb-6 border-b pb-4 border-gray-100">
            By <span className="font-semibold text-blue-600">{article.author?.name || 'OfferBae Team'}</span> on {new Date(article.createdAt).toLocaleDateString()}
          </p>

          <div className="prose prose-lg max-w-none text-gray-800 leading-relaxed break-words" dangerouslySetInnerHTML={{ __html: article.content }}>
            {/* Using dangerouslySetInnerHTML if content comes from a rich text editor.
                Sanitize HTML if user-generated. For admin portal, assume trusted input. */}
          </div>

          {relatedDeals.length > 0 && (
            <section className="mt-12 pt-8 border-t border-gray-200">
              <h2 className="text-2xl font-bold text-gray-800 mb-4 text-center">Relevant Deals You Might Like</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
                {relatedDeals.map(deal => (
                  <ProductCard key={deal.id} product={deal} />
                ))}
              </div>
            </section>
          )}
        </article>
      </main>
      <Footer />
    </>
  );
}