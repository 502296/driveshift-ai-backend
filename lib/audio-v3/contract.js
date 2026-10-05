// Client DSP measurements are validated for shape/range, not authenticated.
export class InputError extends Error {}
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
export const text = (x, max=500) => typeof x === 'string' ? x.replace(/\s+/g,' ').trim().slice(0,max) : '';
const requireInput = (ok, message) => { if(!ok) throw new InputError(message); };
const number = (x, lo, hi) => typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi;
const integer = (x, lo, hi) => Number.isInteger(x) && number(x,lo,hi);
const kinds = ['digital_signal','transient','short_event','spectral_change','spectral_structure','harmonic_track','spectral_peak','harmonic_group'];
const schemas = {
 spectral_peak: {centerSeconds:[0,21],frequencyHz:[0.000001,24000],digitalAmplitude:[0,2]},
 harmonic_group: {centerSeconds:[0,21],acousticFundamentalHz:[0.000001,24000],observedOrders:[3,8]},
 digital_signal: {rms:[0,1], rmsDbfs:[-200,0,true], peak:[0,1], nearFullScaleFraction:[0,1]},
 transient: {centerSeconds:[0,21],energyRiseDb:[0,400],rms:[0,1]},
 short_event: {centerSeconds:[0,21],energyRiseDb:[0,400],thresholdDb:[0,400],thresholdExcessDb:[0,400],windowMs:[1,100],rms:[0,1],baselineRms:[0,1],stream:['broadband','highPass500Hz','highPass2000Hz'],supportingScales:[1,4]},
 spectral_change: {centerSeconds:[0,21],score:[0,1],threshold:[0,100],excess:[0,1],positiveFlux:[0,1],shapeChange:[0,1]},
 spectral_structure: {centerSeconds:[0,21],firstCenterSeconds:[0,21],lastCenterSeconds:[0,21],distance:[0,1],threshold:[0,100],excess:[0,1],windowMs:[1,1000]},
 harmonic_track: {centerSeconds:[0,21],lastCenterSeconds:[0,21],observedFrames:[3,10000],firstAcousticFundamentalHz:[0.000001,24000],lastAcousticFundamentalHz:[0.000001,24000]},
};

