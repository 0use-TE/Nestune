export type LyricsEnvironment = { desktop: boolean; android: boolean; tauri: boolean; embedded: boolean; secure: boolean; pictureInPicture: boolean; userAgent: string };
export function lyricsTransport(environment: LyricsEnvironment): 'native' | 'upgrade' | 'pip' | 'unsupported' {
  if (environment.desktop || environment.android || environment.tauri) return 'native';
  if (environment.embedded || /NestuneDesktop\//.test(environment.userAgent)) return 'upgrade';
  return environment.secure && environment.pictureInPicture ? 'pip' : 'unsupported';
}
export function lyricsOpenFailure(nativeClient: boolean) {
  return nativeClient ? '当前 Windows 客户端不支持系统歌词，请下载安装新版；应用内歌词仍可使用。'
    : '当前浏览器无法弹出歌词窗口，请使用新版客户端；应用内歌词仍可使用。';
}
