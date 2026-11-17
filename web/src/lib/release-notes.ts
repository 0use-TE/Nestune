import { VERSION } from './version';

export type ReleaseNote = { version: string; date: string; title: string; summary: string; sections: { title: string; paragraphs: string[] }[] };
export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: VERSION,
    date: '2026 年 11 月 17 日',
    title: '来源图标恢复，悬浮歌词锁定修复',
    summary: '恢复网易云与 QQ 音乐图标；锁定歌词位置后，解锁、背景和关闭仍可使用。',
    sections: [
      { title: '来源图标回来了', paragraphs: ['歌曲列表和播放器恢复网易云、QQ 音乐小图标。双音源歌曲同时显示两个标识，切源菜单继续显示平台名称。'] },
      { title: '手机和电脑，都能解锁', paragraphs: ['修复安卓锁定后无法触摸和解锁的问题，锁定时保留解锁、背景和关闭按钮。修复电脑长句流光歌词遮挡工具栏的问题，锁定后禁止拖动，并增加原生位置保护。'] },
      { title: '更新方式', paragraphs: ['来源图标刷新页面即可恢复。系统悬浮歌词修复需要覆盖安装 1.2.3 客户端后重启，安卓继续沿用原签名，保留应用数据。主应用中也保留解锁和关闭入口。'] },
    ],
  },
  {
    version: '1.2.2',
    date: '2026 年 11 月 17 日',
    title: '长按排序，桌面托盘随时控制',
    summary: '歌单长按交换排序，统一下拉框；桌面新增托盘，Windows 和 Linux 支持 ARM64。',
    sections: [
      { title: '长按卡片，即可排序', paragraphs: ['音乐库不再显示排序图标。按住卡片后拖动，经过其他卡片时直接交换位置，并显示过渡动画；松开后保存顺序。手机上仍可正常滑动浏览。'] },
      { title: '下拉选择，风格统一', paragraphs: ['歌单选择和管理页面的下拉框统一适配深浅主题，支持键盘选择，弹层会根据屏幕空间调整位置。'] },
      { title: 'Windows、Linux、macOS 系统托盘', paragraphs: ['关闭主窗口后继续播放，从托盘打开窗口、播放或暂停、切换歌曲、开关桌面歌词，也可以选择退出应用。需要安装 1.2.2 桌面客户端；Linux 需要桌面环境提供托盘区域。'] },
      { title: '桌面 ARM64 与清晰的下载选项', paragraphs: ['Windows x64 和 ARM64 均提供安装版和便携版。安装版包含快捷方式和卸载程序，便携版下载后直接运行；ARM64 客户端的更新链接会保持对应架构。', 'Linux 新增 ARM64 的 DEB 和 AppImage，支持 64 位 ARM 桌面系统。macOS Universal 包同时支持 Apple 芯片和 Intel。'] },
    ],
  },
  {
    version: '1.2.1',
    date: '2026 年 11 月 17 日',
    title: '逐字歌词与双音源',
    summary: '蓝黄流光逐字扫色，QQ 音乐与网易云搜索和切源。',
    sections: [
      { title: '蓝黄流光，跟着歌词走', paragraphs: ['播放器和应用内悬浮歌词新增逐字扫色。每句起始颜色、方向和流速会变化，暂停时停住，拖动进度后立即同步。有逐字时间的音源按实际演唱位置显示；只有整句时间时使用平滑估算。'] },
      { title: 'QQ 音乐与网易云，一起听', paragraphs: ['同一录音在搜索中合并展示，现场、翻唱、伴奏和重制等版本各自保留。播放器支持手动切源，设置中可选择优先平台；切源保留进度，歌词跟随当前来源。是否可播放取决于音源账号的实际权限。'] },
    ],
  },
];

export const LATEST_RELEASE = RELEASE_NOTES[0];
