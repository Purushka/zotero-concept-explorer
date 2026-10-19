import test from 'node:test';
import assert from 'node:assert/strict';
import {readFloatingPosition, floatingBounds, fitFloatingPosition, encodeFloatingPosition,
  restoreFloatingPosition} from '../src/floating-geometry.mjs';
const bounds = {left:12, top:92, right:748, bottom:778};
test('release docks to each of the four edges without moving the other axis', () => {
  for (const [input, expected] of [
    [{left:20,top:300},{left:12,top:300}], [{left:730,top:300},{left:748,top:300}],
    [{left:350,top:110},{left:350,top:92}], [{left:350,top:760},{left:350,top:778}],
  ]) assert.deepEqual(fitFloatingPosition(input,bounds,{snap:true}),expected);
});
test('moving does not attract to edges before release, and distant positions stay free', () => {
  assert.deepEqual(fitFloatingPosition({left:20,top:300},bounds),{left:20,top:300});
  assert.deepEqual(fitFloatingPosition({left:350,top:350},bounds,{snap:true}),{left:350,top:350});
  assert.equal(fitFloatingPosition({left:37,top:300},bounds,{snap:true}).left,37);
  assert.equal(fitFloatingPosition({left:36,top:300},bounds,{snap:true}).left,12);
});
test('corners snap along both axes, including negative and offscreen coordinates', () => {
  assert.deepEqual(fitFloatingPosition({left:-100,top:-100},bounds,{snap:true}),{left:12,top:92});
  assert.deepEqual(fitFloatingPosition({left:9999,top:9999},bounds,{snap:true}),{left:748,top:778});
});
test('bounds reserve the native tab bar and allow dragging back from a narrow viewport', () => {
  assert.deepEqual(floatingBounds({width:1200,height:1400,top:80},{width:440,height:610}),bounds);
  const narrow=floatingBounds({width:300,height:220,top:80},{width:500,height:610});
  assert.equal(narrow.right,narrow.left);assert.equal(narrow.bottom,narrow.top);
  assert.deepEqual(fitFloatingPosition({left:999,top:-100},narrow),{left:12,top:92});
});
test('saved normalized positions retain docking after resize and restore center positions', () => {
  for(const point of [{left:12,top:92},{left:748,top:778},{left:380,top:435}]) {
    const saved=encodeFloatingPosition(point,bounds);
    assert.deepEqual(restoreFloatingPosition(JSON.stringify(saved),bounds),point);
  }
  const saved=encodeFloatingPosition({left:748,top:778},bounds),small={left:12,top:72,right:400,bottom:220};
  assert.deepEqual(restoreFloatingPosition(saved,small),{left:400,top:220});
  assert.deepEqual(saved,{version:1,x:1,y:1});
});
test('bad or future preferences are ignored rather than moving the title bar offscreen', () => {
  for(const value of [undefined,null,'{','null',[],{}, {version:2,x:1,y:1},
    {version:1,x:NaN,y:1},{version:1,x:Infinity,y:1},{version:1,x:-0.1,y:1},
    {version:1,x:1,y:1.1},{version:1,x:'1',y:1}]) {
    assert.equal(readFloatingPosition(value),null);
    assert.deepEqual(restoreFloatingPosition(value,bounds),{left:748,top:778});
  }
});
test('zero travel dimensions persist finite values and choose the nearer edge', () => {
  const tight={left:12,top:92,right:12,bottom:92};
  assert.deepEqual(encodeFloatingPosition({left:12,top:92},tight),{version:1,x:0,y:0});
  const narrow={left:12,top:92,right:42,bottom:122};
  assert.deepEqual(fitFloatingPosition({left:32,top:112},narrow,{snap:true}),{left:42,top:122});
});
