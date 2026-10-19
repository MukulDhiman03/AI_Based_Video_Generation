import React from 'react';
import {AbsoluteFill, Audio, Composition, Sequence, getInputProps, interpolate, registerRoot, spring, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {parseRenderPlan} from './render-plan.mjs';

type RenderPlan = ReturnType<typeof parseRenderPlan>;

const C={bg:'#080d20',ink:'#f4f5ff',muted:'#9daac9',mint:'#76f6c4',purple:'#a69cff'};
const ease=(f:number,a:number,b:number)=>interpolate(f,[a,b],[0,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'});
const Device=({x=180,y=450,scale=1}:{x?:number;y?:number;scale?:number})=><g transform={`translate(${x} ${y}) scale(${scale})`}><rect width="200" height="275" rx="24" fill="#121d38" stroke={C.purple} strokeWidth="5"/><rect x="15" y="22" width="170" height="207" rx="10" fill="#202d4d"/><rect x="39" y="49" width="120" height="15" rx="7" fill={C.mint}/><rect x="39" y="85" width="120" height="67" rx="8" fill={C.purple} opacity=".7"/><path d="M39 177h120M39 198h80" stroke={C.muted} strokeWidth="8" strokeLinecap="round"/><circle cx="100" cy="253" r="7" fill={C.purple}/></g>;
const Server=({x=700,y=460}:{x?:number;y?:number})=><g transform={`translate(${x} ${y})`} >{[0,1,2].map(i=><g key={i} transform={`translate(0 ${i*76})`}><rect width="200" height="60" rx="12" fill="#182740" stroke={C.mint} strokeWidth="3"/><circle cx="28" cy="30" r="7" fill={C.mint}/><path d="M65 24h102M65 37h70" stroke={C.muted} strokeWidth="5" strokeLinecap="round"/></g>)}</g>;
const Network=({frame,kind}:{frame:number;kind:string})=>{
 const progress=ease(frame,5,35);
 const reverse=['server','packets','browser'].includes(kind);
 const p=((frame%80)/80);
 const x=reverse?700-p*320:380+p*320;
 const assembly=ease(frame,8,100);
 return <svg width="1080" height="800" viewBox="0 0 1080 800">
   <defs><radialGradient id="halo"><stop stopColor={C.purple} stopOpacity=".2"/><stop offset="1" stopColor={C.purple} stopOpacity="0"/></radialGradient></defs>
   <circle cx="540" cy="400" r="390" fill="url(#halo)"/>
   {kind==='browser'?<g transform="translate(145 170)"><rect width="790" height="440" rx="24" fill="#14213a" stroke={C.purple} strokeWidth="4"/><path d="M0 60h790" stroke={C.purple} strokeWidth="3"/><circle cx="32" cy="30" r="7" fill="#ff998b"/><circle cx="58" cy="30" r="7" fill="#ffe0a3"/><circle cx="84" cy="30" r="7" fill={C.mint}/><rect x="140" y="18" width="480" height="25" rx="12" fill="#2b3855"/><g opacity={assembly}><rect x="40" y="105" width="365" height="30" rx="8" fill={C.mint}/><rect x="40" y="162" width="270" height="182" rx="14" fill={C.purple}/>{[0,1,2,3].map(i=><rect key={i} x="350" y={170+i*45} width={320-i*25} height="13" rx="6" fill={C.muted}/>)}<rect x="40" y="375" width="160" height="28" rx="12" fill={C.mint}/></g><text x="395" y="510" textAnchor="middle" fill={C.muted} fontSize="28">TEXT + IMAGES + LAYOUT</text></g>:<>
     <g transform="translate(0 -100)"><Device/><Server/>
     <path d="M380 580C450 480 610 480 700 580" fill="none" stroke="#39466b" strokeWidth="5" strokeDasharray="12 14"/>
     <circle cx="540" cy="510" r="76" fill="#111f39" stroke={C.purple} strokeWidth="3"/>
     <ellipse cx="540" cy="510" rx="36" ry="74" fill="none" stroke={C.purple} strokeWidth="2"/><path d="M466 510h148M481 470h118M481 550h118" stroke={C.purple} strokeWidth="2"/>
     {[0,1,2].map(i=>{let q=(p+i/3)%1;let px=reverse?700-q*320:380+q*320;return <rect key={i} x={px-10} y={566-55*Math.sin(q*Math.PI)} width="20" height="20" rx="5" fill={C.mint} opacity={progress}/>})}
     {kind==='packets'&&[0,1,2,3,4].map(i=><g key={i} transform={`translate(${290+i*100} ${200+Math.sin(frame/12+i)*12})`}><rect width="70" height="62" rx="13" fill="#183a3b" stroke={C.mint} strokeWidth="2"/><text x="35" y="40" textAnchor="middle" fontSize="27" fill={C.mint}>{`0${i+1}`}</text></g>)}
     <text x="280" y="795" textAnchor="middle" fill={C.muted} fontSize="26">YOUR DEVICE</text><text x="800" y="795" textAnchor="middle" fill={C.muted} fontSize="26">WEB SERVER</text>
     </g>
   </>}
 </svg>;
};
const Scene=({scene,index}:{scene:RenderPlan['scenes'][number];index:number})=>{
 const frame=useCurrentFrame();const {fps}=useVideoConfig();
 const entrance=spring({frame,fps,config:{damping:200}});
 const end=scene.to-scene.from;
 const opacity=interpolate(frame,[0,7,end-6,end],[0,1,1,0],{extrapolateLeft:'clamp',extrapolateRight:'clamp'});
 return <AbsoluteFill style={{opacity}}>
   <div style={{position:'absolute',left:88,right:88,top:255,transform:`translateY(${(1-entrance)*30}px)`}}>
     <div style={{color:C.mint,fontSize:24,fontWeight:700,letterSpacing:4,marginBottom:32}}>{scene.label}</div>
     <div style={{fontSize:86,fontWeight:750,lineHeight:1.07,letterSpacing:-4,maxWidth:900}}>{scene.title}</div>
   </div>
   <div style={{position:'absolute',top:600,left:0,transform:`scale(${.96+.04*entrance})`}}><Network frame={frame} kind={scene.kind}/></div>
   <div style={{position:'absolute',left:90,right:90,top:1380,display:'flex',gap:12}}>{['REQUEST','RESPONSE','ASSEMBLE'].map((x,i)=><div key={x} style={{padding:'14px 23px',borderRadius:50,border:`1px solid ${i===(index<2?0:index<4?1:2)?C.mint:'#33405e'}`,color:i===(index<2?0:index<4?1:2)?C.mint:C.muted,fontSize:22,letterSpacing:1}}>{x}</div>)}</div>
 </AbsoluteFill>;
};
const Video=({plan}:{plan:RenderPlan})=>{
 const frame=useCurrentFrame();const t=frame/plan.fps;
 let active=plan.words.findIndex(w=>t>=w.start&&t<w.end);
 if(active===-1)active=plan.words.findLastIndex(w=>w.start<=t);
 const group=Math.floor(Math.max(0,active)/5)*5;
 const words=plan.words.slice(group,group+5);
 return <AbsoluteFill style={{backgroundColor:C.bg,color:C.ink,fontFamily:'Arial, sans-serif'}}>
   <AbsoluteFill style={{backgroundImage:'radial-gradient(circle at 20% 35%, #18253c 0%, transparent 48%),linear-gradient(#ffffff04 1px, transparent 1px),linear-gradient(90deg,#ffffff04 1px,transparent 1px)',backgroundSize:'100% 100%,64px 64px,64px 64px'}}/>
   <div style={{position:'absolute',left:88,right:88,top:112,display:'flex',justifyContent:'space-between',fontSize:26,letterSpacing:1}}><span style={{fontWeight:800}}>VidSutra<span style={{color:C.mint}}>.ai</span></span><span style={{color:C.muted}}>EXPLAINED IN SECONDS</span></div>
   {plan.scenes.map((s,i)=><Sequence key={i} from={s.from} durationInFrames={s.to-s.from}><Scene scene={s} index={i}/></Sequence>)}
   <div style={{position:'absolute',left:80,right:110,top:1520,minHeight:164,display:'flex',alignContent:'center',alignItems:'center',justifyContent:'center',flexWrap:'wrap',gap:'10px 13px',padding:24,borderRadius:24,background:'#040917dd',fontSize:48,fontWeight:700,lineHeight:1.25,textAlign:'center'}}>{words.map((w,i)=><span key={group+i} style={{color:group+i===active?C.bg:C.ink,background:group+i===active?C.mint:'transparent',padding:'3px 8px',borderRadius:8}}>{w.text}</span>)}</div>
   <div style={{position:'absolute',bottom:150,left:88,right:110,height:4,background:'#2c3751',borderRadius:3}}><div style={{height:4,width:`${100*frame/(plan.duration*plan.fps-1)}%`,background:C.mint}}/></div>
   <Audio src={staticFile('generated/narration.mp3')}/>
 </AbsoluteFill>;
};
registerRoot(()=> {
 const plan=parseRenderPlan(getInputProps().plan);
 return <Composition id="InternetExplainer" component={Video} defaultProps={{plan}} durationInFrames={Math.round(plan.duration*plan.fps)} fps={plan.fps} width={plan.width} height={plan.height}/>;
});
