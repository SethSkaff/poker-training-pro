/** Real Electron layout/gesture regression. Uses an isolated profile and native
 * CDP input. --dev exercises Vite on port 5173; default verifies the package. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PackagedSession, delay } from "./lib/packaged-cdp-session.mjs";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "work/fixed-frame");
const dev = process.argv.includes("--dev");
const viewports = [[1920, 1080], [1280, 720], [2560, 1440], [3840, 2160], [3440, 1440], [1000, 1200], [600, 900]];
const session = await PackagedSession.launch({
  appPath: resolve(root, dev ? "node_modules/electron/dist/electron.exe" : "outputs/current/win-unpacked/Poker Training Pro.exe"),
  extraArguments: dev ? [root] : [],
  profilePrefix: "poker-fixed-frame-",
  timeoutMs: 180_000,
});
const report = { viewports: [], interactions: [], sixSeats: [] };
await mkdir(output, { recursive: true });

async function viewport(width, height) {
  await session.cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await delay(180);
}

async function mouse(selector, fraction = 0.5) {
  const point = await session.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) throw new Error('Missing input target: ' + ${JSON.stringify(selector)});
    const r = element.getBoundingClientRect();
    const x = r.left + r.width * ${fraction}, y = r.top + r.height / 2;
    const hit = document.elementFromPoint(x, y);
    if (!hit || !(hit === element || element.contains(hit))) throw new Error('Covered input: ' + ${JSON.stringify(selector)} + ' by ' + hit?.outerHTML.slice(0, 150));
    return {x, y};
  })()`);
  await session.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
  await session.cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
  await session.cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
  await delay(100);
}

async function geometry() {
  return session.evaluate(`(() => {
    const frame = document.querySelector('.desktop-game-frame');
    const f = frame.getBoundingClientRect(), scale = f.width / 1920;
    return {
      frame: {left:f.left, top:f.top, width:f.width, height:f.height, logicalWidth:frame.offsetWidth, logicalHeight:frame.offsetHeight},
      elements: [...frame.querySelectorAll('*')].filter(e => e instanceof HTMLElement && !e.closest('.visually-hidden, .live-event-announcer')).flatMap(e => {
        const r=e.getBoundingClientRect(), s=getComputedStyle(e);
        if(!r.width || !r.height || s.display === 'none') return [];
        return [{tag:e.tagName, class:e.className, x:(r.x-f.x)/scale, y:(r.y-f.y)/scale, w:r.width/scale, h:r.height/scale, font:s.fontSize, transform:s.transform}];
      })
    };
  })()`);
}

function compare(expected, actual, label) {
  assert.equal(actual.elements.length, expected.elements.length, `${label}: element count`);
  let maxError = 0;
  for (let i=0;i<expected.elements.length;i++) {
    const a=actual.elements[i], e=expected.elements[i];
    assert.equal(a.class, e.class, `${label}: element ${i}`);
    for (const key of ["x","y","w","h"]) {
      const error = Math.abs(a[key]-e[key]);
      maxError = Math.max(maxError,error);
      assert.ok(error < 0.15, `${label}: ${e.class} ${key}: ${e[key]} -> ${a[key]}`);
    }
    assert.equal(a.font,e.font,`${label}: ${e.class} font`);
    assert.equal(a.transform,e.transform,`${label}: ${e.class} rotation/transform`);
  }
  return maxError;
}

try {
  console.log("Opening isolated Training table");
  await session.reachHome();
  console.log("Home ready");
  await session.clickSelector('button[aria-label="Play"]');
  await session.clickIfPresent("#play-chip-ack-title ~ .startup-gate__actions button");
  await session.clickSelector(".table-view-choices > button:first-of-type");
  console.log("2D selected");
  // 2D now enters the Normal tour lobby directly; its back button exposes the
  // existing mode chooser without changing the selected 2D renderer.
  await session.waitFor(".event-board__start");
  await session.clickSelector(".night-back");
  await session.clickSelector(".mode-stage__choice--training");
  console.log("Training selected", await session.describeScreen());
  await session.waitFor(".poker-table");
  await session.evaluate("window.desktop?.setFullscreen(false)");
  await session.clickIfPresent(".context-coach button");
  await session.evaluate("document.fonts.ready.then(() => true)");
  await delay(1200);
  await viewport(1920,1080);
  await session.evaluate("document.getAnimations().forEach(a => a.finish())").catch(() => {});
  const baseline = await geometry();
  for (const [width,height] of viewports) {
    await viewport(width,height);
    const actual=await geometry(), scale=Math.min(width/1920,height/1080);
    assert.equal(actual.frame.logicalWidth,1920);
    assert.equal(actual.frame.logicalHeight,1080);
    assert.ok(Math.abs(actual.frame.left-(width-1920*scale)/2)<0.05);
    assert.ok(Math.abs(actual.frame.top-(height-1080*scale)/2)<0.05);
    assert.ok(Math.abs(actual.frame.height-1080*scale)<0.05);
    report.viewports.push({width,height, elements:actual.elements.length, maxLogicalError:compare(baseline,actual,`${width}x${height}`)});
    const shot=await session.cdp.send("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});
    await writeFile(resolve(output,`${width}x${height}.png`),Buffer.from(shot.data,"base64"));

    // All of these go through Chromium hit testing, not element.click().
    const muted=await session.evaluate("document.querySelector('.table-tools button:last-child').getAttribute('aria-pressed')");
    await mouse(".table-tools button:last-child");
    assert.notEqual(await session.evaluate("document.querySelector('.table-tools button:last-child').getAttribute('aria-pressed')"),muted);
    await mouse(".table-tools button:last-child");
    await mouse(".hero-hole-cards-visual");
    assert.equal(await session.evaluate("document.querySelector('.hero-hole-cards-visual').classList.contains('is-peeked')"),true);
    await mouse(".hero-hole-cards-visual");
    await mouse(".action-button--raise");
    await session.waitFor(".bet-composer");
    const before=await session.evaluate("document.querySelector('.bet-slider-row input[type=range]').value");
    await mouse(".bet-slider-row input[type=range]", report.interactions.length % 2 ? 0.2 : 0.8);
    assert.notEqual(await session.evaluate("document.querySelector('.bet-slider-row input[type=range]').value"),before);
    await mouse('.bet-composer button[aria-label="Close raise controls"]');
    await mouse('.table-tools button[aria-label="Pause table"]');
    await session.waitFor(".pause-menu");
    await mouse(".pause-menu .primary-button");
    report.interactions.push({width,height,audio:true,peek:true,raiseRange:true,pauseResume:true});
  }
  await session.cdp.send("Emulation.setDeviceMetricsOverride", { width:1280, height:720, deviceScaleFactor:2, mobile:false });
  await delay(180);
  report.highDpiLogicalError=compare(baseline,await geometry(),"1280x720 at DPR 2");
  // Interface-size preferences must not become a second game-camera scale.
  await viewport(1920,1080);
  for(const value of ["compact","large","extra-large","standard"]) {
    await session.evaluate(`document.documentElement.dataset.interfaceScale=${JSON.stringify(value)}`);
    await delay(120);
    compare(baseline,await geometry(),`interface ${value}`);
  }
  await mouse(".table-exit");
  await session.clickSelector('button[aria-label="Play"]');
  await session.clickSelector(".table-view-choices > button:first-of-type");
  await session.clickSelector(".event-board__start");
  await session.evaluate("window.desktop?.setFullscreen(false)");
  await session.waitFor(".poker-table");
  await session.clickIfPresent(".context-coach button");
  assert.ok(await session.poll("document.querySelectorAll('.player-seat').length === 6 && document.querySelector('.action-button--raise:not(:disabled)') !== null"), "six-player hero decision");
  await delay(400);
  await viewport(1920,1080);
  const sixShot=await session.cdp.send("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});
  await writeFile(resolve(output,"six-seat-1920x1080.png"),Buffer.from(sixShot.data,"base64"));
  // The first hero decision is stable until input. Pause additionally freezes
  // presentation clocks while checking all six stations and the modal overlay.
  await mouse('.table-tools button[aria-label="Pause table"]');
  await session.waitFor(".pause-menu");
  await delay(250);
  await viewport(1920,1080);
  const sixBaseline = await geometry();
  for (const [width,height] of viewports) {
    await viewport(width,height);
    const actual = await geometry();
    report.sixSeats.push({width,height,elements:actual.elements.length,maxLogicalError:compare(sixBaseline,actual,`six seats ${width}x${height}`)});
  }
  await mouse(".pause-menu .primary-button");
  await mouse(".table-speed-control input",0.9);
  assert.equal(await session.evaluate("document.querySelector('.table-speed-control input').value"),"3");
  // A 125-unit upward gesture must fold even at the smallest camera scale.
  const cardPoint=await session.evaluate(`(() => {
    const r=document.querySelector('.hero-hole-cards-visual').getBoundingClientRect();
    return {x:r.x+r.width/2,y:r.y+r.height/2};
  })()`);
  await session.cdp.send("Input.dispatchMouseEvent",{type:"mousePressed",...cardPoint,button:"left",clickCount:1});
  await session.cdp.send("Input.dispatchMouseEvent",{type:"mouseMoved",x:cardPoint.x,y:cardPoint.y-125*600/1920,button:"left",buttons:1});
  await delay(60);
  await session.cdp.send("Input.dispatchMouseEvent",{type:"mouseReleased",x:cardPoint.x,y:cardPoint.y-125*600/1920,button:"left",clickCount:1});
  assert.ok(await session.poll("document.querySelector('.hero-hole-cards-visual.is-folded') !== null",{deadlineAt:Date.now()+3000}),"scaled drag folds hero cards");
  report.scaledFoldGesture=true;
  report.ok=true;
} finally {
  await writeFile(resolve(output,"audit.json"),JSON.stringify(report,null,2));
  await session.dispose();
}
console.log(JSON.stringify(report,null,2));
