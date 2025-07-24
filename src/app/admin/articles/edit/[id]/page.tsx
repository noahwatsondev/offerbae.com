// src/app/admin/articles/edit/[id]/page.tsx
import { notFound, redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma'; // Your Prisma Client instance
import { auth } from '@/lib/auth'; // Your NextAuth.js setup
import EditArticleForm from './EditArticleForm'; // Client Component for the form

interface EditArticlePageProps {
  params: {
    id: string; // The ID from the URL segment [id]
  };
}

export default async function EditArticlePage({ params }: EditArticlePageProps) {
  // 1. Authenticate and Authorize (Server-side check)
  const session = await auth();
  if (!session || session.user?.role !== 'admin') {
    // Redirect to login or unauthorized page if not authenticated/authorized
    redirect('/admin/login?callbackUrl=/admin/articles/edit/' + params.id);
  }

  // 2. Fetch Article Data
  const article = await prisma.article.findUnique({
    where: { id: params.id },
  });

  if (!article) {
    notFound(); // Display a 404 page if article not found
  }

  // Pass the fetched article data to the client component
  return (
    <div className="container mx-auto p-4">
      <h1 className="text-3xl font-bold mb-6 text-gray-800">Edit Article</h1>
      <EditArticleForm initialArticle={article} />
    </div>
  );
}