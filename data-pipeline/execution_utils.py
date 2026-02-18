"""
Reusable utilities for notebook execution metadata: last run info, system stats,
duration. Use show_execution_banner() at the top and
write_with_execution_metadata() when writing output.
save_figure() exports matplotlib figures to prepared-data/figures/ for charts
whose data is too large to export.
"""

from datetime import datetime
import json
import os
import platform
import time
import warnings
from pathlib import Path


def get_sys_info() -> dict:
    """Return dict with timestamp, os, cpu_count, processor, ram_gb, ram_used_pct."""
    info = {
        "timestamp": datetime.now().isoformat(),
        "os": platform.platform(),
        "cpu_count": os.cpu_count(),
        "processor": platform.processor() or "N/A",
    }
    try:
        import psutil
        mem = psutil.virtual_memory()
        info["ram_gb"] = round(mem.total / (1024**3), 1)
        info["ram_used_pct"] = mem.percent
    except ImportError:
        info["ram_gb"] = info["ram_used_pct"] = None
        warnings.warn(
            "psutil not installed—RAM/CPU details unavailable. "
            "Install with: pip install psutil"
        )
    return info


def format_duration(seconds: float | None) -> str:
    """Format seconds as '30m 47s', '45s', or '1h 5m 30s'. Returns 'N/A' if None/neg."""
    if seconds is None or seconds < 0:
        return "N/A"
    sec = int(seconds)
    if sec < 60:
        return f"{sec}s"
    m, s = divmod(sec, 60)
    if m < 60:
        return f"{m}m {s}s"
    h, m = divmod(m, 60)
    return f"{h}h {m}m {s}s"


def show_execution_banner(filepath: Path) -> float:
    """
    Read file, display last_execution info, prompt user to continue.
    Returns time.time() for use as start_time in write_with_execution_metadata.
    """
    filepath = Path(filepath)
    if filepath.exists():
        try:
            with open(filepath, encoding="utf-8") as f:
                obj = json.load(f)
            last = obj.get("last_execution") if isinstance(obj, dict) else None
            if last:
                ts = last.get("timestamp", "?")
                dur = format_duration(last.get("duration_seconds"))
                os_name = last.get("os", "?")
                cpu = last.get("cpu_count", "?")
                proc = last.get("processor", "?")
                ram = last.get("ram_gb")
                ram_pct = last.get("ram_used_pct")
                ram_str = (
                    f"{ram} GB ({ram_pct}% used)" if ram is not None else "N/A"
                )
                print("--- Last execution ---")
                print(f"  Timestamp: {ts}")
                print(f"  Duration:  {dur}")
                print(f"  System:    {os_name}")
                print(f"  CPUs:      {cpu} | Processor: {proc}")
                print(f"  RAM:       {ram_str}")
                print("------------------------")
            else:
                print("No previous execution info.")
        except (json.JSONDecodeError, OSError):
            print("No previous execution info (could not read file).")
    else:
        print("No previous execution info (file does not exist yet).")

    input("Press Enter to continue, or interrupt kernel (Ctrl+C) to stop...")
    return time.time()


def write_with_execution_metadata(
    filepath: Path,
    data: list | dict,
    start_time: float | None = None,
) -> None:
    """
    Write data to file with last_execution metadata (timestamp, duration, sysinfo).
    filepath: output path
    data: the payload (list or dict) to store under "data"
    start_time: from show_execution_banner(); if None, duration_seconds omitted
    """
    filepath = Path(filepath)
    filepath.parent.mkdir(parents=True, exist_ok=True)

    info = get_sys_info()
    if start_time is not None:
        info["duration_seconds"] = round(time.time() - start_time)
    else:
        info["duration_seconds"] = None

    payload = {"last_execution": info, "data": data}
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)


def save_figure(fig, name: str, prepared_dir: Path, dpi: int = 150) -> Path:
    """
    Save a matplotlib figure to prepared_dir/figures/{name}.png with consistent options.
    Use for charts whose underlying data is too large or impractical to export.
    """
    out_dir = Path(prepared_dir) / "figures"
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"{name}.png"
    fig.savefig(path, dpi=dpi, bbox_inches="tight")
    return path
