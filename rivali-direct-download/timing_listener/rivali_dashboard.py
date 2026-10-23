"""Rivali Timing Control v3: dashboard UI over receive-only RMonitor client."""
import json
import queue
import tkinter as tk
from datetime import datetime
from pathlib import Path
from tkinter import messagebox, ttk
from rivali_timing_listener import RaceState, Listener, LOG_DIR, demo_lines

BG="#090D0F"; PANEL="#131A1D"; PANEL2="#1A2326"; LINE="#344044"; Y="#E5FF00"
WHITE="#F5F7F7"; MUTED="#A5B1B5"; GREEN="#50E684"; RED="#FF6767"

class TimingDashboard:
    def __init__(self,root):
        self.root=root
        root.title("RIVALI UPLOADER | Live Timing v3")
        root.geometry("1450x850")
        root.minsize(1100,700)
        root.configure(bg=BG)
        self.data=RaceState()
        self.events=queue.Queue()
        self.listener=Listener(self.events)
        self.online=False; self.is_demo=False
        self.host=tk.StringVar(); self.port=tk.StringVar(value="50000")
        self.status=tk.StringVar(value="DISCONNECTED")
        self.filter=tk.StringVar(value="All classes")
        self.watch=tk.StringVar(value="145,22,88")
        self.next_class=tk.StringVar(value="Not available from live feed")
        self.build()
        self.root.after(150,self.poll)
        self.root.protocol("WM_DELETE_WINDOW",self.close)
    def label(self,parent,text,color=WHITE,size=10,bold=False,**kw):
        return tk.Label(parent,text=text,bg=parent.cget("bg"),fg=color,font=("Segoe UI",size,"bold" if bold else "normal"),**kw)
    def frame(self,parent,pad=12):
        return tk.Frame(parent,bg=PANEL,highlightbackground=LINE,highlightthickness=1,padx=pad,pady=pad)
    def button(self,parent,text,command,accent=False):
        return tk.Button(parent,text=text,command=command,bg=Y if accent else PANEL2,
                         fg=BG if accent else WHITE,activebackground="#BAD500" if accent else "#354044",
                         activeforeground=BG if accent else WHITE,relief="flat",bd=0,
                         font=("Segoe UI",10,"bold"),padx=14,pady=11,cursor="hand2")
    def build(self):
        header=tk.Frame(self.root,bg=BG,padx=24,pady=14);header.pack(fill="x")
        self.label(header,"RIVALI",Y,30,True).pack(side="left")
        self.label(header,"   Uploader Live Timing",WHITE,19,True).pack(side="left")
        self.label(header,"RECEIVE ONLY   |   v3",Y,10,True).pack(side="right",padx=12)
        tk.Frame(self.root,bg=Y,height=2).pack(fill="x")
        body=tk.Frame(self.root,bg=BG,padx=18,pady=14);body.pack(fill="both",expand=True)
        top=tk.Frame(body,bg=BG);top.pack(fill="x",pady=(0,12))
        for col,weight in enumerate([3,2,2,2]):top.grid_columnconfigure(col,weight=weight,uniform="top")
        self.conn=self.frame(top);self.conn.grid(row=0,column=0,sticky="nsew",padx=(0,8))
        self.label(self.conn,"◉  MYLAPS / RMonitor Connection",Y,12,True).pack(anchor="w",pady=(0,12))
        hp=tk.Frame(self.conn,bg=PANEL);hp.pack(fill="x")
        self.label(hp,"HOST / IP ADDRESS",MUTED,9,True).grid(row=0,column=0,sticky="w")
        self.label(hp,"PORT",MUTED,9,True).grid(row=0,column=1,sticky="w",padx=(10,0))
        tk.Entry(hp,textvariable=self.host,bg=PANEL2,fg=WHITE,insertbackground=Y,bd=0,font=("Segoe UI",12),width=24).grid(row=1,column=0,sticky="ew",ipady=8)
        tk.Entry(hp,textvariable=self.port,bg=PANEL2,fg=WHITE,insertbackground=Y,bd=0,font=("Segoe UI",12),width=8).grid(row=1,column=1,padx=(10,0),ipady=8)
        acts=tk.Frame(self.conn,bg=PANEL);acts.pack(fill="x",pady=(12,0))
        self.button(acts,"CONNECT LIVE",self.connect,True).pack(side="left",padx=(0,5))
        self.button(acts,"DISCONNECT",self.disconnect).pack(side="left",padx=5)
        actions=tk.Frame(self.conn,bg=PANEL);actions.pack(fill="x",pady=(8,0))
        self.button(actions,"RUN DEMO",self.demo).pack(side="left",padx=(0,5))
        self.button(actions,"SAVE SNAPSHOT",self.snapshot).pack(side="left",padx=5)
        stat=self.frame(top);stat.grid(row=0,column=1,sticky="nsew",padx=8)
        self.label(stat,"◉  CONNECTION STATUS",Y,12,True).pack(anchor="w",pady=(0,18))
        self.big_status=self.label(stat,"●  Disconnected",RED,17,True);self.big_status.pack(anchor="w")
        self.status_detail=self.label(stat,"Awaiting authorized timing feed",MUTED,10);self.status_detail.pack(anchor="w",pady=(12,0))
        self.received=self.label(stat,"Messages: 0",WHITE,11);self.received.pack(anchor="w",pady=(8,0))
        sess=self.frame(top);sess.grid(row=0,column=2,sticky="nsew",padx=8)
        self.label(sess,"⚑  CURRENT SESSION",Y,12,True).pack(anchor="w",pady=(0,16))
        self.session_lbl=self.label(sess,"No session received",WHITE,16,True,wraplength=250,justify="left");self.session_lbl.pack(anchor="w")
        self.class_lbl=self.label(sess,"Class: Unknown",MUTED,11);self.class_lbl.pack(anchor="w",pady=(10,0))
        self.flag_lbl=self.label(sess,"Flag: Unknown",GREEN,11);self.flag_lbl.pack(anchor="w",pady=(6,0))
        nxt=self.frame(top);nxt.grid(row=0,column=3,sticky="nsew",padx=(8,0))
        self.label(nxt,"➤  UP NEXT",Y,12,True).pack(anchor="w",pady=(0,16))
        self.label(nxt,"From approved racing order",MUTED,10).pack(anchor="w")
        self.next_lbl=self.label(nxt,"Not yet configured",WHITE,14,True,wraplength=230,justify="left");self.next_lbl.pack(anchor="w",pady=(12,0))
        self.label(nxt,"RMonitor does not guarantee future order.",MUTED,9,wraplength=230,justify="left").pack(anchor="w",pady=(12,0))
        lower=tk.Frame(body,bg=BG);lower.pack(fill="both",expand=True)
        lower.grid_columnconfigure(0,weight=4);lower.grid_columnconfigure(1,weight=2);lower.grid_rowconfigure(0,weight=1)
        live=self.frame(lower,pad=12);live.grid(row=0,column=0,sticky="nsew",padx=(0,8))
        bar=tk.Frame(live,bg=PANEL);bar.pack(fill="x",pady=(0,12))
        self.label(bar,"LIVE TIMING",Y,14,True).pack(side="left")
        self.label(bar,"   Driver / class data from timing feed",MUTED,10).pack(side="left")
        s=ttk.Style();s.theme_use("clam")
        s.configure("R.Treeview",background=BG,fieldbackground=BG,foreground=WHITE,rowheight=38,borderwidth=0,font=("Segoe UI",10))
        s.configure("R.Treeview.Heading",background=PANEL2,foreground=Y,font=("Segoe UI",10,"bold"),padding=9)
        s.map("R.Treeview",background=[("selected","#4D580F")])
        self.tree=ttk.Treeview(live,style="R.Treeview",show="headings",columns=("kart","driver","class","passes","last"),height=14)
        for key,title,width in [("kart","KART",85),("driver","DRIVER",210),("class","CLASS",150),("passes","PASSINGS",105),("last","LAST RAW RECORD",260)]:
            self.tree.heading(key,text=title);self.tree.column(key,width=width,anchor="w",stretch=True)
        self.tree.pack(fill="both",expand=True)
        right=tk.Frame(lower,bg=BG);right.grid(row=0,column=1,sticky="nsew",padx=(8,0));right.grid_rowconfigure(0,weight=2);right.grid_rowconfigure(1,weight=2);right.grid_rowconfigure(2,weight=1);right.grid_columnconfigure(0,weight=1)
        yours=self.frame(right);yours.grid(row=0,column=0,sticky="nsew",pady=(0,8))
        self.label(yours,"★  YOUR KARTS",Y,13,True).pack(anchor="w")
        self.label(yours,"Watchlist (comma-separated kart numbers)",MUTED,9).pack(anchor="w",pady=(9,2))
        ent=tk.Entry(yours,textvariable=self.watch,bg=PANEL2,fg=WHITE,insertbackground=Y,bd=0,font=("Segoe UI",11));ent.pack(fill="x",ipady=5);ent.bind("<Return>",lambda e:self.render())
        self.watch_panel=tk.Frame(yours,bg=PANEL);self.watch_panel.pack(fill="both",expand=True,pady=(8,0))
        compare=self.frame(right);compare.grid(row=1,column=0,sticky="nsew",pady=8)
        self.label(compare,"▥  COMPETITOR COMPARISON",Y,13,True).pack(anchor="w")
        self.label(compare,"Official lap-gap comparison",MUTED,10).pack(anchor="w",pady=(12,3))
        self.label(compare,"Pending live-feed format validation",WHITE,11,True,wraplength=380,justify="left").pack(anchor="w")
        self.label(compare,"We will not invent timing metrics from raw passing fields.",MUTED,10,wraplength=380,justify="left").pack(anchor="w",pady=(8,0))
        feed=self.frame(right);feed.grid(row=2,column=0,sticky="nsew",pady=(8,0))
        self.label(feed,"▤  SESSION FEED",Y,13,True).pack(anchor="w")
        self.feed_lbl=self.label(feed,"No data received yet",WHITE,10,wraplength=350,justify="left");self.feed_lbl.pack(anchor="w",pady=(12,0))
        footer=tk.Frame(self.root,bg=BG,padx=20,pady=8);footer.pack(fill="x")
        self.label(footer,"RIVALI  |  Timing Control v3   •   MYLAPS receive-only listener",MUTED,9).pack(side="left")
        self.label(footer,"SIMULATED DATA LABELED  /  LIVE RECORDS UNVERIFIED",Y,9,True).pack(side="right")
    def connect(self):
        host=self.host.get().strip()
        try:
            port=int(self.port.get())
            if not host or any(c.isspace() for c in host) or not 1<=port<=65535:raise ValueError()
        except ValueError:
            messagebox.showerror("Rivali","Enter authorized MYLAPS host and port.");return
        self.listener.start(host,port);self.is_demo=False
        self.status.set("CONNECTING");self.render()
    def disconnect(self):
        self.listener.stop();self.online=False
        self.status.set("DISCONNECTED");self.render()
    def demo(self):
        self.disconnect()
        self.data=RaceState()
        for line in demo_lines():self.data.ingest(line)
        self.is_demo=True;self.status.set("DEMO MODE")
        self.render()
    def snapshot(self):
        LOG_DIR.mkdir(exist_ok=True)
        f=LOG_DIR/("rivali-timing-"+datetime.now().strftime("%Y%m%d-%H%M%S")+".json")
        f.write_text(json.dumps(self.data.export(self.online and not self.is_demo),indent=2),encoding="utf-8")
        messagebox.showinfo("Rivali","Saved snapshot:\n"+str(f))
    def poll(self):
        changed=False
        for _ in range(250):
            try:kind,value=self.events.get_nowait()
            except queue.Empty:break
            if kind=="line":
                try:changed=self.data.ingest(value) or changed
                except (ValueError,IndexError):pass
            elif kind=="status":
                self.status.set(value);self.online=value.startswith("CONNECTED")
                changed=True
            elif kind=="closed":
                self.online=False;changed=True
        if changed:self.render()
        self.root.after(150,self.poll)
    def render(self):
        status="DEMO MODE" if self.is_demo else self.status.get()
        self.big_status.configure(text="●  "+status,fg=Y if self.is_demo else GREEN if self.online else RED)
        self.status_detail.configure(text="SIMULATED • no track connection" if self.is_demo else "Receiving authorized timing data" if self.online else "No live timing connection")
        self.received.configure(text=f"Messages: {self.data.count}")
        self.session_lbl.configure(text=self.data.session)
        self.class_lbl.configure(text="Classes: "+(", ".join(self.data.classes.values()) or "Unknown"))
        self.flag_lbl.configure(text="Flag: "+(self.data.flag or "Unknown"))
        self.feed_lbl.configure(text=("Demo feed" if self.is_demo else "Live feed" if self.online else "Offline")+"\nLast record: "+(self.data.last_seen or "None"))
        for node in self.tree.get_children():self.tree.delete(node)
        for d in self.data.drivers.values():
            self.tree.insert("","end",values=(d["number"],d["name"],self.data.classes.get(str(d["class_id"]),str(d["class_id"])),len(d["laps"]),str(d["last"] or "")[:48]))
        for child in self.watch_panel.winfo_children():child.destroy()
        for number in [n.strip() for n in self.watch.get().split(",") if n.strip()][:10]:
            d=self.data.drivers.get(number)
            line=tk.Frame(self.watch_panel,bg=PANEL);line.pack(fill="x",pady=3)
            self.label(line,"#"+number,Y,11,True).pack(side="left")
            self.label(line,"   "+(d["name"] if d else "Not in current timing feed"),WHITE,10).pack(side="left")
    def close(self):
        self.listener.stop();self.root.destroy()

if __name__=="__main__":
    root=tk.Tk()
    TimingDashboard(root)
    root.mainloop()
