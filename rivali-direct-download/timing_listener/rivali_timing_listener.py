"""Rivali read-only MYLAPS RMonitor timing listener. Python standard library only."""
import argparse
import csv
import io
import json
import queue
import socket
import threading
import time
import tkinter as tk
from datetime import datetime, timezone
from pathlib import Path
from tkinter import ttk, messagebox

LOG_DIR = Path(__file__).parent / "records"
SUPPORTED = {"$A", "$COMP", "$B", "$C", "$F", "$G", "$H", "$I", "$J", "$E", "$SP", "$SR"}

def fields(line):
    return next(csv.reader(io.StringIO(line)))

class RaceState:
    def __init__(self):
        self.reset()
    def reset(self):
        self.classes = {}
        self.drivers = {}
        self.runs = {}
        self.session = "Unknown session"
        self.flag = ""
        self.last_seen = None
        self.count = 0
    def ingest(self, line):
        row = fields(line.strip())
        if not row or row[0] not in SUPPORTED:
            return False
        tag = row[0]
        self.count += 1
        self.last_seen = datetime.now(timezone.utc).isoformat()
        if tag == "$I":
            self.reset()
            self.last_seen = datetime.now(timezone.utc).isoformat()
        elif tag == "$C" and len(row) >= 3:
            self.classes[row[1]] = row[2]
        elif tag == "$B" and len(row) >= 3:
            self.runs[row[1]] = row[2:]
            self.session = " | ".join(x for x in row[2:4] if x) or self.session
        elif tag in ("$A", "$COMP") and len(row) >= 8:
            number = row[2]
            self.drivers[number] = {"number":number, "name":(row[4] + " " + row[5]).strip(), "class_id":row[7], "laps":[], "last":None, "best":None}
        elif tag == "$J" and len(row) >= 4:
            # Keep raw passing record until track-specific field ordering is confirmed.
            number = row[1]
            driver = self.drivers.setdefault(number, {"number":number,"name":"Unknown","class_id":"","laps":[],"last":None,"best":None})
            driver["laps"].append(row[2:])
            driver["last"] = row[2:]
        elif tag == "$F" and len(row) >= 6:
            self.flag = row[5].strip()
        return True
    def export(self, connected=False):
        return {"source":"RMonitor", "connected":connected, "captured_at":datetime.now(timezone.utc).isoformat(), "last_seen":self.last_seen, "session":self.session, "flag":self.flag, "classes":self.classes, "drivers":list(self.drivers.values()), "messages_seen":self.count, "data_status":"unverified until tested against B&B feed"}

class Listener:
    def __init__(self, events):
        self.events=events
        self.stop_event=threading.Event()
        self.thread=None
        self.sock=None
    def start(self, host, port):
        self.stop()
        self.stop_event=threading.Event()
        self.thread=threading.Thread(target=self._run,args=(host,port,self.stop_event),daemon=True)
        self.thread.start()
    def stop(self):
        self.stop_event.set()
        if self.sock:
            try: self.sock.shutdown(socket.SHUT_RDWR)
            except OSError: pass
            try: self.sock.close()
            except OSError: pass
            self.sock=None
    def _run(self,host,port,stop):
        try:
            # Outbound connection only. Never send commands or modify timing system.
            with socket.create_connection((host,port),timeout=5) as sock:
                self.sock=sock
                sock.settimeout(1.0)
                self.events.put(("status","CONNECTED • receiving only"))
                buffer=b""
                while not stop.is_set():
                    try: packet=sock.recv(4096)
                    except socket.timeout: continue
                    if not packet: break
                    buffer+=packet
                    while b"\n" in buffer:
                        line,buffer=buffer.split(b"\n",1)
                        if line.strip():
                            self.events.put(("line",line.decode("latin-1",errors="replace").strip()))
                    if len(buffer)>1048576:
                        raise ValueError("Timing line exceeds safety limit")
        except Exception as exc:
            if not stop.is_set(): self.events.put(("status","DISCONNECTED: "+str(exc)))
        finally:
            self.sock=None
            self.events.put(("closed",None))

