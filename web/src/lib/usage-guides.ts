export const GUIDE_TOPICS = ['atlas', 'player', 'queue', 'social', 'songs', 'library', 'search'] as const;
export type GuideTopic = typeof GUIDE_TOPICS[number];
export type GuideStep = { target: string; title: string; text: string };
export const GUIDE_LABELS: Record<GuideTopic, string> = { atlas: '音乐星图', player: '播放栏', queue: '播放列表', social: '一起听', songs: '歌曲列表', library: '音乐库与歌单', search: '搜索' };
export const GUIDE_STEPS: Record<GuideTopic, GuideStep[]> = {
  atlas: [
    { target: '[data-atlas-handle]', title: '从首页拉出你的音乐星图', text: '在首页顶部向下拉，或点搜索框下方的短横线，就能展开星图。再点一次可以收起。' },
    { target: '[data-atlas-handle]', title: '沿着喜欢的歌手和曲风找歌', text: '点歌名看推荐理由，拖动空白处平移，用滚轮或双指缩放。点中央的「为你推荐」可以播放整份歌单，优先听到你在 Nestune 还没播过的歌。' },
  ],
  player: [
    { target: '#bar .info', title: '展开播放器', text: '点击封面或歌名，或向上拖动播放栏的短横线，查看完整播放器和歌词。从播放器顶部向下拖动把手可以收起。长按歌曲还可以拖到画布或一起听。' },
    { target: '#bar .ctl', title: '控制播放', text: '这里可以播放、暂停和切歌。播放模式按钮可以切换顺序、随机或循环；进度条可以跳到想听的位置。' },
    { target: '#bar .right', title: '歌词、音量和播放列表', text: '点击歌词图标开关歌词，点击列表图标管理接下来播放的歌。小屏幕上，更多控制可在完整播放器里找到。' },
  ],
  queue: [
    { target: '.queue-locate', title: '一键找到正在听的歌', text: '列表翻远了也没关系，点击定位按钮就会回到当前歌曲。只移动列表，不切歌。' },
    { target: '.qlist', title: '管理接下来的音乐', text: '点击一首歌立即播放，右边的 × 只把它移出播放列表。歌单添加到队列时会接在末尾；清空会清空整个队列。' },
  ],
  social: [
    { target: '.together-tabs', title: '先加好友，再一起听', text: '好友页用于聊天；在“所有用户”里可以添加好友，等待对方接受。' },
    { target: '.chat-share,.together-tabs', title: '把歌单里的音乐发给好友', text: '打开聊天，点击音符按钮，在“我的歌单”选一首歌。可以直接点发送，也可以拖到好友头像或聊天区域；手机上先长按。' },
    { target: '.together-tabs', title: '在域里一起听', text: '在第三个分页“域”创建域并邀请好友。成员可以聊天、分享歌曲、一起维护域歌单，也可以随时加入同步播放。' },
  ],
  songs: [
    { target: '.song-list-locate', title: '定位当前歌曲', text: '点击定位可以找到本列表中正在听的歌。如果它不在这份列表里，打开底部播放列表即可找到。' },
    { target: '.song-list .tr .more,.song-list', title: '更多歌曲操作', text: '点击歌曲开始播放，爱心用于收藏；“更多”里可以下一首播放、加入队列或添加到自己的歌单。' },
  ],
  library: [
    { target: '.library-heading', title: '你的音乐都在这里', text: '收藏、历史、本地音乐和上传歌曲分开显示。歌单可以整份加入播放列表，也可以打开后挑选单曲。' },
    { target: '.library-heading', title: '收藏、入队和分享', text: '收藏方便以后再找，加入播放列表决定接下来听什么；想发给好友，可以到一起听的音符按钮里选择“我的歌单”。画布则可以放下音乐和便签，原有箭头会介绍拖动方法。' },
  ],
  search: [
    { target: '.search', title: '歌名加歌手，找得更准', text: '可以同时输入歌名和歌手，也可以加“现场”“伴奏”等版本关键词。网易云与 QQ 音乐的歌曲会一起按相关度排序。' },
    { target: '.chips', title: '不只可以搜歌曲', text: '切换分类可以查找歌手、专辑或歌单。歌曲旁的来源图标说明收录平台，播放器里还可以选择播放音源。' },
  ],
};
export const guideStorageKey = (userId: number, topic: GuideTopic) => `nt-guide:v1:${userId}:${topic}`;
export function pageGuide(path: string, queueOpen: boolean, hasSong: boolean): GuideTopic | null {
  if (queueOpen) return 'queue';
  if (path === '/social') return 'social';
  if (path === '/search') return 'search';
  if (path === '/library' || path === '/my') return 'library';
  if (/^\/(my|album|artist)\//.test(path)) return 'songs';
  return path !== '/square' && hasSong ? 'player' : null;
}
