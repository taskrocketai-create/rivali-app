# Rivali Uploader Timing Listener (prototype)

Runs on Windows using Python 3 with Tkinter. Double-click `START_RIVALI_TIMING.bat` or run `py rivali_timing_listener.py`.

1. Test **Demo** first. Demo data is simulated and MUST NOT be treated as B&B results.
2. After B&B's scoring operator authorizes use, connect to the designated timing Wi-Fi/network.
3. The operator provides the active Orbits RMonitor Scoreboard Feed IP and port (commonly 50000; Orbits 5 local app feed commonly 60000). Do not change their scoring or network settings yourself.
4. Enter host/port and click **Connect**. Click **Disconnect** at any time.
5. Use **Save Snapshot JSON** to capture observed classes and records to `records/` locally.

Safety: TCP connection is inbound-data-only (app sends no messages), no scoring-system installation, no automatic retries or polling, no cloud uploads. Never connect without operator permission. Network load/impact must still be validated. Raw `$J` passing fields are intentionally *not* labeled official lap times until format is confirmed from a real feed. No future race order is inferred from live timing alone.

Self test: `py rivali_timing_listener.py --self-test`.

References: https://www.race-monitor.com/support/GettingStarted and https://support.myracepass.com/hc/en-us/articles/115003622948-Finding-the-RMonitor-IP-Address-and-Port-in-MyLaps-Orbits