def demo_lines():
    return [
      '$I,"B&B Kartway"',
      '$C,1,"Box Stock"',
      '$B,1,"Practice","Box Stock"',
      '$A,"145","145",12345,"Stephen","Hinnant","",1',
      '$A,"22","22",12346,"Demo","Driver","",1',
      '$F,8,"00:04:00","20:00:00","00:01:00","Green "',
      '$J,145,1,"00:12.842"',
      '$J,22,1,"00:12.721"',
    ]

class App:
    def __init__(self, root):
        self.root=root
        root.title("Rivali Uploader | MYLAPS Timing Listener")
        root.geometry("980x650")
        root.configure(bg="#0D0F10")
        neon="#E5FF00"
        panel="#171A1D"
        muted="#A9B0B6"
        style=ttk.Style(root)
        style.theme_use("clam")
        style.configure("TFrame",background="#0D0F10")
        style.configure("TLabel",background="#0D0F10",foreground="#F2F3F4",font=("Segoe UI",10))
        style.configure("TButton",background="#252A2D",foreground="#F7F8F8",borderwidth=0,
                        font=("Segoe UI",10,"bold"),padding=(12,10),focuscolor="#252A2D")
        style.map("TButton",background=[("active","#3B4245")],foreground=[("active","#FFFFFF")])
        style.configure("Accent.TButton",background=neon,foreground="#090B0D",padding=(16,10))
        style.map("Accent.TButton",background=[("active","#BDE000")],foreground=[("active","#090B0D")])
        style.configure("TEntry",fieldbackground="#24282B",foreground="#FFFFFF",
                        insertcolor="#FFFFFF",bordercolor="#3C4347",padding=7)
        style.configure("Treeview",background=panel,fieldbackground=panel,foreground="#F5F7F7",
                        borderwidth=0,rowheight=38,font=("Segoe UI",10))
        style.map("Treeview",background=[("selected","#505A16")],
                  foreground=[("selected","#FFFFFF")])
        style.configure("Treeview.Heading",background="#262B2C",foreground=neon,
                        relief="flat",font=("Segoe UI",10,"bold"),padding=(8,12))
        style.map("Treeview.Heading",background=[("active","#333A3D")])
        self.state=RaceState()
        self.events=queue.Queue()
        self.listener=Listener(self.events)
        self.connected=False
        self.host=tk.StringVar(value="")
        self.port=tk.StringVar(value="50000")
        self.status=tk.StringVar(value="DISCONNECTED • waiting for authorized feed")
        self.summary=tk.StringVar(value="No timing data yet")
        shell=ttk.Frame(root,padding=18)
        shell.pack(fill="both",expand=True)
        ttk.Label(shell,text="RIVALI  /  TIMING CONTROL",font=("Segoe UI",23,"bold"),foreground="#DFFF00").pack(anchor="w")
        ttk.Label(shell,text="MYLAPS / RMonitor • RECEIVE ONLY",font=("Segoe UI",10)).pack(anchor="w",pady=(0,18))
        top=ttk.Frame(shell)
        top.pack(fill="x")
        ttk.Label(top,text="Authorized timing host (IP)").grid(row=0,column=0,sticky="w")
        ttk.Label(top,text="Port").grid(row=0,column=1,sticky="w")
        ttk.Entry(top,textvariable=self.host,width=34).grid(row=1,column=0,padx=(0,10))
        ttk.Entry(top,textvariable=self.port,width=9).grid(row=1,column=1,padx=(0,10))
        ttk.Button(top,text="CONNECT LIVE",command=self.connect,style="Accent.TButton").grid(row=1,column=2,padx=3)
        ttk.Button(top,text="Disconnect",command=self.disconnect).grid(row=1,column=3,padx=3)
        ttk.Button(top,text="RUN DEMO",command=self.demo,style="Accent.TButton").grid(row=1,column=4,padx=3)
        ttk.Label(shell,textvariable=self.status,foreground="#DFFF00").pack(anchor="w",pady=(16,5))
        ttk.Label(shell,textvariable=self.summary,font=("Segoe UI",11,"bold")).pack(anchor="w",pady=(0,10))
        self.tree=ttk.Treeview(shell,columns=("kart","name","class","passes","last"),show="headings",height=14)
        for key,label,width in (("kart","Kart",85),("name","Driver",220),("class","Class",165),("passes","Passings",90),("last","Latest raw passing",225)):
            self.tree.heading(key,text=label)
            self.tree.column(key,width=width,anchor="w")
        self.tree.pack(fill="both",expand=True)
        foot=ttk.Frame(shell)
        foot.pack(fill="x",pady=12)
        ttk.Button(foot,text="SAVE TIMING SNAPSHOT",command=self.snapshot,style="Accent.TButton").pack(side="left")
        ttk.Label(foot,text="No messages are transmitted to MYLAPS. Raw lap fields await live format verification.").pack(side="right")
        self.root.after(150,self.poll)
        self.root.protocol("WM_DELETE_WINDOW",self.close)
    def connect(self):
        host=self.host.get().strip()
        try:
            port=int(self.port.get())
            if not 1<=port<=65535: raise ValueError()
            if not host or any(c.isspace() for c in host): raise ValueError()
        except ValueError:
            messagebox.showerror("Connection","Enter the approved MYLAPS host and valid port.")
            return
        self.connected=False
        self.status.set("CONNECTING • receive only")
        self.listener.start(host,port)
    def disconnect(self):
        self.listener.stop()
        self.connected=False
        self.status.set("DISCONNECTED")
    def demo(self):
        self.disconnect()
        self.state=RaceState()
        for line in demo_lines(): self.state.ingest(line)
        self.status.set("DEMO MODE • simulated data, not B&B live timing")
        self.render()
    def poll(self):
        changed=False
        for _ in range(250):
            try: kind,value=self.events.get_nowait()
            except queue.Empty: break
            if kind=="line":
                try: changed=self.state.ingest(value) or changed
                except (ValueError,csv.Error,IndexError): pass
            elif kind=="status":
                self.status.set(value)
                self.connected=value.startswith("CONNECTED")
            elif kind=="closed":
                self.connected=False
        if changed: self.render()
        self.root.after(150,self.poll)
    def render(self):
        self.summary.set(f"{self.state.session}  |  Flag: {self.state.flag or 'Unknown'}  |  Records: {self.state.count}")
        for key in self.tree.get_children(): self.tree.delete(key)
        for driver in self.state.drivers.values():
            self.tree.insert("", "end", values=(driver["number"],driver["name"],self.state.classes.get(str(driver["class_id"]),str(driver["class_id"])),len(driver["laps"]),str(driver["last"] or "")))
    def snapshot(self):
        LOG_DIR.mkdir(exist_ok=True)
        path=LOG_DIR / ("timing-"+datetime.now().strftime("%Y%m%d-%H%M%S")+".json")
        path.write_text(json.dumps(self.state.export(self.connected),indent=2),encoding="utf-8")
        messagebox.showinfo("Snapshot saved",str(path))
    def close(self):
        self.disconnect()
        self.root.destroy()

def self_test():
    state=RaceState()
    for line in demo_lines(): assert state.ingest(line)
    assert state.classes["1"]=="Box Stock"
    assert state.drivers["145"]["name"]=="Stephen Hinnant"
    assert len(state.drivers["145"]["laps"])==1
    assert state.flag=="Green"
    print("SELF-TEST PASSED: parsing, competitor linking, passing event, flag, export")

if __name__=="__main__":
    p=argparse.ArgumentParser()
    p.add_argument("--self-test",action="store_true")
    args=p.parse_args()
    if args.self_test: self_test()
    else:
        root=tk.Tk()
        App(root)
        root.mainloop()
