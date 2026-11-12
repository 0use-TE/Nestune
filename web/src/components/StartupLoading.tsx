export function StartupLoading({ fullscreen = false }: { fullscreen?: boolean }) {
  return (
    <div className={fullscreen ? 'app-startup' : 'home-startup'} role="status" aria-label={fullscreen ? '正在打开 Nestune' : '正在加载首页'}>
      {fullscreen && <div className="startup-brand" aria-hidden="true"><span className="logo" /><span>Nestune</span></div>}
      <div className="startup-wave" aria-hidden="true"><i /><i /><i /><i /></div>
    </div>
  );
}
