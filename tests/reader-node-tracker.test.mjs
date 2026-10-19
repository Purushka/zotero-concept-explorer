import test from 'node:test';
import assert from 'node:assert/strict';
import {createReaderNodeTracker} from '../src/reader-node-tracker.mjs';

function fixture() {
  const dead=new WeakSet();
  const tracker=createReaderNodeTracker({isDeadWrapper:node=>dead.has(node)});
  function node({connected=true,throwsOnRead=false,throwsOnRemove=false}={}) {
    const state={connected,throwsOnRead,reads:0,removed:0};
    const value={
      get isConnected() { state.reads++;if(state.throwsOnRead)throw new TypeError("can't access dead object");return state.connected; },
      remove() { state.removed++;if(throwsOnRemove)throw new TypeError("can't access dead object");state.connected=false; }
    };
    return {value,state};
  }
  return {dead,tracker,node};
}

test('new Reader buttons are tracked before append even while detached',()=>{
  const {tracker,node}=fixture(),button=node({connected:false});
  tracker.track(button.value);
  assert.equal(tracker.size,1);assert.equal(button.state.reads,0);
  button.state.connected=true;tracker.removeAll();
  assert.equal(button.state.removed,1);assert.equal(tracker.size,0);
});

test('selection cleanup drops disconnected popups but keeps other open Readers',()=>{
  const {tracker,node}=fixture(),toolbar=node(),popup=node(),next=node();
  tracker.track(toolbar.value);tracker.track(popup.value);popup.state.connected=false;
  tracker.track(next.value);assert.equal(tracker.size,2);tracker.removeAll();
  assert.equal(toolbar.state.removed,1);assert.equal(popup.state.removed,0);assert.equal(next.state.removed,1);
});

test('known Gecko dead wrappers are discarded without reading isConnected',()=>{
  const {dead,tracker,node}=fixture(),old=node(),next=node();
  tracker.track(old.value);dead.add(old.value);old.state.throwsOnRead=true;
  assert.doesNotThrow(()=>tracker.track(next.value));
  assert.equal(old.state.reads,0);assert.equal(tracker.size,1);tracker.removeAll();
  assert.equal(old.state.removed,0);assert.equal(next.state.removed,1);
});

test('Reader destruction between dead-wrapper check and DOM access cannot block the new button',()=>{
  const {tracker,node}=fixture(),old=node(),next=node();
  tracker.track(old.value);old.state.throwsOnRead=true;
  const appended=[];
  assert.doesNotThrow(()=>{tracker.track(next.value);appended.push(next.value);});
  assert.deepEqual(appended,[next.value]);assert.equal(tracker.size,1);
  tracker.removeAll();assert.equal(next.state.removed,1);
});

test('a failing wrapper check is contained to the expired node',()=>{
  const old={},next={isConnected:true,remove(){}},tracker=createReaderNodeTracker({isDeadWrapper:node=>{if(node===old)throw new TypeError('expired wrapper');return false;}});
  tracker.track(old);assert.doesNotThrow(()=>tracker.track(next));assert.equal(tracker.size,1);
  tracker.removeAll();assert.equal(tracker.size,0);
});

test('many Reader close/reopen cycles do not retain destroyed buttons',()=>{
  const {dead,tracker,node}=fixture();let old;
  for(let round=0;round<100;round++){
    if(old){dead.add(old.value);old.state.throwsOnRead=true;}
    const next=node();tracker.track(next.value);assert.equal(tracker.size,1);old=next;
  }
  tracker.removeAll();assert.equal(old.state.removed,1);assert.equal(tracker.size,0);
});

test('tracking the same live node twice does not duplicate shutdown removal',()=>{
  const {tracker,node}=fixture(),button=node();
  tracker.track(button.value);tracker.track(button.value);assert.equal(tracker.size,1);
  tracker.removeAll();assert.equal(button.state.removed,1);
});

test('shutdown skips dead wrappers, continues after a destroyed-node error, and clears all references',()=>{
  const {dead,tracker,node}=fixture(),old=node(),racing=node({throwsOnRemove:true}),live=node();
  tracker.track(old.value);tracker.track(racing.value);tracker.track(live.value);dead.add(old.value);
  assert.doesNotThrow(()=>tracker.removeAll());assert.equal(old.state.removed,0);
  assert.equal(racing.state.removed,1);assert.equal(live.state.removed,1);assert.equal(tracker.size,0);
  tracker.removeAll();assert.equal(live.state.removed,1);
});
