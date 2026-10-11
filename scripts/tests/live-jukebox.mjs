import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from '../../node_modules/typescript/lib/typescript.js';

const compile = source => ts.transpileModule(source, {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX}}).outputText;
function loadPure(globals={}) {
 const exports={}; vm.runInNewContext(compile(fs.readFileSync('src/liveJukebox.ts','utf8')), {exports, setTimeout, clearTimeout, ...globals}); return exports;
}
const {LiveJukebox, liveFailureReason, playableSong, withLiveDeadline, LIVE_STORAGE_KEY}=loadPure();
const song = id => ({id,title:id,folder_name:id,audio_url:`/api/library/${id}/audio`,duration:60,instrumental:true,genre:'Jazz'});
const ids = list => Array.from(list);
assert.equal(liveFailureReason('HTTP 402 RESOURCE_EXHAUSTED: prepayment credits depleted KEYSECRET','writing'),'credits');
assert.equal(liveFailureReason('429 too many requests','writing'),'rate-limit');
assert.equal(liveFailureReason(new Error('timeout'),'connection'),'timeout');
assert.equal(liveFailureReason('unrelated private response','generation'),'generation');
assert.equal(playableSong({...song('bad'),duration:0}),false);
assert.equal(playableSong({...song('bad'),audio_url:'https://external/audio'}),false);
assert.equal(playableSong({...song('ok'),duration:undefined}),true);
let rngSeed=1234; const random=()=>((rngSeed=(rngSeed*1664525+1013904223)>>>0)/2**32);
const radio=new LiveJukebox(null,random); const pool=['a','b','c','d','e'].map(song);
const selections=[];
for(let i=0;i<100;i++){ const next=radio.draw(pool,1)[0]; radio.played(next);selections.push(next); }
for(let i=0;i<100;i+=5)assert.equal(new Set(selections.slice(i,i+5)).size,5,'one visit per complete cycle');
for(let i=1;i<100;i++)assert.notEqual(selections[i],selections[i-1],'no immediate repeat across cycles');
const queued=new LiveJukebox(null,random);queued.reserve(['a','b']);
assert.deepEqual(new Set(queued.draw(pool,10,['a','b'],'b')),new Set(['c','d','e']));
const single=new LiveJukebox(); assert.deepEqual(ids(single.draw([song('a')],5)),['a']);
assert.deepEqual(ids(single.draw([song('a')],5,['a'])),[]);
assert.deepEqual(ids(single.draw([song('a')],1,[],'a')),['a']);
single.block('a'); assert.deepEqual(ids(single.draw([song('a')],1)),[]);
const empty=new LiveJukebox(); assert.deepEqual(ids(empty.draw([],5)),[]);
radio.draw(pool,1);radio.pause('credits');assert.equal(radio.pause('generation'),false);assert.equal(radio.state.reason,'credits');
const restored=new LiveJukebox(radio.snapshot(),random);assert.equal(restored.state.paused,true);
assert.deepEqual(ids(restored.draw(pool,1)),ids(radio.draw(pool,1)),'saved pool order survives reload');
assert.ok(!restored.snapshot().includes('KEYSECRET'));
restored.resume();assert.equal(restored.state.paused,false);
const changed=new LiveJukebox(null,random);changed.draw([song('a')],1);assert.deepEqual(ids(changed.draw([song('b')],1)),['b']);
await assert.rejects(withLiveDeadline(new Promise(()=>{}),2),/timeout/);
assert.equal(await withLiveDeadline(Promise.resolve(42),100),42);
console.log('PASS shuffle cycles, boundary, reservations, single/empty pools, deleted/invalid media, persistent pause, redacted reasons and deadlines');

