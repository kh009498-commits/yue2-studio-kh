import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const exports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/radioFilters.ts', 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText, {exports, Intl});
const {filterRadioSongs, emptyRadioFilters, radioFilterOptions, loadRadioFilters, radioLanguage} = exports;
const songs = [
  {id:'a',title:'A',genre:' Jazz ',lyrics_language:'en',instrumental:false},
  {id:'b',title:'B',genre:'Soul',lyrics_language:'es',instrumental:false},
  {id:'c',title:'C',genre:'JAZZ',lyrics_language:'en',instrumental:true},
  {id:'d',title:'D',genre:'Metal',lyrics_language:'ja',instrumental:false},
  {id:'e',title:'E',genre:'',lyrics_language:'',instrumental:false},
];
const ids = (filters, pool=songs) => Array.from(filterRadioSongs(pool, {...emptyRadioFilters(), ...filters}), song=>song.id);
assert.deepEqual(ids({}), ['a','b','c','d','e']);
assert.deepEqual(ids({genres:['jazz','soul'],languages:['en','es'],kinds:['vocal']}), ['a','b'], 'OR within groups, AND across groups');
assert.deepEqual(ids({genres:['jazz'],kinds:['instrumental']}), ['c']);
assert.deepEqual(ids({languages:['en']}), ['a'], 'instrumental metadata must not masquerade as sung English');
assert.deepEqual(ids({languages:['__instrumental__']}), ['c']);
assert.deepEqual(ids({genres:['__unknown__'],languages:['__unknown__']}), ['e']);
assert.deepEqual(ids({genres:['jazz'],languages:['ja']}), [], 'empty combination never falls back to all songs');
assert.deepEqual(ids({genres:['jazz'],kinds:['vocal','instrumental']}), ['a','c']);
assert.deepEqual(ids({genres:['jazz']}, songs.slice(1)), ['c'], 'source subset remains respected');
assert.deepEqual(ids({search:'  METAL '}), ['d']);
assert.equal(radioLanguage({...songs[0],lyrics_language:'pt_BR'}), 'pt-br');
assert.equal(radioFilterOptions(songs,'genre').find(item=>item.value==='jazz').count, 2, 'case and whitespace collapse duplicate choices');
assert.equal(radioFilterOptions(songs,'language').find(item=>item.value==='en').label, 'English');
const saved={genres:['jazz','soul'],languages:['en'],kinds:['vocal'],search:'A'};
assert.equal(JSON.stringify(loadRadioFilters(JSON.stringify(saved))), JSON.stringify(saved));
assert.equal(JSON.stringify(loadRadioFilters('bad')), JSON.stringify(emptyRadioFilters()));
assert.deepEqual(Array.from(loadRadioFilters('{"kinds":["wrong","vocal"],"genres":[5,"jazz"]}').genres), ['jazz']);
console.log('PASS Radio multi-choice intersections, source boundaries, missing metadata, instrumental language, normalization, saved settings and empty matches.');
