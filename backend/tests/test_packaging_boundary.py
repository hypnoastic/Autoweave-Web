from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


def test_autoweave_wheel_installs_outside_the_library_source_tree(tmp_path: Path) -> None:
    repo_root = Path(__file__).resolve().parents[3]
    library_root = repo_root / "Autoweave Library"
    wheel_dir = tmp_path / "wheelhouse"
    venv_dir = tmp_path / "venv"

    subprocess.run(
        [sys.executable, "-m", "pip", "wheel", "--no-deps", "--wheel-dir", str(wheel_dir), str(library_root)],
        check=True,
    )
    wheel_path = next(wheel_dir.glob("autoweave-*.whl"))

    subprocess.run([sys.executable, "-m", "venv", str(venv_dir)], check=True)
    python_bin = venv_dir / "bin" / "python"
    pip_bin = venv_dir / "bin" / "pip"

    subprocess.run([str(pip_bin), "install", "--no-deps", str(wheel_path)], check=True)

    probe = subprocess.run(
        [
            str(python_bin),
            "-c",
            (
                "import importlib.metadata, importlib.util, json; "
                "spec = importlib.util.find_spec('autoweave'); "
                "bootstrap = importlib.util.find_spec('apps.cli.bootstrap'); "
                "entry_points = [ep.name for ep in importlib.metadata.distribution('autoweave').entry_points]; "
                "print(json.dumps({'origin': spec.origin, 'bootstrap_origin': bootstrap.origin, 'entry_points': entry_points}))"
            ),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    payload = json.loads(probe.stdout)

    assert "site-packages" in payload["origin"]
    assert "site-packages" in payload["bootstrap_origin"]
    assert str(library_root.resolve()) not in payload["origin"]
    assert "autoweave" in payload["entry_points"]
