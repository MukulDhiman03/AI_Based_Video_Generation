import {mkdir, readFile, writeFile} from 'node:fs/promises';

const voices = {
  viraj: process.env.ELEVENLABS_VOICE_VIRAJ_ENERGETIC_CONFIDENT,
  monika: process.env.ELEVENLABS_VOICE_MONIKA_DEEP_NATURAL,
};
const voice = process.argv[2] || 'viraj';
if (!voices[voice] || !process.env.ELEVENLABS_API_KEY) throw new Error('Missing selected voice or ElevenLabs key.');
const {scenes}=await import('./sample.mjs');
const text=scenes.map(s=>s.narration).join(' ');
await mkdir('public/generated',{recursive:true});
let saved;
try { saved=JSON.parse(await readFile('public/generated/speech.json','utf8')); } catch {}
if (!saved || saved.text!==text || saved.voiceId!==voices[voice]) {
  // Read-only preflight prevents a generation attempt with an inaccessible voice.
  const check=await fetch(`https://api.elevenlabs.io/v1/voices/${voices[voice]}`,{headers:{'xi-api-key':process.env.ELEVENLABS_API_KEY}});
  if (!check.ok) throw new Error(`Selected voice is not accessible (${check.status}). Add it to My Voices first.`);
  const response=await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voices[voice]}/with-timestamps`,{
    method:'POST',headers:{'xi-api-key':process.env.ELEVENLABS_API_KEY,'Content-Type':'application/json'},
    body:JSON.stringify({text,model_id:'eleven_multilingual_v2',voice_settings:{stability:0.5,similarity_boost:0.75}}),
  });
  const result=await response.json();
  if (!response.ok) throw new Error(`ElevenLabs ${response.status}: ${JSON.stringify(result.detail)}`);
  const alignment=result.normalized_alignment || result.alignment;
  if (!alignment?.characters?.length || !result.audio_base64) throw new Error('Audio or timing missing from provider response.');
  await writeFile('public/generated/narration.mp3',Buffer.from(result.audio_base64,'base64'));
  saved={text,voiceId:voices[voice],voice,alignment};
  await writeFile('public/generated/speech.json',JSON.stringify(saved,null,2));
}
const a=saved.alignment;
const transcript=a.characters.join('');
if (transcript!==text) throw new Error('Provider normalized the transcript. Explicit alignment mapping is required.');
if (a.characters.length!==a.character_start_times_seconds.length || a.characters.length!==a.character_end_times_seconds.length) throw new Error('Invalid alignment lengths.');
const words=[...transcript.matchAll(/\S+/g)].map(m=>({text:m[0],start:a.character_start_times_seconds[m.index],end:a.character_end_times_seconds[m.index+m[0].length-1]}));
let offset=0;
for(const scene of scenes){scene.start=a.character_start_times_seconds[offset];offset+=scene.narration.length;scene.end=a.character_end_times_seconds[offset-1];offset++;}
// Round scene cuts to the first frame at or after the next spoken phrase begins.
const fps=30;
const duration=Math.ceil((Math.max(...a.character_end_times_seconds)+0.7)*fps)/fps;
const plan={title:'How the internet works',voice,voiceId:voices[voice],fps,width:1080,height:1920,duration,words,scenes:scenes.map((s,i)=>({...s,from:i===0?0:Math.ceil(s.start*fps),to:i===scenes.length-1?Math.round(duration*fps):Math.ceil(scenes[i+1].start*fps)}))};
await writeFile('public/generated/plan.json',JSON.stringify(plan,null,2));
const stamp=t=>new Date(Math.round(t*1000)).toISOString().slice(11,23).replace('.',',');
await mkdir('output',{recursive:true});
await writeFile('output/captions.srt',words.map((w,i)=>`${i+1}\n${stamp(w.start)} --> ${stamp(w.end)}\n${w.text}\n`).join('\n'));
console.log(JSON.stringify({voice,scenes:scenes.length,words:words.length,duration,alignment:'provider character timestamps'}));
