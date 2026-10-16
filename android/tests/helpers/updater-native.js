import assert from 'node:assert/strict';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile,appendFile} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

export function transferStopped(status,action){
  const phase=action==='cancel'?'idle':'error';
  const message=action==='cancel'?'Update cancelled. You can retry.':'Update interrupted. Return Home to retry.';
  return ['cancel','background'].includes(action)&&status.phase===phase&&status.message===message
    &&status.downloaded===0&&Array.isArray(status.sessions)&&status.sessions.length===0
    &&status.ownedSession==null;
}

export function playProtectState(xml,focus){
  if(!focus?.includes('com.android.vending/com.google.android.finsky.protectdialogs.activity.PlayProtectDialogsActivity'))return 'other';
  if(/harmful|malicious|unsafe|blocked|install anyway|couldn.?t scan|can.?t scan/i.test(xml))return 'security-boundary';
  const vendingLabels=[...xml.matchAll(/<node\b[^>]+>/g)].map(match=>match[0]).filter(node=>node.includes('package="com.android.vending"')).map(node=>/\btext="([^"]*)"/.exec(node)?.[1]);
  const safeLabels=['This app looks safe','Block Ops','You can continue to install it','Install'];
  if(safeLabels.every(label=>vendingLabels.includes(label))&&vendingLabels.filter(Boolean).every(label=>safeLabels.includes(label)))return 'safe';
  if(xml.includes('text="App scan recommended"')&&xml.includes('text="Block Ops"')&&xml.includes('text="Scan app"'))return 'recommendation';
  if(/text="Scanning(?: app|…|\.\.\.)?"/.test(xml))return 'scanning';
  return 'security-boundary';
}

// Focus can advance before the accessibility observer sees the new window.
// Only classify a hierarchy belonging to the same, still-focused package.
export async function settledPlayProtect({readFocus,readHierarchy,now=Date.now,pause=()=>delay(100),timeout=3000}){
  const deadline=now()+timeout;
  while(now()<deadline){
    const focus=await readFocus();
    if(!focus?.includes('com.android.vending/'))return null;
    const xml=await readHierarchy(),current=await readFocus();
    if(!current?.includes('com.android.vending/'))return null;
    if(current===focus&&/\bpackage="([^"]+)"/.exec(xml)?.[1]==='com.android.vending')return {focus,xml,state:playProtectState(xml,focus)};
    await pause();
  }
  throw Error('Accessibility hierarchy did not match the focused Play Protect window');
}

