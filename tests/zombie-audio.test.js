import test from 'node:test';
import assert from 'node:assert/strict';
import { GameAudio } from '../src/audio.js';

test('wave and recovery cues synthesize distinct short tones', () => {
  const audio=new GameAudio(),calls=[];
  audio.tone=(...args)=>calls.push(args);
  audio.zombieWave(); const wave=calls.splice(0);
  audio.zombieRecovery(); const recovery=calls.splice(0);
  assert.ok(wave.length && recovery.length);
  assert.notDeepEqual(wave,recovery);
  assert.ok([...wave,...recovery].every(c=>c[1] <= .5));
});
test('zombie cues are safe when muted, suspended or no audio context is available', () => {
  const audio=new GameAudio();
  assert.doesNotThrow(()=>{ audio.zombieWave(); audio.zombieRecovery(); });
  let created=0;
  audio.context={ state:'running',createOscillator(){ created++; throw new Error('audio must be disabled'); } };
  audio.enabled=false;
  assert.doesNotThrow(()=>{ audio.zombieWave(); audio.zombieRecovery(); });
  audio.context.state='suspended'; audio.enabled=true;
  assert.doesNotThrow(()=>{ audio.zombieWave(); audio.zombieRecovery(); });
  assert.equal(created,0);
});
