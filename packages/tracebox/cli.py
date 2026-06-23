#!/usr/bin/env python3
"""TraceBox CLI entry point — works from both source and pip install."""
import sys
from pathlib import Path

# When running from source, add the packages/ directory to sys.path
# so sibling-package imports work. When installed via pip, all packages
# are already in site-packages/ and no path manipulation is needed.
_pkg_dir = Path(__file__).parent.resolve()  # packages/tracebox/
_packages_dir = _pkg_dir.parent  # packages/
if str(_packages_dir) not in sys.path:
    sys.path.insert(0, str(_packages_dir))

from tracebox.main import main

if __name__ == "__main__":
    sys.exit(main())
