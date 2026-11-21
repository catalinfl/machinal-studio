import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { compileComponent } from './render.mjs';
import { inspectEvidence } from './evidence.mjs';

test('authored pulse handoff uses sampled state and matching real object bounds without caption-band changes', {timeout:60000}, async () => {
  const previous = process.env.SCENE_BROWSER;
  process.env.SCENE_BROWSER ||= chromium.executablePath();
  try {
    const config = {width:960,height:540,fps:30,durationInFrames:60,visualMode:'2d',captionSafeBottom:0.24};
    const outgoing = await readFile(new URL('./fixtures/handoff/outgoing.svelte',import.meta.url),'utf8');
    const incoming = await readFile(new URL('./fixtures/handoff/incoming.svelte',import.meta.url),'utf8');
    await compileComponent({component:outgoing,config,parameters:{signal:{}},inspectLayout:true});
    const source = await inspectEvidence({component:outgoing,config,parameters:{signal:{}},frames:[59,0]});
    const pose = source.frames[0].states.signal;
    assert.equal(pose.x,630);
    await compileComponent({component:incoming,config,parameters:{receiver:pose},inspectLayout:true});
    const target = await inspectEvidence({component:incoming,config,parameters:{receiver:pose},frames:[59,0,6]});
    assert.deepEqual(target.frames[1].states.receiver,pose);
    for (const field of ['x','y','width','height','opacity']) assert.equal(target.frames[1].objects[0][field],source.frames[0].objects[0][field],field);
    assert.notEqual(target.frames[0].states.receiver.x,pose.x);
    assert.ok([...source.frames,...target.frames].every(frame => frame.hasForeground && frame.issues.length === 0));
    const repeated = await inspectEvidence({component:incoming,config,parameters:{receiver:pose},frames:[0]});
    assert.equal(repeated.frames[0].data,target.frames[1].data);
  } finally {
    if (previous === undefined) delete process.env.SCENE_BROWSER;
    else process.env.SCENE_BROWSER = previous;
  }
});
