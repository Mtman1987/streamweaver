import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export default async function AppHome() {
  const cookieStore = await cookies();
  const session = cookieStore.get('streamweaver-session');

  if (!session?.value) {
    redirect('/login');
  }

  try {
    const parsed = JSON.parse(session.value);
    if (!parsed.id) redirect('/login');
  } catch {
    redirect('/login');
  }

  redirect('/dashboard');
}
