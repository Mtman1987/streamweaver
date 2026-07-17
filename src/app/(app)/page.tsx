import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { parseSessionCookie } from '@/lib/session-cookie';

export default async function AppHome() {
  const cookieStore = await cookies();
  const session = cookieStore.get('streamweaver-session');

  if (!parseSessionCookie(session?.value)) redirect('/login');

  redirect('/dashboard');
}
