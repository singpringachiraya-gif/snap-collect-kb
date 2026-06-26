"""
snap_watcher.py — รันค้างไว้ background บนเครื่อง admin
เมื่อ Excel file เปลี่ยน (ผ่าน OneDrive sync) → extract JSON → git push → Vercel deploy

ตั้งค่า WATCH_FILE ให้ตรงกับ path ที่ sync มาจาก SharePoint
"""
import time, subprocess, sys, os
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

GIT        = r"C:\Users\Achirayas\AppData\Local\Programs\Git\cmd\git.exe"
PYTHON     = sys.executable
REPO       = r"C:\Users\Achirayas\Desktop\snap-collect-kb"

WATCH_FILE = r"D:\SPWG\Contact Center Onesiam - General\รวมข้อมูลการสะสมใบเสร็จ Snap&Collect.xlsx"

DEBOUNCE_SECONDS = 60   # รอ 60 วินาทีก่อน trigger ซ้ำ (กัน OneDrive ยิงหลายครั้ง)
SYNC_WAIT        = 30   # รอ OneDrive sync เสร็จก่อน extract


class ExcelHandler(FileSystemEventHandler):
    def __init__(self):
        self._last_run = 0

    def _check(self, path):
        """Called on any filesystem event — OneDrive may fire created/moved instead of modified."""
        if os.path.normcase(path) != os.path.normcase(WATCH_FILE):
            return
        now = time.time()
        if now - self._last_run < DEBOUNCE_SECONDS:
            return
        self._last_run = now
        print(f"[watcher] ตรวจพบ Excel เปลี่ยน — รอ {SYNC_WAIT} วินาที ให้ OneDrive sync เสร็จ...")
        time.sleep(SYNC_WAIT)
        _run_extract_and_push()

    def on_modified(self, event):
        if not event.is_directory:
            self._check(event.src_path)

    def on_created(self, event):
        if not event.is_directory:
            self._check(event.src_path)

    def on_moved(self, event):
        if not event.is_directory:
            self._check(event.dest_path)



def _run_extract_and_push():
    print("[watcher] กำลัง extract ข้อมูล...")
    env = os.environ.copy()
    env["SNAP_EXCEL_SRC"] = WATCH_FILE
    r = subprocess.run([PYTHON, os.path.join(REPO, "extract_data.py")], env=env, cwd=REPO)
    if r.returncode != 0:
        print("[watcher] ERROR: extract_data.py ล้มเหลว")
        return

    subprocess.run([GIT, "-C", REPO, "add", "snap-collect-data.json"])
    diff = subprocess.run([GIT, "-C", REPO, "diff", "--cached", "--quiet"])
    if diff.returncode != 0:
        ts = time.strftime("%Y-%m-%d %H:%M")
        subprocess.run([GIT, "-C", REPO, "commit", "-m",
                        f"data: auto-refresh from SharePoint [{ts}]"])
        subprocess.run([GIT, "-C", REPO, "push", "origin", "main"])
        print(f"[watcher] push สำเร็จ — Vercel กำลัง deploy ({ts})")
    else:
        print("[watcher] ข้อมูลไม่เปลี่ยน ไม่ต้อง push")


if __name__ == "__main__":
    if "PLACEHOLDER" in WATCH_FILE:
        print("ERROR: กรุณาตั้งค่า WATCH_FILE ใน snap_watcher.py ก่อนรัน")
        print("       Sync SharePoint library มาที่ OneDrive แล้วหา path ของไฟล์ Excel")
        sys.exit(1)

    watch_dir = os.path.dirname(WATCH_FILE)
    if not os.path.isdir(watch_dir):
        print(f"ERROR: ไม่พบ folder: {watch_dir}")
        sys.exit(1)

    observer = Observer()
    observer.schedule(ExcelHandler(), watch_dir, recursive=False)
    observer.start()
    print(f"[watcher] กำลัง watch: {WATCH_FILE}")
    print("[watcher] กด Ctrl+C เพื่อหยุด")
    try:
        while True:
            time.sleep(5)
    except KeyboardInterrupt:
        observer.stop()
    observer.join()
