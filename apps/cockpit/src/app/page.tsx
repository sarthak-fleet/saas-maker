import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { auth } from '@/lib/auth';
import { isLocalAuthBypassEnabled } from '@/lib/local-auth';

export const metadata: Metadata = {
  title: 'SaaS Maker Cockpit',
  description: 'Sign in to review SaaS Maker feedback and manage project keys.',
  alternates: {
    canonical: '/',
  },
  robots: {
    index: true,
    follow: true,
  },
};

/** Route authenticated users to the inbox and everyone else to sign-in. */
export default async function HomePage() {
  const requestHeaders = await headers();
  if (isLocalAuthBypassEnabled(requestHeaders.get('host'))) {
    redirect('/projects/feedback');
  }

  const session = await auth.api.getSession({ headers: requestHeaders });
  if (session?.user) {
    redirect('/projects/feedback');
  }

  redirect('/login');
}
