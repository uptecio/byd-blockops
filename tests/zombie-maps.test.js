import test from 'node:test';
import assert from 'node:assert/strict';
import { MAPS } from '../src/maps.js';
import { canOccupyBody } from '../src/spatial.js';
import { createHeadlessGame, cleanupGame } from './helpers/game-fixture.js';

for(const map of MAPS) test(`${map.id}: production spawn, pursuit, elimination and recovery complete wave one`, t=>{
  const game=createHeadlessGame(); t.after(()=>cleanupGame(game)); game.start('m4a1',{ modeId:'zombies',mapId:map.id });
  game.player.protected=1000;
  for(let steps=0;steps<100 && game.modeState.phase==='fighting';steps++) {
    game.update(.1);
    for(const z of game.bots) {
      assert.ok(canOccupyBody(z.model.position,.4,1.84,game.world.spatial));
      assert.ok(game.navigation.nextApproachWaypoint(z.model.position,game.player,.34));
      game.damageActor('local',z,100);
    }
    game.zombieRuntime.finishStep();
  }
  assert.equal(game.modeState.phase,'recovery'); assert.equal(game.modeState.completedWaves,1);
  assert.equal(game.modeState.kills,5); assert.equal(game.bots.length,0);
  assert.equal(game.world.botGroup.children.length,0); assert.equal(game.lootState.drops.length,0);
});
