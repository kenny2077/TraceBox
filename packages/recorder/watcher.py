#!/usr/bin/env python3
"""
TraceBox File Watcher
Uses watchdog for reliable file change detection with polling fallback.
"""

import os
import sys
import time
import hashlib
from pathlib import Path
from typing import Dict, List, Optional, Callable

# Try to import watchdog, fall back to polling
try:
    from watchdog.observers import Observer
    from watchdog.events import FileSystemEventHandler
    WATCHDOG_AVAILABLE = True
except ImportError:
    WATCHDOG_AVAILABLE = False


class TraceBoxEventHandler(FileSystemEventHandler):
    """Handle file system events and emit to ledger."""
    
    def __init__(self, session_id: str, ledger, callback: Optional[Callable] = None):
        self.session_id = session_id
        self.ledger = ledger
        self.callback = callback
        self._pending_events = []
        
    def on_modified(self, event):
        if event.is_directory:
            return
        self._emit("modified", event.src_path)
        
    def on_created(self, event):
        if event.is_directory:
            return
        self._emit("created", event.src_path)
        
    def on_deleted(self, event):
        if event.is_directory:
            return
        self._emit("deleted", event.src_path)
        
    def on_moved(self, event):
        if event.is_directory:
            return
        self._emit("deleted", event.src_path)
        self._emit("created", event.dest_path)
        
    def _emit(self, operation: str, path: str):
        rel_path = os.path.relpath(path, self.ledger.repo_path if hasattr(self.ledger, 'repo_path') else '.')
        event_data = {
            "path": rel_path,
            "operation": operation,
            "timestamp": time.time(),
        }
        self._pending_events.append(event_data)
        
        if self.callback:
            self.callback(operation, rel_path)
            
    def get_pending_events(self) -> List[Dict]:
        events = self._pending_events[:]
        self._pending_events = []
        return events


class FileWatcher:
    """Watch files using watchdog or polling fallback."""
    
    def __init__(self, repo_path: str, session_id: str, ledger=None):
        self.repo_path = Path(repo_path).resolve()
        self.session_id = session_id
        self.ledger = ledger
        self.observer = None
        self.handler = None
        self._polling = False
        self._stop_polling = False
        
    def start(self, callback: Optional[Callable] = None) -> bool:
        """Start watching files. Returns True if watchdog, False if polling."""
        if WATCHDOG_AVAILABLE:
            return self._start_watchdog(callback)
        else:
            self._start_polling(callback)
            return False
            
    def _start_watchdog(self, callback: Optional[Callable] = None) -> bool:
        """Start watchdog observer."""
        self.handler = TraceBoxEventHandler(self.session_id, self.ledger, callback)
        self.observer = Observer()
        
        # Watch the repo, but ignore common non-source directories
        ignore_patterns = [
            '.git', 'node_modules', '.tracebox', '__pycache__', 
            '.venv', 'venv', 'dist', '.next', '.cache'
        ]
        
        self.observer.schedule(self.handler, str(self.repo_path), recursive=True)
        self.observer.start()
        print(f"👁️  Watching {self.repo_path} (watchdog)")
        return True
        
    def _start_polling(self, callback: Optional[Callable] = None):
        """Start polling fallback."""
        self._polling = True
        print(f"👁️  Watching {self.repo_path} (polling - install watchdog for better performance)")
        
        # Store initial state
        self._poll_state = self._snapshot_files()
        
    def _snapshot_files(self) -> Dict[str, float]:
        """Get snapshot of file mtimes."""
        state = {}
        for root, dirs, files in os.walk(self.repo_path):
            # Skip ignored directories
            dirs[:] = [d for d in dirs if d not in {
                '.git', 'node_modules', '.tracebox', '__pycache__',
                '.venv', 'venv', 'dist', '.next', '.cache'
            }]
            for f in files:
                path = os.path.join(root, f)
                try:
                    state[path] = os.path.getmtime(path)
                except OSError:
                    pass
        return state
        
    def poll_once(self) -> List[Dict]:
        """Poll for changes once. Returns list of changes."""
        if not self._polling:
            return []
            
        new_state = self._snapshot_files()
        changes = []
        
        # Check for modifications and creations
        for path, mtime in new_state.items():
            if path not in self._poll_state:
                changes.append({"operation": "created", "path": path})
            elif self._poll_state[path] != mtime:
                changes.append({"operation": "modified", "path": path})
                
        # Check for deletions
        for path in self._poll_state:
            if path not in new_state:
                changes.append({"operation": "deleted", "path": path})
                
        self._poll_state = new_state
        return changes
        
    def get_events(self) -> List[Dict]:
        """Get pending events."""
        if self.handler:
            return self.handler.get_pending_events()
        elif self._polling:
            return self.poll_once()
        return []
        
    def stop(self):
        """Stop watching."""
        if self.observer:
            self.observer.stop()
            self.observer.join()
            self.observer = None
        self._polling = False
        
    def __enter__(self):
        self.start()
        return self
        
    def __exit__(self, *args):
        self.stop()


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="TraceBox File Watcher")
    parser.add_argument("--repo", default=".", help="Repository path")
    parser.add_argument("--session-id", default="test", help="Session ID")
    
    args = parser.parse_args()
    
    watcher = FileWatcher(args.repo, args.session_id)
    watcher.start(callback=lambda op, path: print(f"  {op}: {path}"))
    
    print("Press Ctrl+C to stop")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        watcher.stop()
        print("\nStopped")