export async function updaterNativeFixture({artifactDir,serial,avd}) {
  const owned={
    'emulator-5580':['bydgame_updater_api36','36'],
    'emulator-5584':['bydgame_updater_api26_google','26'],
    'emulator-5586':['bydgame_updater_final_api36','36'],
    'emulator-5588':['bydgame_updater_final_api26_google','26'],
    'emulator-5590':['bydgame_updater_review_api36','36'],
    'emulator-5592':['bydgame_updater_review_api26_google','26'],
  };
  const api=owned[serial]?.[0]===avd?owned[serial][1]:null;
  assert.ok(api,'Only explicitly owned updater serial/AVD/API triples are accepted');
  const run=promisify(execFile),adb=process.env.ADB_BINARY||'/usr/bin/adb';
  const command=(...args)=>run(adb,['-s',serial,...args],{timeout:120000,maxBuffer:12*1024*1024});
  async function identity(){assert.equal((await command('emu','avd','name')).stdout.trim().split('\n')[0].trim(),avd);assert.equal((await command('shell','getprop','ro.build.version.sdk')).stdout.trim(),api);assert.equal((await command('shell','getprop','sys.boot_completed')).stdout.trim(),'1');}
  async function mutate(...args){await identity();return command(...args);}
  async function until(fn,label,timeout=30000){const end=Date.now()+timeout;while(Date.now()<end){const value=await fn();if(value)return value;await delay(200);}throw Error(`Native acceptance timeout: ${label}`);}
  let fixturePid=null,uiSequence=0;
  async function hierarchy(){
    if(fixturePid){
      const live=(await command('shell','pidof','au.local.blockops').catch(()=>({stdout:''}))).stdout.trim();
      if(live===fixturePid){
        const snapshot=await until(async()=>{try{const s=JSON.parse((await command('shell','run-as','au.local.blockops','cat','files/updater-fixture-ui.json')).stdout);return String(s.pid)===fixturePid&&s.sequence>uiSequence&&s;}catch{return false;}},'fresh advancing native accessibility snapshot',5000);
        const now=Number((await command('shell','cat','/proc/uptime')).stdout.trim().split(' ')[0])*1000;
        assert.ok(now-snapshot.elapsed>=-100&&now-snapshot.elapsed<3000,'Native accessibility snapshot must be current');uiSequence=snapshot.sequence;return snapshot.xml;
      }
      fixturePid=null;
    }
    const dump=await mutate('shell','uiautomator','dump','/data/local/tmp/blockops-updater-hierarchy.xml');assert.match(dump.stdout,/UI hierchary dumped to:/,'A failed dump may not reuse an older XML file');const xml=(await command('shell','cat','/data/local/tmp/blockops-updater-hierarchy.xml')).stdout;assert.ok(xml.includes('<hierarchy'),'Android must return a real accessibility hierarchy');return xml;
  }
  async function button(text,{timeout=30000,scanAuthorized=false,safeInstallAuthorized=false}={}){
    let previous='',stable=0;
    const node=await until(async()=>{const xml=await hierarchy();const found=[...xml.matchAll(/<node\b[^>]+>/g)].map(m=>m[0]).find(n=>{
      const label=/\btext="([^"]*)"/.exec(n)?.[1]||/content-desc="([^"]*)"/.exec(n)?.[1];
      // API36's real Settings Compose row has no resource ID; do not generalize this exception.
      const settingsPermission=text==='Allow from this source'&&n.includes('package="com.android.settings"')&&n.includes('class="android.widget.TextView"');
      const playProtectScan=scanAuthorized&&text==='Scan app'&&n.includes('package="com.android.vending"')&&n.includes('class="android.widget.TextView"');
      const playProtectInstall=safeInstallAuthorized&&text==='Install'&&n.includes('package="com.android.vending"')&&n.includes('class="android.widget.TextView"');
      return label?.toLowerCase()===text.toLowerCase()&&!n.includes('enabled="false"')&&!n.includes('visible-to-user="false"')&&(/resource-id="[^"]+"/.test(n)||settingsPermission||playProtectScan||playProtectInstall);
    });
      const windows=(await command('shell','dumpsys','window')).stdout,focus=/mCurrentFocus=Window\{([^}]+)\}/.exec(windows)?.[1];
      if(safeInstallAuthorized)assert.equal(playProtectState(xml,focus),'safe','Only the exact current safe scan result may expose Play Protect Install');
      const pkg=/\bpackage="([^"]+)"/.exec(found||'')?.[1];
      const fingerprint=found&&focus?.includes(pkg)?`${found}|${focus}`:'';
      stable=fingerprint&&fingerprint===previous?stable+1:0;previous=fingerprint;
      return stable>=2&&found;
    },`native button ${text}`,timeout);
    const packageName=/\bpackage="([^"]+)"/.exec(node)?.[1];
    assert.ok(['au.local.blockops','com.android.settings','com.google.android.packageinstaller','com.android.packageinstaller','com.google.android.permissioncontroller','com.android.permissioncontroller',...((scanAuthorized&&text==='Scan app')||(safeInstallAuthorized&&text==='Install')?['com.android.vending']:[])].includes(packageName),'Native controls belong to the expected application or system window');
    const windows=(await command('shell','dumpsys','window')).stdout,focus=/mCurrentFocus=Window\{([^}]+)\}/.exec(windows)?.[1];assert.ok(focus?.includes(packageName),'Never tap a stale native window');
    if(safeInstallAuthorized)assert.ok(focus.includes('com.android.vending/com.google.android.finsky.protectdialogs.activity.PlayProtectDialogsActivity'),'Safe Install requires the same Play Protect Activity');
    const [,x1,y1,x2,y2]=/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(node).map(Number);
    await appendFile(join(artifactDir,'native-actions.jsonl'),JSON.stringify({text,node,focus,sequence:uiSequence,at:Date.now(),x:Math.round((x1+x2)/2),y:Math.round((y1+y2)/2)})+'\n',{mode:0o600});
    await mutate('shell','input','tap',String(Math.round((x1+x2)/2)),String(Math.round((y1+y2)/2)));
  }
  let child,observationOutput='',observationLog;
  await mkdir(artifactDir,{recursive:true});await identity();
  return {api,identity,command,mutate,until,hierarchy,button,
    async installerConfirmation(){
      let previous='',stable=0;
      return until(async()=>{
        const xml=await hierarchy(),focus=/mCurrentFocus=Window\{([^}]+)\}/.exec((await command('shell','dumpsys','window')).stdout)?.[1];
        const nodes=[...xml.matchAll(/<node\b[^>]+>/g)].map(m=>m[0]).filter(n=>/package="(?:com.google.android.packageinstaller|com.android.packageinstaller|com.google.android.permissioncontroller|com.android.permissioncontroller)"/.test(n)&&!n.includes('enabled="false"')&&!n.includes('visible-to-user="false"')&&/resource-id="[^"]+"/.test(n));
        const cancel=nodes.find(n=>/text="(?:CANCEL|Cancel)"/.test(n)),install=nodes.find(n=>/text="(?:INSTALL|Install|UPDATE|Update)"/.test(n));
        const pkg=/package="([^"]+)"/.exec(install||'')?.[1];
        const fingerprint=cancel&&install&&focus?.includes(pkg)?`${cancel}|${install}|${focus}`:'';
        stable=fingerprint&&fingerprint===previous?stable+1:0;previous=fingerprint;
        return stable>=2&&xml;
      },'settled real Android confirmation with enabled Install and Cancel');
    },
    async permissionEnabled(expected){
      return until(async()=>{const xml=await hierarchy();
        if(!/mCurrentFocus=Window\{[^}]*com.android.settings\//.test((await command('shell','dumpsys','window')).stdout))return false;
        if(!xml.includes('text="Allow from this source"'))return false;
        const switches=[...xml.matchAll(/<node\b[^>]+>/g)].map(m=>m[0]).filter(n=>n.includes('package="com.android.settings"')&&n.includes('checkable="true"')&&!n.includes('visible-to-user="false"'));
        return switches.length===1&&switches[0].includes(`checked="${expected}"`);
      },`actual Settings switch ${expected?'enabled':'disabled'}`);
    },
    async gamePage(page){
      const cdp=await page.context().newCDPSession(page);
      async function gameForeground(){
        const windows=(await command('shell','dumpsys','window')).stdout;
        const focus=/mCurrentFocus=Window\{([^}]+)\}/.exec(windows)?.[1];
        assert.ok(focus&&focus.includes('au.local.blockops/au.local.blockops.MainActivity'),'Game input requires actual focused game Activity');
        const id=focus.split(' ')[0],block=windows.split(/(?=  Window #\d+ Window\{)/).find(s=>s.startsWith('  Window #')&&s.includes(`Window{${id} `));
        assert.ok(block&&(/\bty=BASE_APPLICATION\b/.test(block)||/\bty=1\b/.test(block)),'Never send game input through a native dialog');
      }
      const touch=(type,point)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:point?[{...point,id:91}]:[]});
      let cursor={x:0,y:0},held=false;
      return {...page,async logoGesture(selector){
        assert.equal(api,'26');assert.ok(['#home-secret-logo','#pause-secret-logo'].includes(selector));
        const logo=page.locator(selector);await logo.waitFor();await gameForeground();assert.equal(await logo.isDisabled(),false);
        let previous='',stable=0;
        const point=await until(async()=>{const box=await logo.boundingBox(),dpr=await page.evaluate(()=>devicePixelRatio);assert.ok(box);const p={x:Math.round((box.x+box.width/2)*dpr),y:Math.round((box.y+box.height/2)*dpr)};const key=JSON.stringify(p);stable=key===previous?stable+1:0;previous=key;return stable>=2&&p;},'stable physical logo gesture bounds',5000);
        await gameForeground();const started=Date.now();
        await mutate('shell',Array(5).fill(`input tap ${point.x} ${point.y}`).join(' && '));
        await appendFile(join(artifactDir,'game-input.jsonl'),JSON.stringify({selector,...point,count:5,started,elapsed:Date.now()-started,input:'physical adb logo gesture batch'})+'\n',{mode:0o600});
        await page.waitForSelector('#solo-powers-screen:not([hidden])');
      },locator(selector){const base=page.locator(selector);const click=async()=>{
        await base.waitFor();await gameForeground();
        // Chrome69 received CDP touchstart/end without a compatibility click. Its native
        // control bounds have no API36 cutout offset; use the existing real adb input path.
        if(api==='26'){
          await base.evaluate(e=>e.scrollIntoView({block:'nearest',inline:'nearest'}));const box=await base.boundingBox(),dpr=await page.evaluate(()=>devicePixelRatio);
          await appendFile(join(artifactDir,'game-input.jsonl'),JSON.stringify({selector,box,dpr,x:Math.round((box.x+box.width/2)*dpr),y:Math.round((box.y+box.height/2)*dpr),at:Date.now(),input:'physical adb tap'})+'\n',{mode:0o600});
          return base.click();
        }
        await base.evaluate(e=>e.scrollIntoView({block:'nearest',inline:'nearest'}));
        const box=await base.boundingBox();assert.ok(box);assert.equal(await base.isDisabled(),false);
        await touch('touchStart',{x:box.x+box.width/2,y:box.y+box.height/2});await touch('touchEnd');
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      };const control=method=>async(...args)=>{await base.waitFor();await gameForeground();return base[method](...args);};
      return {...base,click,tap:click,fill:control('fill'),selectOption:control('selectOption'),uncheck:control('uncheck')};},mouse:api==='26'?{
        move:page.mouse.move,async down(){await gameForeground();await page.mouse.down();},async up(){await gameForeground();await page.mouse.up();},
      }:{
        async move(x,y){cursor={x,y};if(held)await touch('touchMove',cursor);},
        async down(){await gameForeground();held=true;await touch('touchStart',cursor);},
        async up(){if(held){held=false;await touch('touchEnd');}},
      }};
    },
    async screenshot(name){await identity();const r=await run(adb,['-s',serial,'exec-out','screencap','-p'],{encoding:'buffer',timeout:30000,maxBuffer:12*1024*1024});await writeFile(join(artifactDir,`${name}.png`),r.stdout);},
    async status(){return JSON.parse((await command('shell','run-as','au.local.blockops','cat','files/updater-fixture-status.json')).stdout);},
    async suite(name){
      await identity();const output=(await mutate('shell','am','instrument','-w','-r','-e','suite',name,'au.local.blockops.test/au.local.blockops.updates.UpdaterInstrumentation')).stdout;
      await writeFile(join(artifactDir,`instrumentation-${name}.log`),output);assert.ok(output.includes(`PASS ${name}`)&&output.includes('INSTRUMENTATION_CODE: -1'),output);return output;
    },
    async instrument(fixture='valid',mode='normal',{reset=false,sentinel=false}={}){
      fixturePid=null;uiSequence=0;
      await mutate('shell','am','force-stop','au.local.blockops');await identity();
      child=spawn(adb,['-s',serial,'shell','am','instrument','-w','-r','-e','suite','acceptance','-e','fixture',fixture,'-e','mode',mode,'-e','reset',String(reset),'-e','sentinel',String(sentinel),'au.local.blockops.test/au.local.blockops.updates.UpdaterInstrumentation']);
      let output='';observationLog=join(artifactDir,`instrumentation-${fixture}-${mode}.log`);const log=observationLog;
      const observe=b=>{output+=b;observationOutput=output;};child.stdout.on('data',observe);child.stderr.on('data',observe);child.on('close',()=>writeFile(log,output));
      await until(()=>output.includes('PASS acceptanceHostReady')||(/FAIL/.test(output)&&Promise.reject(Error(output))),'instrumentation application launch');fixturePid=(await command('shell','pidof','au.local.blockops')).stdout.trim();assert.match(fixturePid,/^\d+$/);return child;
    },
    async detachHost(){
      if(observationLog)await writeFile(observationLog,observationOutput);
      // Do not signal adb/am/instrumentation or change the pending Android session.
      child?.unref();child?.stdout.unref?.();child?.stderr.unref?.();
    },
    async version(){const text=(await command('shell','dumpsys','package','au.local.blockops')).stdout;return {code:Number(/versionCode=(\d+)/.exec(text)?.[1]),name:/versionName=(\S+)/.exec(text)?.[1]};},
    async waitVersion(code,{scanAuthorized=false,previousSafeScan=false}={}){
      let scanRequested=false,safeInstallRequested=false,lastXml='';
      const readFocus=async()=>/mCurrentFocus=Window\{([^}]+)\}/.exec((await command('shell','dumpsys','window')).stdout)?.[1];
      await until(async()=>{
        const installed=(await this.version()).code===code;
        const focus=await readFocus();
        if(!focus?.includes('com.android.vending'))return installed;
        const observation=await settledPlayProtect({readFocus,readHierarchy:hierarchy});
        if(!observation)return false;
        const {xml,state}=observation;
        if(xml!==lastXml){
          await appendFile(join(artifactDir,'play-protect-observations.jsonl'),JSON.stringify({at:Date.now(),focus:observation.focus,state,xml})+'\n',{mode:0o600});
          lastXml=xml;
        }
        assert.notEqual(state,'security-boundary','Different Play Protect security finding: stop without override');
        assert.notEqual(state,'other','Unexpected Play Protect Activity: stop without override');
        if(state==='recommendation'&&!scanRequested){
          assert.equal(previousSafeScan,false,'A previously completed scan must not be submitted again');
          assert.equal(scanAuthorized,true,'Explicit user authorization required before uploading updater fixture to Google');
          assert.equal(code,16,'Scan authorization is scoped to the updater fixture16');
          await this.screenshot('play-protect-before-authorized-scan');
          await button('Scan app',{scanAuthorized:true});
          scanRequested=true;
        }
        if(state==='safe'&&!safeInstallRequested){
          assert.equal(scanAuthorized,true);
          assert.equal(code,16);
          assert.ok(scanRequested||previousSafeScan,'Safe-result Install requires this scan or explicit verified prior scan provenance');
          await this.screenshot('play-protect-safe-result');
          await writeFile(join(artifactDir,'play-protect-safe-result.json'),JSON.stringify({at:Date.now(),focus:observation.focus,xml,verdict:'This app looks safe',previousSafeScan}),{mode:0o600});
          await button('Install',{safeInstallAuthorized:true});
          safeInstallRequested=true;
        }
        return false;
      },`installed version ${code} after native confirmation`,180000);
      await writeFile(join(artifactDir,'play-protect-install-observation.json'),JSON.stringify({scanRequested,previousSafeScan,safeInstallRequested,installedCode:code,standaloneScanVerdict:safeInstallRequested?'This app looks safe':null}),{mode:0o600});
    },
    async stop(){await mutate('shell','am','force-stop','au.local.blockops');},
  };
}
