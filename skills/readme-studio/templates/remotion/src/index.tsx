import React from 'react';
import {AbsoluteFill, Composition, Img, registerRoot, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';

type CoverProps = {dark:boolean; farBlur?:number; middleBlur?:number; grain?:number; glow?:number; depth?:number};
const pixels=['000111100','001111110','011010111','111111111','011111110','001001100','011001110'];
function Cover({dark,farBlur=9,middleBlur=2,grain=.04,glow=.18,depth=.025}:CoverProps) {
  const f=useCurrentFrame();const {width,height}=useVideoConfig();const mobile=width<height;
  const phase=f/299, pulse=Math.sin(phase*Math.PI)**2;
  const entry=Math.min(1,f/24), settle=1-(1-entry)**3;
  const exit=f>275?(f-275)/24:0;
  const offset=(1-settle)*12+exit**3*12;
  const ink=dark?'#f4f1e9':'#15242a',field=dark?'#15242a':'#f4f1e9';
  const suffix=dark?'light':'dark';
  return <AbsoluteFill style={{background:field,overflow:'hidden'}}>
    <Img className="depth-plane-far" src={staticFile('background.png')} style={{position:'absolute',width:'100%',height:'100%',objectFit:'cover',filter:`blur(${farBlur}px)`,transform:`scale(${1.04+pulse*depth})`}}/>
    <Img className="depth-plane-middle" src={staticFile('background.png')} style={{position:'absolute',width:'100%',height:'100%',objectFit:'cover',filter:`blur(${middleBlur}px)`,opacity:.68,transform:`scale(${1.03+pulse*depth*.45})`,maskImage:'linear-gradient(to bottom,transparent 5%,black 28%,black 72%,transparent 94%)',WebkitMaskImage:'linear-gradient(to bottom,transparent 5%,black 28%,black 72%,transparent 94%)'}}/>
    <AbsoluteFill style={{background:`radial-gradient(ellipse at 80% 10%,rgba(170,240,196,${glow}),transparent 60%)`}}/>
    <AbsoluteFill className="rim-light" style={{background:'linear-gradient(112deg,transparent 42%,rgba(255,244,196,.04) 46%,rgba(255,239,184,.38) 49%,rgba(255,255,245,.2) 50%,rgba(255,239,184,.08) 53%,transparent 59%)',mixBlendMode:'screen',opacity:.78}}/>
    <svg width={width} height={height} style={{position:'absolute',opacity:grain}}><filter id="grain"><feTurbulence type="fractalNoise" baseFrequency=".8" numOctaves="2" seed="17"/></filter><rect width="100%" height="100%" filter="url(#grain)"/></svg>
    <div className="sharp-foreground" style={{position:'absolute',left:mobile?40:64,top:mobile?48:60,width:mobile?width-80:width*.64,padding:mobile?28:36,boxSizing:'border-box',background:field,color:ink,border:`1px solid ${ink}`,filter:'none',transform:`translateY(${offset}px)`}}>
      <Img src={staticFile(`label-${suffix}.svg`)} style={{width:mobile?'74%':'42%',height:mobile?30:24,objectFit:'contain',objectPosition:'left'}}/>
      <Img src={staticFile(`title-${suffix}.svg`)} style={{display:'block',width:'100%',marginTop:mobile?32:42}}/>
      <Img src={staticFile(`subtitle-${suffix}.svg`)} style={{display:'block',width:'94%',marginTop:24}}/>
      <div style={{height:1,background:ink,marginTop:mobile?32:40,opacity:.35}}/>
    </div>
    <svg viewBox="0 0 9 7" width={mobile?180:240} height={mobile?140:186} style={{position:'absolute',right:mobile?60:80,bottom:mobile?100:68,transform:`translateY(${-pulse*16}px)`,imageRendering:'pixelated'}} shapeRendering="crispEdges" aria-label="Original pixel field sprite">
      {pixels.flatMap((row,y)=>[...row].map((cell,x)=>cell==='1'?<rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={(x+y)%4===0?'#ed734b':'#c9ee95'}/>:null))}
    </svg>
  </AbsoluteFill>;
}
function Root(){return <>{[false,true].flatMap(mobile=>[false,true].map(dark=><Composition key={`${mobile}-${dark}`} id={`${mobile?'Mobile':'Wide'}${dark?'Dark':'Light'}`} component={Cover} width={mobile?768:1600} height={mobile?960:800} fps={60} durationInFrames={300} defaultProps={{dark}}/>))}</>;}
registerRoot(Root);
