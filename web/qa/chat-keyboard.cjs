const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
const base=process.env.NESTUNE_QA_BASE||'http://localhost:3100';
const output=require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(),'nestune-chat-qa-'));
const playlist={id:7,name:'夜晚的音乐',description:'',cover:null,trackCount:2,isPublic:false,updatedAt:1};
const peer={id:2,username:'friend',name:'测试好友',avatar:null,online:true,track:null,friendship:'friend'};
const me={id:1,username:'qa',displayName:'测试用户',bio:'',email:'',avatar:null,status:'active',maxQuality:'exhigh',createdAt:1,lastLoginAt:1,profilePublic:true};
(async()=>{const browser=await chromium.launch((process.env.PLAYWRIGHT_EXECUTABLE_PATH ? {executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH} : {}));
try{for(const withPlayer of [false,true])for(const width of [390,448,768]){
 const c=await browser.newContext({viewport:{width,height:844},isMobile:width<860,hasTouch:width<860,screen:{width,height:844}});const p=await c.newPage();p.setDefaultNavigationTimeout(90000);p.setDefaultTimeout(60000);const errors=[],requests=[];p.on('pageerror',e=>errors.push(e.message));
 await p.addInitScript(()=>{localStorage.setItem('nt-install-intro-v1','seen');const viewport=new EventTarget();Object.assign(viewport,{height:screen.height,offsetTop:0});Object.defineProperty(window,'visualViewport',{value:viewport});Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.copied=text}}});});
 await p.route('**/api/**',async r=>{const u=new URL(r.request().url()),path=u.pathname;let data={};
 if(path==='/api/me')data={user:me,stats:{plays:0}};
 else if(path==='/api/me/favorites')data={songs:[],ids:[]};
 else if(path==='/api/me/playlists')data={playlists:[playlist]};
 else if(path==='/api/me/playlists/7'||path==='/api/shared-playlists/7'){if(r.request().method()==='PATCH'){requests.push('publish');playlist.isPublic=true;}data={playlist,songs:[],owner:{id:1,name:me.displayName}};}
 else if(path==='/api/me/queue')data={songs:withPlayer?[{id:'101',name:'Restored song',artists:[{id:'1',name:'Artist'}],album:{id:null,name:'Album'},cover:null,duration:180}]:[],index:withPlayer?0:-1,position:0};
 else if(path==='/api/client-updates')data={version:'1.0.0',android:null};
 else if(path==='/api/search/hot')data={keywords:[]};
 else if(path==='/api/search/suggest')data={keywords:Array.from({length:14},(_,i)=>'建议 '+i)};
 else if(path==='/api/social'){
  if(u.searchParams.get('scope')==='directory'){requests.push('directory');data={people:[{...peer,online:null}]};}
  else if(u.searchParams.has('peer'))data={messages:Array.from({length:40},(_,i)=>({id:i+1,senderId:i%2?1:2,text:'历史消息 '+i+' 用于测试键盘弹起后的聊天布局',sentAt:Date.now()})),peerReadThrough:0};
  else {const body=r.request().postDataJSON();requests.push(body);if(body.action==='sharePlaylist')data={message:{id:10,senderId:1,text:'分享歌单',sentAt:Date.now(),playlist}};
   else {data={people:body.known?.peopleVersion?undefined:[peer],peopleVersion:'a'.repeat(64),rooms:[],inbox:[],showOnline:true,serverTime:Date.now()};}}
 }
 await r.fulfill({json:data});});


 await p.goto(base+'/chat?peer=2',{waitUntil:'domcontentloaded'});const input=p.getByRole('textbox',{name:'消息',exact:true});await input.waitFor();await p.locator('.message-entry').last().waitFor();
 const check=async(label)=>{const result=await p.evaluate(()=>{const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height}};const list=document.querySelector('.social-messages');return {top:visualViewport.offsetTop,bottom:visualViewport.offsetTop+visualViewport.height,header:rect('.social-chat header'),composer:rect('.chat-composer'),nav:rect('#tabbar'),remaining:list.scrollHeight-list.scrollTop-list.clientHeight,barVisible:!!document.querySelector('#bar')&&getComputedStyle(document.querySelector('#bar')).display!=='none',scrollY}});assert.ok(result.header.top>=result.top-2,JSON.stringify({label,result}));assert.ok(result.composer.top>=result.header.bottom,JSON.stringify({label,result}));assert.ok(result.nav.top-result.composer.bottom>=0&&result.nav.top-result.composer.bottom<(result.barVisible?110:35),JSON.stringify({label,result}));assert.ok(Math.abs(result.nav.bottom-result.bottom)<2,JSON.stringify({label,result}));return result};
 await check('initial');
 for(const top of [0,120,260]){
  await input.focus();await p.evaluate(top=>{visualViewport.height=524;visualViewport.offsetTop=top;visualViewport.dispatchEvent(new Event('resize'));visualViewport.dispatchEvent(new Event('scroll'))},top);await p.waitForTimeout(120);const r=await check('panned '+top);assert.ok(r.remaining<5,'Latest message hidden: '+JSON.stringify(r));
 }
 await p.locator('.social-messages').evaluate(n=>{n.scrollTop=100;n.dispatchEvent(new Event('scroll'))});
 await p.evaluate(()=>{visualViewport.height=400;visualViewport.offsetTop=150;visualViewport.dispatchEvent(new Event('resize'))});await p.waitForTimeout(120);await check('reading earlier messages');assert.ok(Math.abs(await p.locator('.social-messages').evaluate(n=>n.scrollTop)-100)<3);
 await p.locator('.social-messages').evaluate(n=>{n.scrollTop=n.scrollHeight;n.dispatchEvent(new Event('scroll'))});
 await p.evaluate(()=>{visualViewport.height=344;visualViewport.offsetTop=200;visualViewport.dispatchEvent(new Event('resize'))});await p.waitForTimeout(120);const last=await check('short viewport');assert.ok(last.remaining<5,'Latest message hidden after resize '+JSON.stringify(last));
 await p.screenshot({path:`${output}/chat-keyboard-${width}-${withPlayer}.png`});
 await input.blur();await p.evaluate(()=>{visualViewport.height=844;visualViewport.offsetTop=0;visualViewport.dispatchEvent(new Event('resize'))});await p.waitForTimeout(120);await check('closed');
 await p.setViewportSize({width,height:524});await input.focus();await p.evaluate(()=>{visualViewport.height=524;visualViewport.offsetTop=0;visualViewport.dispatchEvent(new Event('resize'))});await p.waitForTimeout(120);await check('native resized viewport');
 await input.blur();await p.setViewportSize({width,height:844});await p.evaluate(()=>{visualViewport.height=844;visualViewport.offsetTop=0;visualViewport.dispatchEvent(new Event('resize'))});await p.waitForTimeout(120);await check('native keyboard closed');
 await p.locator('#tabbar a[href="/search"]').click();await p.waitForURL('**/search');assert.equal(await p.locator('#app').evaluate(n=>n.getBoundingClientRect().top),0);assert.deepEqual(errors,[]);console.log(width+'px, mini-player='+withPlayer+': panned/resized keyboards, visible header, composer gap, latest message, earlier reading position, close and navigation PASS');await c.close();

}}finally{await browser.close()}})().catch(e=>{console.error(e);process.exit(1)});
