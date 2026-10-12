import test from 'node:test';
import assert from 'node:assert/strict';
import { createSoloPowersUI } from '../src/solo-powers-ui.js';
import { soloPowersDOM, deferredPin, settleUI } from './helpers/solo-powers-ui.js';

const off={invincible:false,unlimitedAmmo:false,superSpeed:false,speedMultiplier:2};
function fixture(t,options={}) {
  const dom=soloPowersDOM(t),context={allowed:true,origin:'home',token:{},roundId:null,config:{...off},...options.context};
  const applied=[],opened=[],closed=[],calls=[];
  let clock=0;
  const state={kind:options.kind || 'ready',reason:'',retryAfterMs:0};
  const pinGate={status:()=>({...state}),setup:async(...args)=>{calls.push(['setup',...args]);return {ok:true};},
    verify:async(...args)=>{calls.push(['verify',...args]);return {ok:true};},...options.pinGate};
  const ui=createSoloPowersUI({document:dom.document,pinGate,getContext:()=>({...context}),now:()=>clock,
    onOpen:ctx=>opened.push(ctx),onClose:ctx=>closed.push(ctx),
    onApply:(config,ctx)=>{applied.push({config,ctx});return {ok:true};},...options.callbacks});
  t.after(()=>ui.destroy());
  const click=(id,detail=1)=>dom.event(id,'click',{detail});
  const activate=(count=5,origin=context.origin)=>{for(let i=0;i<count;i++)click(origin==='home'?'home-secret-logo':'pause-secret-logo');};
  async function unlock() {activate();dom.get('pin').value='0427';dom.get('pin-confirm').value='0427';dom.event('pin-form','submit');await settleUI();}
  return {...dom,context,state,pinGate,ui,applied,opened,closed,calls,click,activate,unlock,tick:ms=>{clock+=ms;}};
}

test('only five same-logo activations inside three seconds open a single masked gate',t=>{
  const f=fixture(t);f.activate(4);assert.equal(f.ui.isOpen(),false);
  f.activate(1);assert.equal(f.ui.isOpen(),true);assert.equal(f.opened.length,1);
  assert.equal(f.get('screen').hidden,false);assert.equal(f.get('controls').hidden,true);
  assert.equal(f.get('pin-form').hidden,false);assert.equal(f.get('confirm-row').hidden,true);
  assert.equal(f.document.activeElement,f.get('pin'));
  f.activate(5);assert.equal(f.opened.length,1);
});

test('timeout, screen identity and background cancellation discard an unfinished gesture',t=>{
  const f=fixture(t);f.activate(4);f.tick(3001);f.activate(1);assert.equal(f.ui.isOpen(),false);
  f.activate(3);f.context.token={};f.activate(1);assert.equal(f.ui.isOpen(),false);
  f.activate(3);f.ui.invalidate();f.activate(1);assert.equal(f.ui.isOpen(),false);
  f.context.origin='paused';f.context.roundId={};f.activate(4);assert.equal(f.ui.isOpen(),false);
  f.activate(1);assert.equal(f.ui.isOpen(),true);
});

test('pointer events are not double-counted and keyboard-generated clicks use the same gesture',t=>{
  const f=fixture(t);
  for(let i=0;i<4;i++) {f.event('home-secret-logo','pointerdown');f.event('home-secret-logo','pointerup');f.click('home-secret-logo');}
  assert.equal(f.ui.isOpen(),false);f.click('home-secret-logo',0);assert.equal(f.ui.isOpen(),true);
});

for(const context of [{allowed:false},{origin:'playing'},{origin:'paused',roundId:null}]) test(`ineligible context rejects secret access ${JSON.stringify(context)}`,t=>{
  const f=fixture(t,{context});f.activate();assert.equal(f.ui.isOpen(),false);assert.equal(f.opened.length,0);
});

test('a hidden other-origin logo cannot count toward Home access',t=>{
  const f=fixture(t);f.activate(4);f.activate(5,'paused');assert.equal(f.ui.isOpen(),false);
});

