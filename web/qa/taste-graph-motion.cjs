const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const base = process.env.NESTUNE_QA_BASE || 'http://localhost:3100';
const username = process.env.NESTUNE_QA_USER;
const password = process.env.NESTUNE_QA_PASSWORD;

// Run against a local preview with a populated recommendation map.
async function check(browser, { full, touch }) {
  const context = await browser.newContext({
    viewport: touch ? { width: 390, height: 844 } : { width: 1010, height: 965 },
    hasTouch: touch, isMobile: touch, reducedMotion: 'reduce',
  });
  try {
    const login = await context.request.post(base + '/api/auth/login', { data: { username, password } });
    assert.equal(login.status(), 200, 'Set NESTUNE_QA_USER and NESTUNE_QA_PASSWORD to a local test account');
    const { user } = await login.json();
    const {version} = await (await context.request.get(base + '/api/version')).json();
    await context.addInitScript(({ full, userId, version }) => {
      if (!full) localStorage.setItem('nt-interface-motion', 'system');
      localStorage.setItem('nt-install-intro-v1', 'seen');
      localStorage.setItem('nt-announcement-' + version + '-' + userId, 'seen');
      for (const topic of ['atlas','player','queue','social','songs','library','search']) {
        localStorage.setItem('nt-guide:v1:' + userId + ':' + topic, 'done');
      }
    }, { full, userId: user.id, version });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base);
    const open = page.getByRole('button', { name: '下拉探索音乐星图' });
    const graph = page.getByRole('group', { name: '音乐星图', exact: true });
    await open.click();
    await graph.locator('[data-kind=center]').first().waitFor();
    await page.waitForTimeout(850);
    const box = await graph.boundingBox();
    const point = { x: Math.round(box.x + 20), y: Math.round(box.y + 38) };
    const offsets = () => graph.locator('[data-kind=center]').evaluateAll(nodes => nodes.map(node => {
      const r = node.getBoundingClientRect();
      return { x: r.x, y: r.y };
    }));
    const before = await offsets();
    await page.waitForTimeout(720);
    const after = await offsets();
    const delta = after.map((a,i) => ({x:a.x-before[i].x,y:a.y-before[i].y}));
    const spread = Math.max(...delta.map(d => Math.hypot(d.x-delta[0].x,d.y-delta[0].y)));
    assert.ok(full ? spread > 2 : spread < .1, 'independent cluster displacement: ' + spread);
    async function checkRays(x, y) {
      const rays = await graph.evaluate(async frame => {
        await new Promise(requestAnimationFrame);
        const group = frame.querySelector('[data-pointer-links]');
        if (!group.getClientRects().length || getComputedStyle(group).display === 'none') return [];
        const centers = [...frame.querySelectorAll('[data-node]')].map(node => {
          const r = node.getBoundingClientRect();
          return { x:r.x+r.width/2, y:r.y+r.height/2 };
        });
        return [...group.querySelectorAll('line')].map(line => {
          const m = line.getScreenCTM();
          const a = new DOMPoint(line.x1.baseVal.value,line.y1.baseVal.value).matrixTransform(m);
          const b = new DOMPoint(line.x2.baseVal.value,line.y2.baseVal.value).matrixTransform(m);
          return {x:a.x,y:a.y,length:Math.hypot(a.x-b.x,a.y-b.y),
            error:Math.min(...centers.map(c=>Math.hypot(c.x-b.x,c.y-b.y)))};
        });
      });
      assert.equal(rays.length,4,'four visible rays');
      for(const ray of rays) {
        assert.ok(Math.hypot(ray.x-x,ray.y-y)<2,'line starts at the physical pointer');
        assert.ok(ray.error<2 && ray.length>1,'line ends at a moving node');
      }
    }
    if (touch) {
      const session = await context.newCDPSession(page);
      const send = (type, x, y) => session.send('Input.dispatchTouchEvent', {
        type, touchPoints:type==='touchEnd'?[]:[{x,y,id:1}],
      });
      await send('touchStart',point.x,point.y);
      await checkRays(point.x,point.y);
      await send('touchMove',point.x+45,point.y+25);
      await checkRays(point.x+45,point.y+25);
      await send('touchEnd');
      assert.equal(await graph.locator('[data-pointer-links]').evaluate(el=>getComputedStyle(el).display),'none');
    } else {
      const hub = await graph.locator('[data-kind=center]').first().boundingBox();
      const cx = Math.round(hub.x + hub.width/2), cy = Math.round(hub.y + hub.height/2 - 40);
      await page.mouse.move(cx-85,cy);
      await page.waitForTimeout(360);
      const left = await offsets();
      await page.mouse.move(cx+85,cy);
      await page.waitForTimeout(360);
      const right = await offsets();
      const pulled = right[0].x-left[0].x;
      assert.ok(full ? pulled>18 : Math.abs(pulled)<1, 'hub follows the pointer: '+pulled);
      await page.mouse.move(point.x,point.y);
      await checkRays(point.x,point.y);
      await page.mouse.down();
      await page.mouse.move(point.x+48,point.y+24,{steps:6});
      await checkRays(point.x+48,point.y+24);
      await page.mouse.up();
      // Shrinking around the centre leaves visible frame space beyond the SVG's own viewport.
      const middle = { x: box.x + box.width/2, y: box.y + box.height/2 };
      await page.mouse.move(middle.x,middle.y);
      for (let i=0; i<3; i++) await graph.press('-');
      await page.waitForTimeout(550);
      const edge = { x: Math.round(box.x + box.width - 20), y: Math.round(middle.y) };
      await page.mouse.move(edge.x,edge.y);
      await checkRays(edge.x,edge.y);
      const ink = await graph.evaluate(frame => {
        const group = frame.querySelector('[data-pointer-links]');
        const svg = group.ownerSVGElement;
        const line = group.querySelector('line');
        const screen = (x,y) => new DOMPoint(x,y).matrixTransform(line.getScreenCTM());
        const a = screen(line.x1.baseVal.value,line.y1.baseVal.value);
        const b = screen(line.x2.baseVal.value,line.y2.baseVal.value);
        const length = Math.hypot(b.x-a.x,b.y-a.y);
        const x = a.x + (b.x-a.x)*12/length, y = a.y + (b.y-a.y)*12/length;
        // Hit-test the painted stroke. SVG geometry alone also passes when the stroke is clipped.
        line.style.pointerEvents = 'stroke';
        try { return { outsideWorld: x > svg.getBoundingClientRect().right, drawn: document.elementsFromPoint(x,y).includes(line) }; }
        finally { line.style.removeProperty('pointer-events'); }
      });
      assert.deepEqual(ink,{outsideWorld:true,drawn:true});
      await page.mouse.move(middle.x,middle.y);
      await graph.press('Home');
      await page.waitForTimeout(550);
      await page.mouse.move(point.x+48,point.y+24);
      await page.waitForTimeout(140);
      await checkRays(point.x+48,point.y+24);
      // A Playwright locator waits for a stationary target before it moves the mouse.
      // Aim at a visible title the way a person does on the animated layout.
      const hit = await graph.evaluate(frame => {
        for (const node of frame.querySelectorAll('[data-kind=song]')) {
          const r = node.getBoundingClientRect(), x = Math.round(r.x+r.width/2), y = Math.round(r.y+r.height/2);
          if (document.elementFromPoint(x,y)?.closest('[data-node]') === node) return { x, y, id: node.dataset.node };
        }
        throw Error('No visible song title');
      });
      await page.mouse.move(hit.x,hit.y);
      await page.getByRole('region',{name:'作品预览'}).waitFor();
      await checkRays(hit.x,hit.y);
      assert.equal(await graph.locator('[data-dwell]').getAttribute('data-node'),hit.id);
      await page.mouse.click(hit.x,hit.y);
      await page.getByRole('region',{name:'星图详情'}).waitFor();
      await page.keyboard.press('Escape');
    }
    await page.getByRole('button',{name:'收起音乐星图'}).click();
    await open.click();
    await page.waitForTimeout(800);
    if (!touch) { await page.mouse.move(point.x,point.y); await checkRays(point.x,point.y); }
    const navigation = page.locator(touch ? '#tabbar' : '.primary-nav');
    await navigation.getByRole('link',{name:'音乐库',exact:true}).click();
    await navigation.getByRole('link',{name:'首页',exact:true}).click();
    await open.click();
    await graph.locator('[data-kind=center]').first().waitFor();
    await page.waitForTimeout(850);
    if (!touch) { await page.mouse.move(point.x+40,point.y); await checkRays(point.x+40,point.y); }
    const camera = graph.locator('[data-fly]');
    const zoom = () => camera.evaluate(el => new DOMMatrixReadOnly(getComputedStyle(el).transform).a);
    const initialZoom = await zoom();
    if (touch) {
      const cdp = await context.newCDPSession(page);
      const swipe = async (x,y,dy) => {
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
        for (let i=1;i<=6;i++) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y+dy*i/6}]});
        await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      };
      await swipe(point.x,point.y+210,-120);
      await open.waitFor();
      await page.locator('main').evaluate(el=>el.scrollTo(0,0));
      await page.waitForTimeout(800);
      const heading=await page.locator('h1').first().boundingBox();
      await swipe(heading.x+10,heading.y+10,135);
    } else {
      await page.mouse.wheel(0,144);
      await open.waitFor();
      assert.ok(await page.locator('main').evaluate(el=>el.scrollTop)>0,'wheel scrolls home');
      await page.mouse.wheel(0,-1200);
      await page.waitForFunction(()=>document.querySelector('main').scrollTop<=1);
      await page.mouse.wheel(0,-48);
    }
    await page.getByRole('button',{name:'收起音乐星图'}).waitFor();
    assert.equal(await zoom(),initialZoom,'vertical scrolling preserves graph zoom');
    assert.deepEqual(errors,[]);
    console.log({full,touch,relativeDriftPx:+spread.toFixed(1)});
  } finally { await context.close(); }
}
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH});
  try {
    for(const mode of [{full:true,touch:false},{full:false,touch:false},{full:true,touch:true}]) await check(browser,mode);
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
