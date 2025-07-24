'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'react-hot-toast';
import { updateArticle } from '../../actions'; // Import the server action

// Define the Article type based on your Prisma schema (or a subset)
interface Article {
  id: string;
  title: string;
  slug: string;
  content: string;
  excerpt: string | null;
  imageUrl: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  keywords: string | null;
  published: boolean;
  // Add other fields you want to display/edit
}

interface EditArticleFormProps {
  initialArticle: Article;
}

export default function EditArticleForm({ initialArticle }: EditArticleFormProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  // State for form inputs, initialized with existing article data
  const [formData, setFormData] = useState({
    title: initialArticle.title,
    slug: initialArticle.slug,
    content: initialArticle.content,
    excerpt: initialArticle.excerpt || '',
    imageUrl: initialArticle.imageUrl || '',
    metaTitle: initialArticle.metaTitle || '',
    metaDescription: initialArticle.metaDescription || '',
    keywords: initialArticle.keywords || '',
    published: initialArticle.published,
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    if (type === 'checkbox') {
      setFormData(prev => ({ ...prev, [name]: (e.target as HTMLInputElement).checked }));
    } else {
      setFormData(prev => ({ ...prev, [name]: value }));
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    const form = new FormData(event.currentTarget); // Get current form data

    // Call the server action with the article ID and form data
    const result = await updateArticle(initialArticle.id, form);

    if (result.success) {
      toast.success(result.message);
      router.push('/admin/articles'); // Redirect to articles list after update
    } else {
      toast.error(result.message || 'Failed to update article.');
    }
    setIsSubmitting(false);
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white p-8 rounded-lg shadow-md space-y-6">
      <div>
        <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-1">Title</label>
        <input
          type="text"
          id="title"
          name="title"
          required
          value={formData.title}
          onChange={handleChange}
          className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
        />
      </div>
      <div>
        <label htmlFor="slug" className="block text-sm font-medium text-gray-700 mb-1">Slug (URL Path)</label>
        <input
          type="text"
          id="slug"
          name="slug"
          required
          value={formData.slug}
          onChange={handleChange}
          className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
          placeholder="e.g., my-edited-article-title"
        />
      </div>
      <div>
        <label htmlFor="content" className="block text-sm font-medium text-gray-700 mb-1">Content</label>
        <textarea
          id="content"
          name="content"
          rows={10}
          required
          value={formData.content}
          onChange={handleChange}
          className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
          placeholder="Edit your article content here..."
        ></textarea>
      </div>
      <div>
        <label htmlFor="excerpt" className="block text-sm font-medium text-gray-700 mb-1">Excerpt (Short Summary)</label>
        <textarea
          id="excerpt"
          name="excerpt"
          rows={3}
          value={formData.excerpt}
          onChange={handleChange}
          className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
          placeholder="A brief summary for listings..."
        ></textarea>
      </div>
      <div>
        <label htmlFor="imageUrl" className="block text-sm font-medium text-gray-700 mb-1">Image URL</label>
        <input
          type="url"
          id="imageUrl"
          name="imageUrl"
          value={formData.imageUrl}
          onChange={handleChange}
          className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
          placeholder="https://example.com/image.jpg"
        />
      </div>
      <div>
        <label htmlFor="metaTitle" className="block text-sm font-medium text-gray-700 mb-1">Meta Title (for SEO)</label>
        <input
          type="text"
          id="metaTitle"
          name="metaTitle"
          value={formData.metaTitle}
          onChange={handleChange}
          className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
          placeholder="Optimized title for search engines"
        />
      </div>
      <div>
        <label htmlFor="metaDescription" className="block text-sm font-medium text-gray-700 mb-1">Meta Description (for SEO)</label>
        <textarea
          id="metaDescription"
          name="metaDescription"
          rows={2}
          value={formData.metaDescription}
          onChange={handleChange}
          className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
          placeholder="Brief description for search engine results"
        ></textarea>
      </div>
      <div>
        <label htmlFor="keywords" className="block text-sm font-medium text-gray-700 mb-1">Keywords (Comma-separated)</label>
        <input
          type="text"
          id="keywords"
          name="keywords"
          value={formData.keywords}
          onChange={handleChange}
          className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
          placeholder="keyword1, keyword2, keyword3"
        />
      </div>
      <div className="flex items-center">
        <input
          type="checkbox"
          id="published"
          name="published"
          checked={formData.published}
          onChange={handleChange}
          className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
        />
        <label htmlFor="published" className="ml-2 block text-sm font-medium text-gray-700">Publish Article</label>
      </div>
      <div className="flex justify-end space-x-3">
        <button
          type="button"
          onClick={() => router.back()}
          className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? 'Updating...' : 'Update Article'}
        </button>
      </div>
    </form>
  );
}