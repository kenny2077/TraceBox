#!/usr/bin/env python3
"""TraceBox CLI entry point."""

import sys
import os
from pathlib import Path

# Resolve package paths relative to this file
PKG_ROOT = Path(__file__).parent.parent.parent.resolve()
sys.path.insert(0, str(PKG_ROOT))
sys.path.insert(0, str(PKG_ROOT / "packages" / "ledger"))
sys.path.insert(0, str(PKG_ROOT / "packages" / "recorder"))
sys.path.insert(0, str(PKG_ROOT / "packages" / "policy"))
sys.path.insert(0, str(PKG_ROOT / "packages" / "rollback"))
sys.path.insert(0, str(PKG_ROOT / "packages" / "report"))
sys.path.insert(0, str(PKG_ROOT / "packages" / "replay"))
sys.path.insert(0, str(PKG_ROOT / "packages" / "core"))

# Import the real CLI
from apps.cli.tracebox import main

if __name__ == "__main__":
    sys.exit(main())
