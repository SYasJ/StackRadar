# Quick start

1. **Launch StackRadar** (desktop app, or `python3 stackradar.py`). The first scan of your home folder starts automatically.
2. **Overview**: the KPI cards show projects, secrets, high-risk projects, live ports, AI agents, skills, schedules, duplicate space and system load. Click any card to jump to that tab.
3. **Alerts** (right column): start with red items (leaked keys, high risk).
4. **Projects**: click a row to open the details drawer. There you can:
   - copy the run command, or **▶ Run from StackRadar** with a port of your choice;
   - **⟳ Check outdated versions**, then **⬆** update a single dependency or all outdated ones;
   - colour-tag, rate, set a status and write notes;
   - **📂 Show in file manager**, rename, move or delete (to Trash).
5. **Lineage**: see how everything links. Switch **Force / Radial / Flow**, click legend items to hide types, search a node, **Save PNG**.
6. Explore **System**, **Agents**, **Skills**, **Schedules**, **Duplicates** and **Updates**.
7. Too many tips? Flip the **Hints** switch in the top bar, or open **⚙ Settings** to hide whole features.

> Want to try it without scanning your real machine? Generate a fake workspace:
> ```bash
> python3 demo/make_demo_workspace.py /tmp/drdemo
> HOME=/tmp/drdemo python3 stackradar.py --root /tmp/drdemo/work
> ```

Scan a different folder at any time: type it in the top box (`~/Projects`, `C:\repos` …), pick a depth and press **Scan**.
