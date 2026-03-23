import { redirect } from 'next/navigation';

export default function DeprecatedGoogleCallbackRoute() {
  redirect('/login');
}