test('first setup confirms PIN before exposing independent draft controls; Apply passes a normalized copy',async t=>{
  const f=fixture(t,{kind:'missing'});await f.unlock();
  assert.deepEqual(f.calls,[['setup','0427','0427']]);assert.equal(f.get('pin').value,'');assert.equal(f.get('pin-confirm').value,'');
  assert.equal(f.get('pin-form').hidden,true);assert.equal(f.get('controls').hidden,false);
  assert.equal(f.applied.length,0);assert.deepEqual(f.context.config,off);
  f.get('invincible').checked=true;f.get('ammo').checked=true;f.get('speed').checked=true;
  f.event('speed','change');f.get('speed-multiplier').value='2.34';f.event('speed-multiplier','input');
  f.click('apply');assert.equal(f.ui.isOpen(),false);
  assert.deepEqual(f.applied[0].config,{invincible:true,unlimitedAmmo:true,superSpeed:true,speedMultiplier:2.3});
  assert.deepEqual(f.context.config,off);assert.equal(f.applied[0].ctx.token,f.context.token);
  assert.equal(f.document.activeElement,f.get('home-secret-logo'));assert.equal(f.closed.length,1);
  f.get('invincible').checked=false;assert.equal(f.applied[0].config.invincible,true);
});

test('Pause opens with the active round settings; Cancel discards all draft changes and never calls Apply',async t=>{
  const config={invincible:true,unlimitedAmmo:false,superSpeed:true,speedMultiplier:5};
  const f=fixture(t,{context:{origin:'paused',roundId:{},config}});await f.unlock();
  assert.equal(f.get('invincible').checked,true);assert.equal(f.get('ammo').checked,false);
  assert.equal(f.get('speed-multiplier').value,'5');assert.equal(f.get('speed-value').textContent,'5.0×');
  f.get('ammo').checked=true;f.click('cancel');
  assert.equal(f.ui.isOpen(),false);assert.equal(f.applied.length,0);assert.equal(f.context.config,config);
  assert.equal(f.document.activeElement,f.get('pause-secret-logo'));
  f.activate();assert.equal(f.get('controls').hidden,true,'every reopening requires PIN');
  assert.equal(f.get('pin').value,'');assert.equal(f.get('pin-confirm').value,'');
});

test('wrong PIN and unavailable/protected capability keep controls locked without copying entered digits into status',async t=>{
  const f=fixture(t,{pinGate:{verify:async()=>({ok:false,reason:'Incorrect PIN.',retryAfterMs:0})}});
  await f.unlock();assert.equal(f.get('controls').hidden,true);assert.equal(f.get('pin').value,'');assert.equal(f.applied.length,0);
  assert.equal(f.get('status').textContent.includes('0427'),false);
  for(const kind of ['protected','unavailable']) {
    f.ui.invalidate();f.state.kind=kind;f.state.reason='Menu unavailable';f.activate();
    assert.equal(f.get('pin-submit').disabled,true);assert.equal(f.get('controls').hidden,true);
    assert.equal(f.get('status').textContent,'Menu unavailable');
  }
});

test('closing/reopening the UI does not bypass the PIN gate cooldown',t=>{
  const f=fixture(t);f.state.retryAfterMs=30000;f.activate();
  assert.equal(f.get('pin-submit').disabled,true);assert.match(f.get('status').textContent,/30/);
  f.click('cancel');f.activate();assert.equal(f.get('pin-submit').disabled,true);assert.equal(f.state.retryAfterMs,30000);
});

for(const action of ['cancel','invalidate','token','round','online']) test(`delayed PIN success cannot unlock after ${action}`,async t=>{
  const held=deferredPin();const f=fixture(t,{context:{origin:'paused',roundId:{}},pinGate:{verify:()=>held.promise}});
  f.activate();f.get('pin').value='0427';f.event('pin-form','submit');
  assert.equal(f.get('pin-submit').disabled,true);
  if(action==='cancel')f.click('cancel');
  if(action==='invalidate')f.ui.invalidate();
  if(action==='token')f.context.token={};
  if(action==='round')f.context.roundId={};
  if(action==='online')f.context.allowed=false;
  held.resolve({ok:true});await settleUI();
  assert.equal(f.ui.isOpen(),false);assert.equal(f.get('controls').hidden,true);assert.equal(f.applied.length,0);
  assert.equal(f.get('pin').value,'');assert.equal(f.get('pin-confirm').value,'');
});

