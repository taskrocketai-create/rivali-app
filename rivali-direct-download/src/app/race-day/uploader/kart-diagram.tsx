"use client";
import styles from "./uploader.module.css";
export function KartDiagram({values,onChange}:{values:Record<string,string>;onChange:(key:string,value:string)=>void}){
 const ballastPositions=[["ballastFL","Front left",58,105],["ballastFR","Front right",202,105],["ballastCL","Seat left",66,169],["ballastCR","Seat right",194,169],["ballastRL","Rear left",63,239],["ballastRR","Rear right",197,239]] as const;
 const ballastTotal=ballastPositions.reduce((sum,[key])=>sum+Math.max(0,Math.floor(Number(values[key]||0)||0))*5,0);
 const tires=[["lf","LF",25,65],["rf","RF",205,65],["lr","LR",25,222],["rr","RR",205,222]] as const;
 return <div className={styles.kartDiagram}><div className={styles.kartDiagramTitle}>TIRE PRESSURES · PSI <small>Top view · enter measured values</small></div>
 <svg viewBox="0 0 260 300" role="img" aria-label="Top view kart with tire positions" className={styles.kartSvg}>
 <rect x="50" y="54" width="160" height="196" rx="21" fill="#171c1c" stroke="#555" strokeWidth="3"/>
 <rect x="92" y="35" width="76" height="35" rx="10" fill="#232b2c" stroke="#eaff00" strokeWidth="3"/>
 <rect x="98" y="223" width="64" height="42" rx="7" fill="#293037" stroke="#a2a9aa" strokeWidth="3"/>
 <path d="M83 75L83 232M177 75L177 232M66 145L194 145" fill="none" stroke="#eaff00" strokeWidth="4"/>
 <path d="M130 63L130 221" stroke="#b8c0c0" strokeWidth="4"/>
 <rect x="98" y="104" width="64" height="105" rx="26" fill="#080a0b" stroke="#f0ff00" strokeWidth="3"/>
 <circle cx="130" cy="93" r="19" fill="#1b2528" stroke="#eaff00" strokeWidth="4"/>
 <circle cx="130" cy="145" r="20" fill="#30393a" stroke="#999" strokeWidth="3"/>
 {tires.map(([key,label,x,y])=><g key={key}>
 <rect x={x-17} y={y-31} width="34" height="62" rx="9" fill="#131717" stroke="#eaff00" strokeWidth="3"/>
 <rect x={x-12} y={y-24} width="24" height="48" rx="6" fill="#252929"/>
 <text x={x} y={y+4} textAnchor="middle" fill="#eaff00" fontSize="11" fontWeight="bold">{label}</text>
 </g>)}
 {ballastPositions.map(([key,label,x,y])=>Number(values[key]||0)>0?<g key={key}><circle cx={x} cy={y} r="14" fill="#eaff00" stroke="#111" strokeWidth="2"/><text x={x} y={y+4} textAnchor="middle" fill="#111" fontSize="11" fontWeight="900">{Number(values[key])*5}</text><title>{label}: {Number(values[key])} five-pound ballast weights</title></g>:null)}
 <text x="130" y="286" textAnchor="middle" fill="#bac1bd" fontSize="12">FRONT ↑</text>
 </svg>
 <div className={styles.tireInputs}>{tires.map(([key,label])=><label key={key}>{label}<input inputMode="decimal" type="number" step=".1" placeholder="Not measured" value={values[key]??""} onChange={e=>onChange(key,e.target.value)}/></label>)}</div></div>
}
