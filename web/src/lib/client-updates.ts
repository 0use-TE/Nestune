/** Match the native executable architecture; browser downloads keep the x64 default. */
export function clientUpdatesUrl(host: { NestuneDesktop?: { architecture?: string } } = typeof window === 'undefined' ? {} : window as Window & { NestuneDesktop?: { architecture?: string } }): string {
  return ['aarch64', 'arm64'].includes(host.NestuneDesktop?.architecture || '') ? '/api/client-updates?windows_arch=arm64' : '/api/client-updates';
}