test('a cancelled setup may finish but cannot reopen or overwrite a newer UI generation',async t=>{
  const held=deferredPin(),f=fixture(t,{kind:'missing',pinGate:{setup:()=>held.promise}});
  f.activate();f.get('pin').value=f.get('pin-confirm').value='0427';f.event('pin-form','submit');
  f.ui.invalidate();f.state.kind='ready';f.activate();
  held.resolve({ok:true});await settleUI();
  assert.equal(f.ui.isOpen(),true);assert.equal(f.get('controls').hidden,true);assert.equal(f.applied.length,0);
});

test('rejected credential operation becomes a local error rather than an unhandled rejection',async t=>{
  const f=fixture(t,{pinGate:{verify:async()=>{throw Error('unsupported');}}});await f.unlock();
  assert.equal(f.get('controls').hidden,true);assert.ok(f.get('status').textContent);assert.equal(f.get('pin').value,'');
});

test('focus wraps inside both PIN and unlocked panels; Escape cancels and consumes the input',async t=>{
  const f=fixture(t,{kind:'missing'});f.activate();
  f.get('cancel').focus();let event=f.event(f.document,'keydown',{key:'Tab'});
  assert.equal(event.defaultPrevented,true);assert.equal(f.document.activeElement,f.get('pin'));
  event=f.event(f.document,'keydown',{key:'Tab',shiftKey:true});
  assert.equal(event.defaultPrevented,true);assert.equal(f.document.activeElement,f.get('cancel'));
  f.get('pin').value=f.get('pin-confirm').value='0427';f.event('pin-form','submit');await settleUI();
  f.get('cancel').focus();f.event(f.document,'keydown',{key:'Tab'});assert.equal(f.document.activeElement,f.get('invincible'));
  event=f.event(f.document,'keydown',{key:'Escape'});assert.equal(event.defaultPrevented,true);assert.equal(f.ui.isOpen(),false);
  assert.equal(f.applied.length,0);assert.equal(f.document.activeElement,f.get('home-secret-logo'));
});

test('invalid draft stays local; stale context cannot receive Apply',async t=>{
  const f=fixture(t);await f.unlock();f.get('speed-multiplier').value='Infinity';f.click('apply');
  assert.equal(f.applied.length,0);assert.equal(f.ui.isOpen(),true);
  f.get('speed-multiplier').value='5';f.context.token={};f.click('apply');
  assert.equal(f.applied.length,0);assert.equal(f.ui.isOpen(),false);
});

test('a rejected Apply stays open without resuming or losing the editable draft',async t=>{
  const f=fixture(t,{callbacks:{onApply:()=>({ok:false,reason:'Round changed'})}});await f.unlock();
  f.get('invincible').checked=true;f.click('apply');
  assert.equal(f.ui.isOpen(),true);assert.equal(f.get('invincible').checked,true);
  assert.equal(f.get('status').textContent,'Round changed');assert.equal(f.closed.length,0);
});

test('pending verification clears digits immediately and rejects duplicate form submissions',async t=>{
  const held=deferredPin();let attempts=0;
  const f=fixture(t,{pinGate:{verify:()=>{attempts++;return held.promise;}}});
  f.activate();f.get('pin').value='0427';f.event('pin-form','submit');f.event('pin-form','submit');
  assert.equal(attempts,1);assert.equal(f.get('pin').value,'');
  f.click('cancel');held.resolve({ok:true});await settleUI();assert.equal(f.ui.isOpen(),false);
});

test('destroy cancels open state and removes logo access',t=>{
  const f=fixture(t);f.activate();f.ui.destroy();assert.equal(f.ui.isOpen(),false);
  f.activate();assert.equal(f.ui.isOpen(),false);
});
