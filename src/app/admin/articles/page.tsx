// src/app/admin/articles/page.tsx (Example for managing articles)
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';

export default async function ManageArticlesPage() {
  const session = await auth();

  // Ensure authenticated
  if (!session) {
    redirect('/admin/login');
  }

  // Implement role-based authorization
  if (session.user?.role !== 'admin' && session.user?.role !== 'editor') {
    // Redirect or show an access denied message
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <p className="text-red-600 text-lg">Access Denied: You do not have permission to manage articles.</p>
      </div>
    );
  }

  // Fetch articles for management
  const articles = await prisma.article.findMany({
    orderBy: { createdAt: 'desc' },
    include: { author: true },
  });

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-6">Manage Articles</h1>
      {session.user?.role === 'admin' && ( // Only admin can create new articles (example)
        <a href="/admin/articles/new" className="bg-green-500 text-white py-2 px-4 rounded mb-4 inline-block">Create New Article</a>
      )}

      <div className="overflow-x-auto">
        <table className="min-w-full bg-white shadow-md rounded-lg overflow-hidden">
          <thead className="bg-gray-200">
            <tr>
              <th className="py-3 px-4 text-left">Title</th>
              <th className="py-3 px-4 text-left">Author</th>
              <th className="py-3 px-4 text-left">Published</th>
              <th className="py-3 px-4 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {articles.map((article) => (
              <tr key={article.id} className="border-b last:border-b-0 hover:bg-gray-50">
                <td className="py-3 px-4">{article.title}</td>
                <td className="py-3 px-4">{article.author?.name || 'N/A'}</td>
                <td className="py-3 px-4">{article.published ? 'Yes' : 'No'}</td>
                <td className="py-3 px-4">
                  <a href={`/admin/articles/edit/${article.id}`} className="text-blue-600 hover:underline mr-2">Edit</a>
                  {session.user?.role === 'admin' && ( // Only admin can delete (example)
                    <button className="text-red-600 hover:underline">Delete</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}