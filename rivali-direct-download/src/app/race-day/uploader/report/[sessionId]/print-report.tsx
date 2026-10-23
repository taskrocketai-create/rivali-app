"use client";
export function PrintReport(){
 return <>
  <style>{`@media print { .no-print { display:none!important; } body { background:white!important; } @page { size:letter; margin:0.6in; } }`}</style>
  <button type="button" onClick={()=>window.print()} style={{background:"#a62d19",color:"white",border:0,padding:"10px 18px",borderRadius:6,fontWeight:700,cursor:"pointer"}}>Print / Save PDF</button>
 </>;
}
