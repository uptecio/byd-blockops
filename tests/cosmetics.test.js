import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {SKINS,getSkin} from '../src/skins.js';
import {REWARDS,ownsCosmetic} from '../src/progression.js';
import {WEAPONS} from '../src/weapons.js';
import {createWeaponModel} from '../src/world.js';
import {createAvatarModel,AVATAR_HITBOX} from '../src/avatar.js';
import {disposeModel} from '../src/game.js';
const catalogue=await import('../src/cosmetics.js').catch(e=>{if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;return {};});
function signature(model,colour=false) {
  const rows=[]; model.traverse(o=>{if(o.isMesh)rows.push([o.position.toArray(),o.scale.toArray(),o.rotation.toArray(),o.geometry.type,...(colour?[o.material.color.getHexString()]:[])]);});
  return rows;
}
test('every fixed reward names an immutable usable appearance while originals stay free',()=>{
  assert.equal(SKINS.length,16); assert.equal(catalogue.GUN_FINISHES.length,9);
  for(const reward of REWARDS){
    const appearance=reward.kind==='skin'?getSkin(reward.id):catalogue.getGunFinish(reward.id);
    assert.equal(appearance.name,reward.name); assert.equal(Object.isFrozen(appearance),true);
    assert.equal(Object.isFrozen(appearance.palette),true);
    assert.equal(ownsCosmetic(0,reward.kind,reward.id),false);
    assert.equal(ownsCosmetic(8400,reward.kind,reward.id),true);
  }
  assert.equal(catalogue.getGunFinish('standard').palette,null);
  for(const bad of [null,'missing','__proto__',{}]) {
    assert.throws(()=>catalogue.getGunFinish(bad),RangeError);
    assert.throws(()=>createWeaponModel(THREE,WEAPONS[0],{finishId:bad}),RangeError);
    assert.throws(()=>createAvatarModel(THREE,{skinId:'ranger',heldItem:'knife',finishId:bad}),RangeError);
  }
});

test('all finishes preserve geometry and ownership across every gun',()=>{
  assert.ok(catalogue.GUN_FINISHES);
  const before=JSON.stringify(WEAPONS);
  for(const weapon of WEAPONS){
    const standard=createWeaponModel(THREE,weapon), looks=new Set();
    for(const finish of catalogue.GUN_FINISHES){
      const a=createWeaponModel(THREE,weapon,{finishId:finish.id}), b=createWeaponModel(THREE,weapon,{finishId:finish.id});
      assert.deepEqual(signature(a),signature(standard),weapon.id+'/'+finish.id);
      if(finish.id==='standard')assert.deepEqual(signature(a,true),signature(standard,true));
      looks.add(JSON.stringify(signature(a,true)));
      let affected=false; const others=new Set(); b.traverse(o=>{if(o.material){others.add(o.material);o.material.addEventListener('dispose',()=>{affected=true;});}});
      a.traverse(o=>{if(o.material)assert.equal(others.has(o.material),false);});
      disposeModel(a); assert.equal(affected,false); disposeModel(b);
    }
    assert.equal(looks.size,9,weapon.id+' should show every finish'); disposeModel(standard);
  }
  assert.equal(JSON.stringify(WEAPONS),before);
});

test('new avatar combinations keep shared hitboxes, four readable badges and isolated knife colours',()=>{
  assert.equal(SKINS.length,16);
  const looks=new Set();
  for(const skin of SKINS) for(const teamId of [null,'red','blue']){
    const a=createAvatarModel(THREE,{skinId:skin.id,teamId,finishId:'gold'});
    assert.equal(a.userData.hitbox,AVATAR_HITBOX); assert.equal(a.userData.finishId,'gold');
    assert.throws(()=>{a.userData.hitbox.height=10;},TypeError);
    assert.ok(a.getObjectByName('headgear').children.length); assert.ok(a.getObjectByName('accessory').children.length);
    if(teamId===null)looks.add(JSON.stringify(signature(a,true)));
    else {
      a.updateMatrixWorld(true);
      for(const [origin,direction] of [[[0,1.25,3],[0,0,-1]],[[0,1.25,-3],[0,0,1]],[[3,1.25,.02],[-1,0,0]],[[-3,1.25,.02],[1,0,0]]]){
        const hit=new THREE.Raycaster(new THREE.Vector3(...origin),new THREE.Vector3(...direction)).intersectObject(a,true)[0];
        assert.equal(hit.object.name,'team-marker',skin.id+'/'+teamId); assert.equal(hit.object.material.color.getHex(),teamId==='red'?0xff4141:0x3185ff);
      }
    }
    const k1=createAvatarModel(THREE,{skinId:skin.id,teamId,heldItem:'knife'}),k2=createAvatarModel(THREE,{skinId:skin.id,teamId,heldItem:'knife',finishId:'gold'});
    assert.deepEqual(signature(k1,true),signature(k2,true));
    const gun=a.getObjectByName('weapon').children[0],reference=createWeaponModel(THREE,WEAPONS.find(w=>w.id==='m4a1'),{finishId:'gold'});
    assert.deepEqual(signature(gun,true),signature(reference,true));
    for(const model of [a,k1,k2,reference])disposeModel(model);
  }
  assert.equal(looks.size,16);
});