// Render the real LivePage with deterministic hooks, promises and a virtual clock.
// No browser, sidecar, provider or GPU calls are made.
const raw=fs.readFileSync('src/LivePage.tsx','utf8');
function loadSelection(pure) { const exports={};vm.runInNewContext(compile(fs.readFileSync('src/liveSelection.ts','utf8')),{exports,require:()=>pure});return exports; }
function loadNight() { const exports={};vm.runInNewContext(compile(fs.readFileSync('src/nightPresets.ts','utf8')),{exports,require:()=>({default:'bundled.webp'})});return exports; }
const pageCode=compile(raw.replace('import.meta.glob("./assets/voices/*.webp", { eager: true, import: "default" })','({})'));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
function fixture(options={}) {
 let slots=[],cursor=0,dirty=true,pendingEffects=[],tree,now=0,id=0;
 const timers=new Map(),storage=new Map(options.storage||[]),events=[],generatedBodies=[],writingBodies=[],calls={writing:0,generation:0,poll:0};
 const hooks={
  useRef(value){const i=cursor++;return slots[i]||(slots[i]={current:value})},
  useState(initial){const i=cursor++;if(!slots[i])slots[i]={value:typeof initial==='function'?initial():initial};return [slots[i].value,value=>{const next=typeof value==='function'?value(slots[i].value):value;if(!Object.is(next,slots[i].value)){slots[i].value=next;dirty=true}}]},
  useMemo(fn,deps){const i=cursor++;if(!slots[i]||deps.some((d,n)=>!Object.is(d,slots[i].deps[n])))slots[i]={value:fn(),deps};return slots[i].value},
  useEffect(fn,deps){const i=cursor++;if(!slots[i]||deps.some((d,n)=>!Object.is(d,slots[i].deps[n]))){pendingEffects.push(()=>{slots[i]?.cleanup?.();slots[i]={deps,cleanup:fn()}})}},
 };
 const time={setInterval(fn,delay){const k=++id;timers.set(k,{fn,delay,at:now+delay,repeat:true});return k},clearInterval(k){timers.delete(k)},setTimeout(fn,delay){const k=++id;timers.set(k,{fn,delay,at:now+delay,repeat:false});return k},clearTimeout(k){timers.delete(k)}};
 let library=options.songs||[song('a'),song('b'),song('c'),song('d'),song('e')];
 let nextJob={id:'job',kind:'yue2',status:'running',progress:.5};
 const api={
  assistWriting(body){writingBodies.push(body);calls.writing++;return options.write?options.write(body,calls.writing):Promise.resolve({title:'new',lyrics:'[Verse] words'})},
  generate(body){generatedBodies.push(body);calls.generation++;return options.generate?options.generate(body):Promise.resolve({job:nextJob})},
  getJob(){calls.poll++;return options.poll?options.poll():Promise.resolve({job:nextJob})},
  getStatus:async()=>({jobs:options.resumeJobs||[]}),getLibrary:async()=>({items:library}),getVoiceProfiles:async()=>({items:[]}),abortWriting:async()=>({ok:true}),
  recordLiveEvent:async(event,reason)=>{events.push({event,reason});return {ok:true}},voiceAvatarUrl:()=>'',
 };
 const jsx=(type,props,key)=>({type,props:props||{},key});
 let seed=1234;const math=Object.create(Math);math.random=()=>((seed=(seed*1664525+1013904223)>>>0)/2**32);
 const pure=loadPure({setTimeout:time.setTimeout,clearTimeout:time.clearTimeout,Math:math});
 const imports={'react':hooks,'react/jsx-runtime':{jsx,jsxs:jsx},'./api':api,'./liveJukebox':pure,'./liveSelection':loadSelection(pure),
  './createForm':{EMPTY_VOICE_SLOTS:{}},'./liveCast':{CAST_ROLL:[],castHint:()=>'',randomCast:()=> options.cast||'instrumental',randomSlots:()=>({female:'',male:''}),reelVoices:()=>({a:'',b:''}),vocalGenderFor:()=> 'auto'},
  './SongVisualizer':{default:'PLAYER'},'./EqPanel':{default:'EQ'},'./useAutoEq':{default:()=>({displayGains:[]})}};
 const exports={};
 const context={exports,require:name=>imports[name]||{default:''},window:{...time,location:{origin:'http://localhost'}},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},Date:{now:()=>now},Math:math,Promise,setTimeout:time.setTimeout,clearTimeout:time.clearTimeout};
 vm.runInNewContext(pageCode,context);
 const props={ready:true,presets:options.presets||{Jazz:{genre:'Jazz',mood:'calm'}},art:options.art||{},songs:library,coverSources:{},onLeaveLibraryPlay(){},onRefresh:async()=>{},onAnalyserChange(){},onPlaybackChange(){},onCurrentChange(){}};
 function render(){let n=0;while(dirty){assert.ok(++n<100,'render settles');dirty=false;cursor=0;tree=exports.default(props);const effects=pendingEffects;pendingEffects=[];effects.forEach(fn=>fn())}}
 async function settle(){for(let i=0;i<20;i++){await Promise.resolve();render()}}
 function nodes(type,node=tree,out=[]){if(node==null)return out;if(Array.isArray(node)){node.forEach(n=>nodes(type,n,out));return out}if(typeof node==='object'){if(node.type===type)out.push(node);if(node.props?.children!=null)nodes(type,node.props.children,out)}return out}
 async function click(label){const button=nodes('button').find(n=>n.props.children===label);assert.ok(button,`button ${label}`);assert.ok(!button.props.disabled,`${label} enabled`);button.props.onClick();await settle()}
 async function tick(ms){const end=now+ms;let n=0;while(true){const due=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;assert.ok(++n<1000);now=due[1].at;if(due[1].repeat)due[1].at+=due[1].delay;else timers.delete(due[0]);due[1].fn();await settle()}now=end;await settle()}
 render();
 async function change(label,value){const node=nodes('input').find(n=>n.props['aria-label']===label);assert.ok(node,`control ${label}`);node.props.onChange({target:{checked:value,value}});await settle()}
 return {calls,events,generatedBodies,writingBodies,storage,settle,click,change,tick,nodes,player:()=>nodes('PLAYER')[0],text:()=>JSON.stringify(tree),setPresets(value){props.presets=value;dirty=true;render()},setJob(job){nextJob=job},setLibrary(items){library=items;props.songs=items;dirty=true;render()},props};
}
const credit=deferred();const f=fixture({write:()=>credit.promise});await f.click('Start live');const initial=f.player();assert.ok(initial);
await f.tick(1200);assert.equal(f.calls.writing,1);
credit.reject(new Error('HTTP402 RESOURCE_EXHAUSTED prepayment credits depleted KEYSECRET signed-url=https://private'));
await f.settle();assert.equal(f.player().key,initial.key,'fallback keeps current player mounted');
assert.equal(f.player().props.src,initial.props.src);assert.ok(f.text().includes('Jukebox'));assert.ok(!f.text().includes('KEYSECRET'));assert.ok(!f.text().includes('RESOURCE_EXHAUSTED'));
await f.tick(120000);assert.equal(f.calls.writing,1,'no paid retry storm');assert.equal(f.calls.generation,0);
assert.deepEqual(f.events[0],{event:'paused',reason:'credits'});
await f.click('Resume generation');await f.tick(1200);assert.equal(f.calls.writing,2,'only explicit resume requests writing again');
const restarted=fixture({storage:f.storage}); // resumed state is allowed to generate
const pausedAgain=fixture({storage:[[LIVE_STORAGE_KEY,JSON.stringify({version:1,paused:true,reason:'credits',bag:['b','c'],seen:['a'],played:['a'],blocked:[],last:'a'})]]});
await pausedAgain.click('Start live');await pausedAgain.tick(60000);assert.equal(pausedAgain.calls.writing,0,'restart preserves generation pause');assert.ok(pausedAgain.player());
const prefetch=deferred();const running=fixture({write:(_,n)=>n===1?Promise.resolve({title:'new'}):prefetch.promise});
await running.click('Start live');await running.tick(1200);assert.equal(running.calls.generation,1);running.player().props.onEnded();await running.settle();running.player().props.onEnded();await running.settle();assert.equal(running.calls.writing,2);
const playing=running.player();prefetch.reject(new Error('402 RESOURCE_EXHAUSTED'));await running.settle();assert.equal(running.player().key,playing.key);
running.setLibrary([...running.props.songs,song('new')]);running.setJob({id:'job',kind:'yue2',status:'succeeded',progress:1,result:{folder_name:'new'}});
await running.tick(2000);assert.ok(running.text().includes('GENERATED'),'in-flight completion joins queue even while paused');assert.equal(running.calls.generation,1);
await running.tick(60000);assert.equal(running.calls.writing,2);assert.equal(running.calls.generation,1);
const brokenId=running.player().props.src.split('/').at(-2);running.player().props.onPlaybackError();await running.settle();assert.notEqual(running.player()?.props.src,playing.props.src,'bad media advances');assert.ok(JSON.parse(running.storage.get(LIVE_STORAGE_KEY)).blocked.includes(brokenId));
const only=fixture({songs:[song('only')],storage:[[LIVE_STORAGE_KEY,JSON.stringify({version:1,paused:true,reason:'credits'})]]});await only.click('Start live');const before=only.player();before.props.onEnded();await only.settle();assert.ok(only.player());assert.notEqual(only.player().key,before.key,'single-song pool restarts audio');assert.equal(only.player().props.src,before.props.src);
const none=fixture({songs:[],storage:[[LIVE_STORAGE_KEY,JSON.stringify({version:1,paused:true,reason:'credits'})]]});await none.click('Start live');assert.equal(none.player(),undefined);assert.ok(none.text().includes('No eligible library audio'));assert.equal(none.calls.writing,0);
const failJob=fixture();await failJob.click('Start live');await failJob.tick(1200);failJob.setJob({id:'job',kind:'yue2',status:'failed',error:'PRIVATE generation failure',progress:0});await failJob.tick(2000);assert.ok(failJob.text().includes('Jukebox'));assert.ok(!failJob.text().includes('PRIVATE'));const writeCount=failJob.calls.writing;await failJob.tick(60000);assert.equal(failJob.calls.writing,writeCount);
const disconnected=fixture({poll:()=>Promise.reject(new Error('private connection error'))});await disconnected.click('Start live');await disconnected.tick(1200);await disconnected.tick(60000);assert.ok(disconnected.calls.poll<=3,'status recovery polling is bounded');assert.equal(disconnected.calls.generation,1);assert.ok(disconnected.text().includes('Jukebox'));
// A buffer the same size as the library must not force every cycle into
// the original queue order; verify real playback ordering across 12 cycles.
const cycling=fixture({storage:[[LIVE_STORAGE_KEY,JSON.stringify({version:1,paused:true,reason:'credits'})]]});
await cycling.click('Start live');const heard=[];
for(let i=0;i<60;i++){heard.push(cycling.player().props.src.split('/').at(-2));cycling.player().props.onEnded();await cycling.settle()}
for(let i=0;i<60;i+=5)assert.equal(new Set(heard.slice(i,i+5)).size,5,'ready queue still obeys cycle uniqueness');
for(let i=1;i<60;i++)assert.notEqual(heard[i],heard[i-1]);
assert.ok(new Set(Array.from({length:12},(_,i)=>heard.slice(i*5,i*5+5).join(','))).size>1,'new cycles are reshuffled');
const submitError=fixture({generate:()=>Promise.reject(new Error('SECRET submission failure'))});await submitError.click('Start live');const submitPlayer=submitError.player();await submitError.tick(1200);assert.equal(submitError.player().key,submitPlayer.key);assert.equal(submitError.events[0].reason,'generation');await submitError.tick(60000);assert.equal(submitError.calls.generation,1);assert.ok(!submitError.text().includes('SECRET'));
const slow=deferred();const timeout=fixture({write:()=>slow.promise});await timeout.click('Start live');await timeout.tick(182000);assert.ok(timeout.text().includes('Jukebox'));assert.equal(timeout.calls.writing,1);assert.ok(timeout.nodes('button').find(n=>n.props.children==='Resume generation').props.disabled);slow.resolve({title:'late'});await timeout.settle();assert.equal(timeout.calls.generation,0,'late lyrics cannot start generation after timeout');await timeout.click('Resume generation');await timeout.tick(1200);assert.equal(timeout.calls.generation,1);
const ambiguous=deferred();const late=fixture({generate:()=>ambiguous.promise});await late.click('Start live');await late.tick(122000);assert.equal(late.calls.generation,1);assert.ok(late.text().includes('Jukebox'));ambiguous.resolve({job:{id:'late',kind:'yue2',status:'running',progress:0}});await late.settle();await late.tick(60000);assert.equal(late.calls.generation,1,'late accepted POST is monitored, not retried');
const reconcile=fixture({resumeJobs:[{kind:'yue2',status:'running'}],storage:[[LIVE_STORAGE_KEY,JSON.stringify({version:1,paused:true,reason:'credits'})]]});await reconcile.click('Start live');await reconcile.click('Resume generation');await reconcile.tick(60000);assert.equal(reconcile.calls.writing,0,'resume reconciles active backend jobs before any new paid call');assert.ok(reconcile.text().includes('still finishing'));
const deleted=fixture({storage:[[LIVE_STORAGE_KEY,JSON.stringify({version:1,paused:true,reason:'credits'})]]});await deleted.click('Start live');const deletedCurrent=deleted.player();const removedId=deletedCurrent.props.src.split('/').at(-2);deleted.setLibrary([]);await deleted.settle();assert.equal(deleted.player().key,deletedCurrent.key,'library deletion preserves an already loaded current track');deleted.player().props.onEnded();await deleted.settle();assert.equal(deleted.player(),undefined);deleted.setLibrary([song('arrived')]);await deleted.settle();assert.ok(deleted.player()?.props.src.includes('arrived'),'empty station recovers when library audio arrives');assert.equal(deleted.calls.writing,0);
const app=fs.readFileSync('src/App.tsx','utf8');const operatorBoundary=app.indexOf('{studioView !== "live" && <>');assert.ok(operatorBoundary>app.indexOf('</main>'));assert.ok(operatorBoundary<app.indexOf('<Logs open='));assert.ok(operatorBoundary<app.indexOf('job-drawer'));assert.ok(operatorBoundary<app.indexOf('mcp-drawer'));assert.ok(app.lastIndexOf('</>}')>app.lastIndexOf('modal-backdrop'));
console.log('PASS real LivePage:402 pause/no retries, current audio retained, explicit resume, reload pause, prefetch race, in-flight completion, failed jobs, bounded polling, bad media, single/empty pools; full-app private overlay render boundary');