export function inspectWav(bytes) {
 requireInput(bytes.length >= 44 && bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WAVE','WAV required');
 const end=bytes.readUInt32LE(4)+8;
 requireInput(end===bytes.length,'Invalid WAV length');
 let fmt=null, data=null;
 for(let p=12;p+8<=end;) {
  const tag=bytes.toString('ascii',p,p+4), size=bytes.readUInt32LE(p+4), start=p+8;
  requireInput(start+size<=end,'Truncated WAV chunk');
  if(tag==='fmt ') {
   requireInput(!fmt && size>=16,'Invalid WAV format');
   fmt={encoding:bytes.readUInt16LE(start),channels:bytes.readUInt16LE(start+2),rate:bytes.readUInt32LE(start+4),
    byteRate:bytes.readUInt32LE(start+8),align:bytes.readUInt16LE(start+12),bits:bytes.readUInt16LE(start+14)};
  }
  if(tag==='data') { requireInput(data===null,'Multiple WAV data chunks'); data=bytes.subarray(start,start+size); }
  p=start+size+(size%2);
 }
 requireInput(fmt && data && fmt.encoding===1 && fmt.channels===1 && fmt.rate===48000 && fmt.bits===16 && fmt.align===2 && fmt.byteRate===96000 && data.length%2===0,'Use mono 48 kHz PCM16 WAV');
 const durationMs=data.length/96;
 requireInput(durationMs>=500 && durationMs<=20500,'Record 0.5 to 20 seconds');
 let sum=0,peak=0;
 for(let p=0;p<data.length;p+=2) { const v=data.readInt16LE(p)/32768; sum+=v*v; peak=Math.max(peak,Math.abs(v)); }
 const rms=Math.sqrt(sum/(data.length/2));
 requireInput(rms>=0.0001,'Insufficient digital signal');
 return {durationMs,sampleRateHz:fmt.rate,channelCount:fmt.channels,rms,peak};
}

export function validateRequest(body) {
 requireInput(object(body) && body.mode==='audio_evidence_v3' && body.audioFormat==='wav','Audio V3 request required');
 requireInput(typeof body.audio==='string' && body.audio.length<=2700000 && body.audio.length%4===0 && /^[A-Za-z0-9+/]+={0,2}$/.test(body.audio),'Invalid audio encoding or size');
 const bytes=Buffer.from(body.audio,'base64');
 requireInput(bytes.length<=2000000 && bytes.toString('base64')===body.audio,'Invalid audio encoding or size');
 const wav=inspectWav(bytes), e=body.audioEvidence;
 requireInput(object(e) && e.contract==='audio_v3_evidence_v1' && object(e.recording) && object(e.quality),'Missing Audio V3 evidence');
 requireInput(e.recording.channelCount===wav.channelCount && e.recording.sampleRateHz===wav.sampleRateHz &&
  number(e.recording.durationMilliseconds,500,20500) && Math.abs(e.recording.durationMilliseconds-wav.durationMs)<=2,'WAV/evidence mismatch');
 requireInput(['passedDigitalChecks','reviewRecommended'].includes(e.quality.status) && e.quality.permitsFurtherAcousticAnalysis===true,'Insufficient local quality');
 requireInput(Array.isArray(e.observations) && e.observations.length>=1 && e.observations.length<=85,'Invalid observation count');
 const ids=new Set(), counts={};
 const observations=e.observations.map(row => {
  requireInput(object(row) && row.channel===0 && kinds.includes(row.kind) && object(row.values),'Invalid observation');
  requireInput(typeof row.id==='string' && (row.kind==='digital_signal' ? row.id==='CH0_SIGNAL' : new RegExp(`^CH0_${row.kind.toUpperCase()}_[0-9]{1,4}$`).test(row.id)) && !ids.has(row.id),'Invalid observation ID');
  ids.add(row.id); counts[row.kind]=(counts[row.kind]||0)+1;
  requireInput(counts[row.kind]<=(row.kind==='digital_signal'?1:12),'Unbounded observation list');
  const values={};
  for(const [key, bounds] of Object.entries(schemas[row.kind])) {
   const v=row.values[key];
   const valid=typeof bounds[0]==='string' ? bounds.includes(v) : (v===null && bounds[2]===true) || number(v,bounds[0],bounds[1]);
   requireInput(valid,`Invalid measurement: ${key}`); values[key]=v;
  }
  if(row.kind==='digital_signal') {
   requireInput(Math.abs(values.rms-wav.rms)<=0.00001 && Math.abs(values.peak-wav.peak)<=0.00001,'Signal measurements do not match WAV');
  } else {
   requireInput(values.centerSeconds<=wav.durationMs/1000 &&
    (values.lastCenterSeconds===undefined || values.lastCenterSeconds>=values.centerSeconds && values.lastCenterSeconds<=wav.durationMs/1000), 'Invalid window time');
   if(row.kind==='spectral_structure') requireInput(values.firstCenterSeconds<=values.centerSeconds,'Invalid run order');
   if(row.kind==='short_event') requireInput(Number.isInteger(values.supportingScales) && Math.abs(values.energyRiseDb-values.thresholdDb-values.thresholdExcessDb)<1e-7,'Invalid short-event relationship');
   if(['spectral_change','spectral_structure'].includes(row.kind)) requireInput(Math.abs((values.score??values.distance)-values.threshold-values.excess)<1e-7,'Invalid threshold relationship');
  }
  return {id:row.id,kind:row.kind,channel:0,values};
 });
 requireInput(counts.digital_signal===1,'Missing digital measurements');
 requireInput(Array.isArray(e.stageSummaries) && e.stageSummaries.length===7,'Invalid stage summary');
 const seen=new Set();
 const stages=e.stageSummaries.map(s=>{
  requireInput(object(s) && s.channel===0 && kinds.includes(s.kind) && s.kind!=='digital_signal' && !seen.has(s.kind),'Invalid stage');
  seen.add(s.kind);
  requireInput(integer(s.totalCount,0,10000) && s.includedCount===(counts[s.kind]||0) && s.totalCount>=s.includedCount,'Invalid candidate counts');
  return {channel:0,kind:s.kind,status:text(s.status,50),totalCount:s.totalCount,includedCount:s.includedCount,selection:text(s.selection,100)};
 });
 const c=object(body.recordingContext)?body.recordingContext:{};
 const origin=['unknown','userReportedDirectVehicleRecording','userReportedSpeakerPlayback','userReportedOther'].includes(c.origin)?c.origin:'unknown';
 const rpmBehavior=['unknown','changes_with_rpm','no_clear_relation','idle_only'].includes(c.rpmBehavior)?c.rpmBehavior:'unknown';
 const vehicleProfile={};
 for(const k of ['year','make','model','trim','engine','drivetrain','transmission']) vehicleProfile[k]=text(body.vehicleProfile?.[k],100);
 return {language:body.language==='es'?'es':'en',audioBase64:body.audio,ids,
  evidence:{contract:e.contract,recording:{sampleRateHz:wav.sampleRateHz,channelCount:wav.channelCount,durationMilliseconds:e.recording.durationMilliseconds},quality:{status:e.quality.status},stageSummaries:stages,observations},
  context:{contextClass:'user_reported',origin,rpmBehavior,description:text(c.description),supportsMeasuredRpmCorrelation:false},vehicleProfile};
}
