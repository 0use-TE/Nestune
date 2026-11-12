import { AppProvider } from '@/lib/app';
import { SocialProvider } from '@/lib/social';
import { Shell } from '@/components/Shell';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppProvider><SocialProvider><Shell>{children}</Shell></SocialProvider></AppProvider>;
}
