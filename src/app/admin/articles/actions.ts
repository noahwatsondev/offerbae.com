'use server';

import { auth } from '@/lib/auth'; // Your NextAuth.js setup
import { prisma } from '@/lib/prisma'; // Your Prisma Client instance
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

// Helper function to check admin role
async function checkAdminAuth() {
  const session = await auth();
  if (!session || session.user?.role !== 'admin') {
    // For Server Actions, throwing an error is often better than returning a response
    // The client-side form will catch this error.
    throw new Error('Unauthorized access. Must be an administrator.');
  }
  return session.user.id;
}

/**
 * Server Action to create a new article.
 */
export async function createArticle(formData: FormData) {
  try {
    const authorId = await checkAdminAuth(); // Ensure admin access

    const title = formData.get('title') as string;
    const slug = formData.get('slug') as string;
    const content = formData.get('content') as string;
    const excerpt = formData.get('excerpt') as string;
    const imageUrl = formData.get('imageUrl') as string;
    const metaTitle = formData.get('metaTitle') as string;
    const metaDescription = formData.get('metaDescription') as string;
    const keywords = formData.get('keywords') as string;
    const published = formData.get('published') === 'on'; // Checkbox value

    if (!title || !slug || !content) {
      throw new Error('Missing required fields: Title, Slug, Content.');
    }

    const article = await prisma.article.create({
      data: {
        title,
        slug,
        content,
        excerpt,
        imageUrl,
        metaTitle,
        metaDescription,
        keywords,
        published,
        authorId: authorId,
      },
    });

    // Revalidate paths affected by this change (e.g., articles list, homepage)
    revalidatePath('/admin/articles');
    revalidatePath('/articles'); // Or specific path like `/articles/${article.slug}`
    revalidatePath('/'); // If articles appear on the homepage

    return { success: true, message: `Article "${article.title}" created successfully!` };

  } catch (error: any) {
    console.error('Failed to create article:', error);
    if (error.message.includes('Unauthorized')) {
        return { success: false, message: error.message };
    }
    if (error.code === 'P2002' && error.meta?.target?.includes('slug')) {
      return { success: false, message: 'An article with this slug already exists. Please choose a different one.' };
    }
    return { success: false, message: `Failed to create article: ${error.message || 'Unknown error'}` };
  }
}

/**
 * Server Action to update an existing article.
 */
export async function updateArticle(id: string, formData: FormData) {
  try {
    await checkAdminAuth(); // Ensure admin access

    const title = formData.get('title') as string;
    const slug = formData.get('slug') as string;
    const content = formData.get('content') as string;
    const excerpt = formData.get('excerpt') as string;
    const imageUrl = formData.get('imageUrl') as string;
    const metaTitle = formData.get('metaTitle') as string;
    const metaDescription = formData.get('metaDescription') as string;
    const keywords = formData.get('keywords') as string;
    const published = formData.get('published') === 'on'; // Checkbox value

    if (!title || !slug || !content || !id) {
      throw new Error('Missing required fields: ID, Title, Slug, Content.');
    }

    const article = await prisma.article.update({
      where: { id },
      data: {
        title,
        slug,
        content,
        excerpt,
        imageUrl,
        metaTitle,
        metaDescription,
        keywords,
        published,
      },
    });

    // Revalidate paths affected by this change
    revalidatePath('/admin/articles');
    revalidatePath(`/articles/${article.slug}`); // Specific article page
    revalidatePath('/'); // If articles appear on the homepage

    return { success: true, message: `Article "${article.title}" updated successfully!` };

  } catch (error: any) {
    console.error('Failed to update article:', error);
    if (error.message.includes('Unauthorized')) {
        return { success: false, message: error.message };
    }
    if (error.code === 'P2002' && error.meta?.target?.includes('slug')) {
      return { success: false, message: 'An article with this slug already exists. Please choose a different one.' };
    }
    if (error.code === 'P2025') { // Record not found
      return { success: false, message: 'Article not found.' };
    }
    return { success: false, message: `Failed to update article: ${error.message || 'Unknown error'}` };
  }
}

/**
 * Server Action to delete an article.
 */
export async function deleteArticle(id: string) {
  try {
    await checkAdminAuth(); // Ensure admin access

    if (!id) {
      throw new Error('Article ID is required for deletion.');
    }

    const deletedArticle = await prisma.article.delete({
      where: { id },
    });

    revalidatePath('/admin/articles'); // Revalidate the list
    revalidatePath(`/articles/${deletedArticle.slug}`); // Revalidate the deleted article's page
    revalidatePath('/'); // If articles appear on the homepage

    return { success: true, message: `Article "${deletedArticle.title}" deleted successfully!` };

  } catch (error: any) {
    console.error('Failed to delete article:', error);
    if (error.message.includes('Unauthorized')) {
        return { success: false, message: error.message };
    }
    if (error.code === 'P2025') {
      return { success: false, message: 'Article not found for deletion.' };
    }
    return { success: false, message: `Failed to delete article: ${error.message || 'Unknown error'}` };
  }
}