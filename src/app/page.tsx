import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export default async function Home() {
  const cookieStore = await cookies();
  const session = cookieStore.get('streamweaver-session');

  if (session?.value) {
    try {
      const parsed = JSON.parse(session.value);
      if (parsed.id) {
        redirect('/dashboard');
      }
    } catch {
      // Invalid session cookie — fall through to login
    }
  }

  redirect('/login');
}