import test from 'node:test';
import assert from 'node:assert/strict';
import { MODES, getMode } from '../src/modes.js';
import { SOLO_MODES, getSoloMode, onlineSelection } from '../src/solo-modes.js';
import { validateSelection } from '../src/home-ui.js';

test('Zombies belongs only to the solo catalog; shared server modes are unchanged',()=>{
  assert.deepEqual(MODES.map(m=>m.id),['ffa','tdm','ctf']);
  assert.throws(()=>getMode('zombies'));
  assert.deepEqual(SOLO_MODES.map(m=>m.id),['ffa','tdm','ctf','zombies']);
  assert.deepEqual(getSoloMode('zombies'),{ id:'zombies',name:'Zombie Survival',soloOnly:true });
  for(const mode of MODES) assert.equal(getSoloMode(mode.id),mode);
  assert.throws(()=>getSoloMode('unknown'));
  assert.equal(validateSelection({ modeId:'zombies' }).modeId,'zombies');
  assert.equal(validateSelection({ modeId:'unknown' }).modeId,'ffa');
});
test('online selection sanitizes only Zombies and never mutates Home choice',()=>{
  for(const modeId of ['zombies','ffa','tdm','ctf']) {
    const selection=Object.freeze({ modeId,mapId:'harbor',skinId:'shadow-ninja',weaponId:'ak47' });
    const packet=onlineSelection(selection);
    assert.notEqual(packet,selection);
    assert.deepEqual(packet,{ ...selection,modeId:modeId==='zombies'?'ffa':modeId });
    assert.equal(selection.modeId,modeId);
  }
});
