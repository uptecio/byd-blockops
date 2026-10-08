import test from 'node:test';
import { HidingUI } from '../src/hiding-ui.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { renderMatchHud, renderMatchResults } from '../src/match-ui.js';

function dom(t) {
  const nodes=new Map();
  const node=key=>{
    if(!nodes.has(key)) { const classes=new Set(); nodes.set(key,{ textContent:'',hidden:false,classList:{
      toggle(c,on){on?classes.add(c):classes.delete(c);},contains(c){return classes.has(c);} } }); }
    return nodes.get(key);
  };
  const previous=globalThis.document;
  globalThis.document={ getElementById:node,querySelector:node };
  t.after(()=>{ if(previous) globalThis.document=previous; else delete globalThis.document; });
  return node;
}
const view=extra=>({ modeId:'zombies',mapId:'courtyard',ended:false,timeLeft:0,players:[{ id:'local',kills:12,deaths:0,teamId:null }],
  survival:{ wave:3,completedWaves:2,kills:12,phase:'fighting',queued:9,alive:0,remaining:9,recoveryRemaining:0 },...extra });
test('HUD shows queued plus living, recovery countdown, then restores ordinary score and clock',t=>{
  const $=dom(t),v=view(); renderMatchHud(v,'local');
  assert.equal($('kills').textContent,'WAVE 3'); assert.equal($('.score-target').textContent,'9 LEFT');
  assert.match($('hud-mode').textContent,/ZOMBIE/); assert.notEqual($('timer').textContent,'03:00');
  v.survival.phase='recovery'; v.survival.recoveryRemaining=9.9; renderMatchHud(v,'local');
  assert.equal($('timer').textContent,'NEXT WAVE IN 10');
  renderMatchHud({ ...v,modeId:'ffa',timeLeft:180,survival:undefined,flags:null },'local');
  assert.equal($('timer').textContent,'03:00'); assert.equal($('kills').textContent,12);
  assert.equal($('.score-panel').classList.contains('zombie-score'),false);
  assert.equal($('objective-status').hidden,true);
});
test('results count completed waves rather than unfinished current wave and show the saved best',t=>{
  const $=dom(t),v=view(); v.survival.completedWaves=0;
  renderMatchResults(v,'local',{ best:{ waves:2,kills:14 } });
  assert.equal($('result-title').textContent,'RUN OVER.');
  assert.equal($('result-kills').textContent,0); assert.equal($('result-kills-label').textContent,'WAVES COMPLETED');
  assert.equal($('result-deaths').textContent,12); assert.equal($('result-deaths-label').textContent,'ZOMBIES DEFEATED');
  assert.match($('zombie-best').textContent,/2 WAVES.*14 KILLS/); assert.equal($('zombie-best').hidden,false);
  assert.equal($('.results-dialog').classList.contains('zombie-results'),true);
  renderMatchResults({ ...v,modeId:'ffa',winnerId:'local',winnerTeamId:null },'local');
  assert.equal($('result-title').textContent,'YOU WON.'); assert.equal($('result-kills').textContent,12);
  assert.equal($('result-kills-label').textContent,'ELIMINATIONS'); assert.equal($('result-deaths-label').textContent,'DEATHS');
  assert.equal($('zombie-best').hidden,true);
  assert.equal($('.results-dialog').classList.contains('zombie-results'),false);
});
test('ordinary minimal result fixture stays supported and shipped markup contains all new labels',t=>{
  const $=dom(t),previous=globalThis.document.getElementById;
  globalThis.document.getElementById=id=>['result-kills-label','result-deaths-label','zombie-best'].includes(id)?null:previous(id);
  assert.doesNotThrow(()=>renderMatchResults({ ...view(),modeId:'ffa',winnerId:null,winnerTeamId:null },'local'));
  assert.equal($('result-title').textContent,'DRAW.');
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  for(const id of ['home-mode-help','session-duration','session-duration-label','result-kills-label','result-deaths-label','zombie-best','bot-settings-note'])
    assert.ok(html.includes(`id="${id}"`),id);
});

test('main HUD adds recovery suppression without undoing equipment death or throw locks',t=>{
  const node=dom(t),$=id=>{const result=node(id);result.style??={};result.setAttribute??=((key,value)=>{result[key]=String(value);});return result;};
  // Execute the actual private composition callback without booting main's
  // renderer. EquipmentUI's separately-tested output is the boundary input.
  const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
  const callback=source.match(/function onHud\(current\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(callback,'production HUD callback is present');
  let equipmentBlocked=false,phase;
  const onHud=runInNewContext(`(${callback})`,{$,equipmentUI:{render(){
    $('fire-button').disabled=equipmentBlocked;$('throw-button').disabled=equipmentBlocked;
  }},hidingUI:new HidingUI({button:$('hide-button'),status:$('hiding-status')}),renderMatchHud(){},renderProgression(){},multiplayer:null,input:{zoom:false},performance:{now:()=>0},toastUntil:1});
  const game={getMatchView:()=>phase?{survival:{phase}}:{modeId:'ffa'},
    player:{health:100,dead:0},weapon:{name:'M4A1'},weaponState:{ammo:30,reserve:470,reloadRemaining:0},
    hitFlash:0,damageFlash:0,heldItem:'gun'};
  for(const [nextPhase,blocked,expected] of [[undefined,true,true],['fighting',true,true],
    ['recovery',false,true],['fighting',false,false],[undefined,false,false]]) {
    phase=nextPhase;equipmentBlocked=blocked;onHud(game);
    assert.equal($('fire-button').disabled,expected,`${phase||'ordinary'} preserves existing attack eligibility`);
    assert.equal($('throw-button').disabled,expected);
  }
});
