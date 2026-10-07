import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

// Raw CDP keeps actual Android visibility/lifecycle behavior. Touch targets use
// adb taps/swipes; keyboard controls use CDP input, never arena internals.
export async function nativeProgressionFixture({artifactDir,serverOrigin}={}) {
  const serial=process.env.ANDROID_TEST_SERIAL,avd=process.env.ANDROID_TEST_AVD;
  assert.match(serial||'',/^emulator-\d+$/,'Explicit owned emulator serial required');assert.ok(avd,'Explicit owned AVD name required');
  const sdk=process.env.ANDROID_SDK_ROOT||process.env.ANDROID_HOME||`${process.env.HOME}/Android/Sdk`,run=promisify(execFile);
  const command=(...args)=>run(`${sdk}/platform-tools/adb`,['-s',serial,...args],{timeout:120000,maxBuffer:8*1024*1024});
  const shell=(...args)=>command('shell',...args);
  assert.equal((await command('emu','avd','name')).stdout.trim().split('\n')[0].trim(),avd,'Only the named disposable AVD may be changed');
  const errors=[],packets=[];let socket,port,sequence=0;const pending=new Map();
  const send=(method,params={})=>new Promise((accept,reject)=>{
    const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error(`${method} timeout`));},15000);
    pending.set(id,{accept,reject,timer});socket.send(JSON.stringify({id,method,params}));
  });
  const evaluate=async(fn,arg)=>{
    const expression=typeof fn==='function'?`(${fn.toString()})(${JSON.stringify(arg)??'undefined'})`:fn;
    const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});
    if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;
  };
  async function until(fn,label,timeout=15000) {
    const deadline=Date.now()+timeout;while(Date.now()<deadline){if(await fn())return;await delay(80);}throw Error(`Native wait: ${label}`);
  }
  async function detach() {
    socket?.close();socket=null;
    for(const item of pending.values()){clearTimeout(item.timer);item.reject(Error('CDP closed'));}pending.clear();
    if(port){await command('forward','--remove',`tcp:${port}`);port=null;}
  }
  const viewport={width:1280,height:720};
  const visible=selector=>evaluate(selector=>{const e=document.querySelector(selector);return Boolean(e&&!e.hidden&&e.getBoundingClientRect().width&&e.getBoundingClientRect().height);},selector);
  const locate=selector=>({
    async click(){
      await until(()=>visible(selector),`visible touch target ${selector}`);
      const point=await evaluate(selector=>{const e=document.querySelector(selector);if(!e||e.disabled)throw Error(`Missing/disabled ${selector}`);e.scrollIntoView({block:'nearest',inline:'nearest'});const r=e.getBoundingClientRect();return {x:(r.x+r.width/2)*devicePixelRatio,y:(r.y+r.height/2)*devicePixelRatio};},selector);
      await shell('input','tap',String(Math.round(point.x)),String(Math.round(point.y)));
      await evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    },
    async fill(value){await evaluate(({selector,value})=>{const e=document.querySelector(selector);e.value=value;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));},{selector,value});},
    async selectOption(value){await evaluate(({selector,value})=>{const e=document.querySelector(selector),option=Array.from(e.options).find(o=>o.value===value);if(!option||option.disabled)throw Error(`Locked/missing option ${value}`);e.value=value;e.dispatchEvent(new Event('change',{bubbles:true}));},{selector,value});},
    async uncheck(){await evaluate(selector=>{const e=document.querySelector(selector);if(e.checked){e.checked=false;e.dispatchEvent(new Event('change',{bubbles:true}));}},selector);},
    getAttribute:name=>evaluate(({selector,name})=>document.querySelector(selector).getAttribute(name),{selector,name}),
    textContent:()=>evaluate(selector=>document.querySelector(selector).textContent,selector),
    isVisible:()=>visible(selector),
    evaluate:(fn,arg)=>evaluate(({selector,source,arg})=>(0,eval)(`(${source})`)(document.querySelector(selector),arg),{selector,source:fn.toString(),arg}),
  });
  let mouse={x:0,y:0},dragStart;
  const key=(type,code)=>send('Input.dispatchKeyEvent',{type,code,key:code.startsWith('Key')?code.slice(3).toLowerCase():code,windowsVirtualKeyCode:code.startsWith('Key')?code.charCodeAt(3):0});
  const page={
    evaluate,locator:locate,viewportSize:()=>viewport,waitForTimeout:delay,
    waitForSelector:selector=>until(()=>visible(selector),selector),
    waitForFunction:(fn,arg,options={})=>until(()=>evaluate(fn,arg),'function predicate',options.timeout||15000),
    keyboard:{down:code=>key('keyDown',code),up:code=>key('keyUp',code),async press(code){await key('keyDown',code);await delay(100);await key('keyUp',code);}},
    mouse:{async move(x,y){mouse={x,y};},async down(){dragStart={...mouse};},
      async up(){
        if(!dragStart)return;const start=dragStart;dragStart=null;
        const ratio=await evaluate(()=>devicePixelRatio);
        await shell('input','swipe',String(Math.round(start.x*ratio)),String(Math.round(start.y*ratio)),String(Math.round(mouse.x*ratio)),String(Math.round(mouse.y*ratio)),'300');
        await evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      }},
    async screenshot(options={}){
      // Android's WebView CDP capture omits the hardware-composited WebGL layer
      // and can misplace CSS overlays. Observe the real display, like our other
      // native smoke tests, rather than mistaking that capture for game output.
      const result=await run(`${sdk}/platform-tools/adb`,['-s',serial,'exec-out','screencap','-p'],{encoding:'buffer',timeout:15000,maxBuffer:8*1024*1024});
      const bytes=result.stdout;if(options.path)await writeFile(options.path,bytes);return bytes;
    },
  };
  async function attach() {
    await detach();await shell('settings','put','secure','immersive_mode_confirmations','confirmed');
    if(serverOrigin){
      assert.equal(new URL(serverOrigin).protocol,'https:','Native staging requires TLS');
      await shell('svc','wifi','enable');
      await until(async()=>{try{return /^PING .*\([0-9a-f:.]+\)/mi.test((await shell('ping','-c','1','-W','1',new URL(serverOrigin).hostname)).stdout);}catch(error){return /^PING .*\([0-9a-f:.]+\)/mi.test(error.stdout||'');}},'owned TLS staging DNS',30000);
    }else{await shell('svc','wifi','disable');await shell('svc','data','disable');}
    await shell('am','start','-W','-n','au.local.blockops/.MainActivity');
    const pid=(await shell('pidof','au.local.blockops')).stdout.trim();assert.match(pid,/^\d+$/);
    port=Number((await command('forward','tcp:0',`localabstract:webview_devtools_remote_${pid}`)).stdout.trim());assert.ok(port>0,'Unique dynamically allocated CDP forward');
    let target;await until(async()=>{try{const targets=await(await fetch(`http://127.0.0.1:${port}/json`)).json();target=targets.find(t=>t.url==='https://appassets.androidplatform.net/assets/index.html');return target;}catch{return false;}},'packaged HTTPS target');
    socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((accept,reject)=>{socket.onopen=accept;socket.onerror=reject;});
    socket.onmessage=event=>{const message=JSON.parse(event.data);if(message.id){const item=pending.get(message.id);if(item){pending.delete(message.id);clearTimeout(item.timer);message.error?item.reject(Error(JSON.stringify(message.error))):item.accept(message.result);}}
      else if(message.method==='Runtime.exceptionThrown')errors.push(JSON.stringify(message.params.exceptionDetails));
      else if(message.method==='Network.webSocketFrameReceived'){try{packets.push(JSON.parse(message.params.response.payloadData));}catch{}}
    };
    await send('Runtime.enable');await send('Page.enable');await send('Network.enable');await until(()=>evaluate(()=>document.body?.dataset.mode==='home'),'Home after native start');
    Object.assign(viewport,await evaluate(()=>({width:innerWidth,height:innerHeight})));
    await evaluate(()=>{
      if(window.__lootObservation)return;const native=requestAnimationFrame.bind(window);let previous;window.__lootObservation={seconds:0};
      window.requestAnimationFrame=callback=>native(now=>{if(previous!==now){if(previous!==undefined&&document.body?.dataset.mode==='playing')window.__lootObservation.seconds+=Math.min(.05,(now-previous)/1000);previous=now;}callback(now);});
    });
    return page;
  }
  return {
    attach,packets,
    async version(){const text=(await shell('dumpsys','package','au.local.blockops')).stdout;return {code:Number(/versionCode=(\d+)/.exec(text)?.[1]),name:/versionName=(\S+)/.exec(text)?.[1]};},
    async install(apk){await detach();await shell('am','force-stop','au.local.blockops');await command('install','-r',resolve(apk));},
    async relaunch(){await detach();await shell('am','force-stop','au.local.blockops');return attach();},
    async background(){await shell('input','keyevent','KEYCODE_HOME');await until(()=>evaluate(()=>document.hidden),'native background visibility');},
    async foreground(){await shell('am','start','-W','-n','au.local.blockops/.MainActivity');await until(()=>evaluate(()=>!document.hidden),'native foreground visibility');},
    clean(){assert.deepEqual(errors,[],'no native runtime exceptions');},
    async close(){await detach();await shell('am','force-stop','au.local.blockops');},
  };
}