// Real saved-selection policy and real LivePage regressions.
const policy=loadSelection(loadPure());const night=loadNight().NIGHT_STYLE_PRESETS;
const calm={id:'calm',nightEligible:true,genre:'Gentle',mood:'calm'};
const hard={id:'hard',genre:'Heavy',mood:'forceful'};
const custom={id:'custom-stable',genre:'Custom',mood:'personal choice'};
const templates={Calm:calm,Metal:hard,'My custom template':custom,...night};
const known=(id,name,instrumental=true)=>({...song(id),genre:name,instrumental});
let settings=policy.loadLiveSelection();assert.equal(policy.selectedTemplates(templates,settings).length,Object.keys(templates).length);
settings.custom['custom-stable']=false;settings={...settings,mode:'night'};
assert.ok(policy.selectedTemplates(templates,settings).includes('Calm'));assert.ok(!policy.selectedTemplates(templates,settings).includes('Metal'));
assert.equal(policy.vocalPreference(settings),'prefer');assert.equal(policy.songEligible(known('unknown','Ambient and metal'),templates,settings),false,'no keyword guessing');
assert.equal(policy.songEligible({...known('id-first','Calm'),template_id:'hard'},templates,settings),false,'stable ID wins over optimistic genre label');
settings.approved.night.push('unknown');assert.equal(policy.songEligible(known('unknown',''),templates,settings),true);
settings.approved.night.push('metal');assert.equal(policy.songEligible(known('metal','Metal'),templates,settings),false,'approval cannot override exclusion');
const noneSettings=policy.selectTemplates(settings,templates,false);assert.equal(policy.selectedTemplates(templates,noneSettings).length,0);assert.equal(policy.songEligible(known('unknown',''),templates,noneSettings),false,'empty selection does not broaden via approval');
settings={...settings,mode:'custom'};assert.equal(policy.templateEnabled('Renamed custom',custom,settings),false,'custom stable ID survives renaming and profile switches');
assert.equal(policy.loadLiveSelection(JSON.stringify(settings)).custom['custom-stable'],false);assert.equal(policy.selectedTemplates(templates,policy.loadLiveSelection('broken')).length,0,'corrupt saved choices fail closed');
const nightStored=()=>[[policy.LIVE_SELECTION_KEY,JSON.stringify({...policy.loadLiveSelection(),mode:'night'})],[LIVE_STORAGE_KEY,JSON.stringify({version:1,paused:true,reason:'credits'})]];
const nightPool=[...Array.from({length:5},(_,i)=>known(`calm-${i}`,'Calm')),known('loud','Metal'),known('unknown','Quiet sounding name')];
const station=fixture({presets:templates,songs:nightPool,storage:nightStored()});await station.click('Start live');const heardNight=[];
for(let i=0;i<25;i++){const id=station.player().props.src.split('/').at(-2);heardNight.push(id);assert.ok(id.startsWith('calm-'),'excluded/unknown songs never enter startup or fallback');station.player().props.onEnded();await station.settle()}
for(let i=0;i<25;i+=5)assert.equal(new Set(heardNight.slice(i,i+5)).size,5,'filtered jukebox remains repeat-free per cycle');
assert.ok(station.nodes('input').some(n=>n.props['aria-label']==='Allow My custom template'),'custom definition remains available');
await station.change('Approve unknown',true);assert.ok(JSON.parse(station.storage.get(policy.LIVE_SELECTION_KEY)).approved.night.includes('unknown'));
const savedStation=fixture({presets:templates,songs:nightPool,storage:station.storage});await savedStation.click('Start live');assert.ok(savedStation.text().includes('Night / Chill'));assert.equal(savedStation.calls.writing,0);assert.ok(!savedStation.player().props.src.includes('/loud/'));
const oldCurrent=station.player();await station.click('Select none');assert.equal(station.player().key,oldCurrent.key,'selection changes leave the current audio mounted');assert.ok(station.nodes('button').find(n=>n.props.children==='Resume generation').props.disabled);station.player().props.onEnded();await station.settle();assert.equal(station.player(),undefined,'all-excluded station stops future audio honestly');await station.tick(60000);assert.equal(station.calls.writing,0);
const emptySelection=fixture({presets:templates,songs:nightPool,storage:[[policy.LIVE_SELECTION_KEY,JSON.stringify(policy.selectTemplates(policy.loadLiveSelection(),templates,false))]]});assert.ok(emptySelection.nodes('button').find(n=>n.props.children==='Start live').props.disabled);await emptySelection.tick(60000);assert.equal(emptySelection.calls.writing,0);
const unknownOnly=fixture({presets:templates,songs:[known('mystery','')],storage:nightStored()});await unknownOnly.click('Start live');assert.equal(unknownOnly.player(),undefined);assert.ok(unknownOnly.text().includes('No eligible library audio'));assert.equal(unknownOnly.calls.writing,0);
await unknownOnly.change('Approve mystery',true);assert.ok(unknownOnly.player(),'explicitly approved unknown song can play without broadening');
const writing=deferred();const pendingEdit=fixture({presets:templates,songs:nightPool,write:()=>writing.promise});await pendingEdit.click('Start live');await pendingEdit.tick(1200);await pendingEdit.click('Select none');writing.resolve({title:'obsolete'});await pendingEdit.settle();assert.equal(pendingEdit.calls.generation,0,'an in-flight writing result cannot submit an excluded template');
const vocalSettings={...policy.loadLiveSelection(),mode:'night',nightVoices:'only'};
assert.equal(policy.songEligible(known('singer','Calm',false),templates,vocalSettings),false);vocalSettings.nightVoices='mixed';assert.equal(policy.songEligible(known('singer','Calm',false),templates,vocalSettings),true,'Night supports vocals when requested');
const generating=fixture({presets:templates,songs:nightPool,storage:[[policy.LIVE_SELECTION_KEY,JSON.stringify({...policy.loadLiveSelection(),mode:'night',nightVoices:'only'})]]});await generating.click('Start live');await generating.tick(1200);assert.equal(generating.calls.generation,1);assert.ok(generating.generatedBodies[0].template_id);assert.equal(generating.generatedBodies[0].instrumental,true);assert.ok(generating.generatedBodies[0].description.includes('no loud percussion'));assert.ok(generating.generatedBodies[0].exclude_styles.includes('distorted guitars'));
await generating.change('Allow Calm',false);generating.setLibrary([...nightPool,known('later-loud','Metal')]);generating.setJob({id:'job',kind:'yue2',status:'succeeded',progress:1,result:{folder_name:'later-loud'}});await generating.tick(2000);assert.ok(!generating.nodes('div').filter(n=>String(n.props.className).includes('live-queue-row')).some(n=>JSON.stringify(n).includes('later-loud')),'a completed excluded song is not queued');
const all=fixture({presets:templates,songs:nightPool,storage:nightStored()});await all.click('Select all');assert.equal(all.nodes('input').filter(n=>String(n.props['aria-label']).startsWith('Allow ')&&n.props.checked).length,Object.keys(templates).length,'Night choices remain editable');await all.click('My custom selection');assert.ok(all.nodes('input').some(n=>n.props['aria-label']==='Allow My custom template'&&n.props.checked),'profile switching preserves custom choices');
const switching=fixture({presets:templates,songs:nightPool,storage:[[LIVE_STORAGE_KEY,JSON.stringify({version:1,paused:true,reason:'credits'})]]});await switching.click('Start live');const switchPlayer=switching.player();await switching.click('Night / Chill');assert.equal(switching.player().key,switchPlayer.key);const future=switching.nodes('div').filter(n=>String(n.props.className).startsWith('live-queue-row')).slice(1);assert.ok(future.every(row=>!JSON.stringify(row).includes('loud')&&!JSON.stringify(row).includes('unknown')),'Night prunes harsh and unclassified upcoming songs');
await switching.click('My custom selection');await switching.change('Approve unknown',true);await switching.click('Night / Chill');assert.equal(JSON.parse(switching.storage.get(policy.LIVE_SELECTION_KEY)).approved.night.includes('unknown'),false,'custom approval does not silently authorize Night audio');
await switching.click('Select none');await switching.click('Reset Night preset');assert.ok(switching.nodes('input').some(n=>n.props['aria-label']==='Allow Ambient cloud pads'&&n.props.checked));assert.ok(switching.nodes('input').some(n=>n.props['aria-label']==='Allow Metal'&&!n.props.checked));
const vocals={...policy.selectTemplates({...policy.loadLiveSelection(),mode:'night'},templates,false),night:{calm:true},nightVoices:'mixed'};
const gentleVocal=fixture({presets:templates,songs:nightPool,cast:'female',storage:[[policy.LIVE_SELECTION_KEY,JSON.stringify(vocals)]]});await gentleVocal.click('Start live');await gentleVocal.tick(1200);assert.equal(gentleVocal.generatedBodies[0].instrumental,false,'editable Night mode can generate gentle vocals');assert.equal(gentleVocal.generatedBodies[0].genre,'Calm');
assert.ok(policy.templateId('Very long '+ '日本語'.repeat(200),{}).length<=240,'stable long custom IDs fit the backend metadata contract');
console.log('PASS Night selections: persistent stable IDs/custom choices, all/none, conservative unknown approval, generation/initial queue/fallback filtering, in-flight edits, filtered shuffle cycles, instrumental preference and quiet prompts');
// Exercise the real audio effect against missing/corrupt/slow files. A late
// fetch after a skipped timeout must never play an abandoned element.
const visualizer=fs.readFileSync('src/SongVisualizer.tsx','utf8');
const mediaStart=visualizer.indexOf('  useEffect(() => {\n    const element = audio.current; const surface');
const mediaEnd=visualizer.indexOf('  }, [src]);',mediaStart)+'  }, [src]);'.length;
const mediaCode=ts.transpile(visualizer.slice(mediaStart,mediaEnd),{target:ts.ScriptTarget.ES2022});
async function mediaFixture(fetchResponse) {
 let cleanup,errorCount=0,playCount=0,timer,blobs=0;
 const listeners=new Map();const element={addEventListener(name,fn){listeners.set(name,fn)},removeEventListener(name){listeners.delete(name)},play(){playCount++;return Promise.resolve()},pause(){},removeAttribute(){},load(){}};
 const context={useEffect(fn){cleanup=fn()},audio:{current:element},canvas:{current:{getContext:()=>null,clientWidth:100,clientHeight:60}},src:'http://localhost/api/library/a/audio',eqGainsRef:{current:[]},filters:{current:[]},eqPreamp:{current:null},playbackErrorRef:{current:()=>errorCount++},window:{setTimeout(fn){timer=fn;return 1},clearTimeout(){timer=null},devicePixelRatio:1},requestAnimationFrame:()=>1,cancelAnimationFrame(){},AbortController,URL:{createObjectURL(){blobs++;return 'blob:audio'},revokeObjectURL(){}},fetch:()=>fetchResponse,onAnalyser(){},onPlayingChange(){}};
 vm.runInNewContext(mediaCode,context);for(let i=0;i<10;i++)await Promise.resolve();
 return {get errors(){return errorCount},get plays(){return playCount},get blobs(){return blobs},emit:name=>listeners.get(name)?.(),timeout:()=>timer?.(),cleanup,settle:async()=>{for(let i=0;i<10;i++)await Promise.resolve()}};
}
const missing=await mediaFixture(Promise.resolve({ok:false}));assert.equal(missing.errors,1);assert.equal(missing.plays,0);missing.emit('error');assert.equal(missing.errors,1);missing.cleanup();
const valid=await mediaFixture(Promise.resolve({ok:true,blob:async()=>({})}));assert.equal(valid.errors,0);assert.equal(valid.plays,1);valid.emit('loadeddata');valid.timeout();assert.equal(valid.errors,0);valid.emit('error');valid.emit('error');assert.equal(valid.errors,1);valid.cleanup();
const delayedMedia=deferred();const stalled=await mediaFixture(delayedMedia.promise);stalled.timeout();assert.equal(stalled.errors,1);delayedMedia.resolve({ok:true,blob:async()=>({})});await stalled.settle();assert.equal(stalled.plays,0);assert.equal(stalled.blobs,0);stalled.cleanup();
console.log('PASS real audio effect: missing/decode errors skip once; slow-file timeout ignores late fetch; loaded audio is retained');
