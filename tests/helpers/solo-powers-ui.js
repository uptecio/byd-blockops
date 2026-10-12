import { createInputFixture } from './input-fixture.js';

// Only the tiny DOM boundary needed by this controller is added; real Input
// event handling and the existing shared fixture remain unchanged.
export function soloPowersDOM(t) {
  const base=createInputFixture(); t.after(()=>base.restore());
  const ids=['home-secret-logo','pause-secret-logo','solo-powers-screen','solo-powers-title',
    'solo-powers-status','solo-powers-pin-form','solo-powers-pin','solo-powers-pin-confirm',
    'solo-powers-confirm-row','solo-powers-pin-submit','solo-powers-controls','solo-powers-invincible',
    'solo-powers-ammo','solo-powers-speed','solo-powers-speed-value','solo-powers-speed-multiplier',
    'solo-powers-apply','solo-powers-cancel'];
  const elements=Object.fromEntries(ids.map(id=>[id,base.document.getElementById(id)]));
  for(const [id,element] of Object.entries(elements)) {
    element.id=id;element.value='';element.checked=false;
    element.contains=target=>target===element || element.children.some(child=>child.contains?.(target));
  }
  const get=id=>elements[id.startsWith('solo-powers-') || id.endsWith('-secret-logo')?id:`solo-powers-${id}`];
  get('screen').hidden=true;get('controls').hidden=true;
  get('screen').append(get('title'),get('status'),get('pin-form'),get('controls'),get('cancel'));
  get('pin-form').append(get('pin'),get('confirm-row'),get('pin-submit'));get('confirm-row').append(get('pin-confirm'));
  get('controls').append(get('invincible'),get('ammo'),get('speed'),get('speed-value'),get('speed-multiplier'),get('apply'));
  return {...base,get,event(target,type,props={}) {
    const event=new Event(type,{cancelable:true});Object.assign(event,props);
    (typeof target==='string'?get(target):target).dispatchEvent(event);return event;
  }};
}

export function deferredPin() { let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject}; }
export async function settleUI() { await Promise.resolve();await Promise.resolve();await Promise.resolve(); }
