import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const expression=html.match(/const _badge=([\s\S]*?);\n/)[1];
const badgeFor=new Function('_dAway',`return (${expression});`);
function luminance(hex){const values=hex.replace('#','').match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=0.04045?x/12.92:((x+0.055)/1.055)**2.4);return values[0]*0.2126+values[1]*0.7152+values[2]*0.0722;}
test('every rendered date badge meets small-text contrast on its actual solid background',()=>{
 for(const day of [-4,0,1,3,6]){const badge=badgeFor(day);assert(badge);assert.match(badge.bg,/^#[0-9a-f]{6}$/i);const ratio=1.05/(luminance(badge.bg)+0.05);assert(ratio>=4.5,`${badge.l}: ${ratio}`);}
 assert.equal(badgeFor(8),null);
});
