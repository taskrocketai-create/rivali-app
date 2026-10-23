const fractions: Record<string,string> = {
  "¼":"1/4","½":"1/2","¾":"3/4",
  "⅛":"1/8","⅜":"3/8","⅝":"5/8","⅞":"7/8"
};
export function isNumericSetupField(key:string){
  return /_(psi|in|pct|deg)$/.test(key)||["rear_sprocket","driver_sprocket"].includes(key);
}
export function normalizeSetupNumber(value:unknown):number|null{
  if(typeof value==="number")return Number.isFinite(value)?value:null;
  if(typeof value!=="string")return null;
  let text=value.trim().replace(/([0-9])([¼½¾⅛⅜⅝⅞])/g,"$1 $2");
  for(const [symbol,fraction] of Object.entries(fractions))text=text.replaceAll(symbol,fraction);
  text=text.replace(/\s*(psi|p\.s\.i\.|inches|inch|in\.?|degrees|degree|deg|percent|percentage|%)\s*$/i,"");
  text=text.replace(/["°]/g,"").trim();
  const mixed=/^([+-]?\d+)\s+(\d+)\/(\d+)$/.exec(text);
  if(mixed){
    const whole=Number(mixed[1]),top=Number(mixed[2]),bottom=Number(mixed[3]);
    if(!bottom||top>=bottom)return null;
    return whole<0?whole-top/bottom:whole+top/bottom;
  }
  const fraction=/^([+-]?\d+)\/(\d+)$/.exec(text);
  if(fraction){const a=Number(fraction[1]),b=Number(fraction[2]);return b? a/b:null;}
  if(!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(text))return null;
  const num=Number(text);
  return Number.isFinite(num)?num:null;
}
