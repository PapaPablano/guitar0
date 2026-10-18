"""Tests for the packaging licence gate. Run with: python -m pytest engine/tests"""

import importlib.util
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "check-licences.py"
spec = importlib.util.spec_from_file_location("check_licences", SCRIPT)
check_licences = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check_licences)


def add_package(root: Path, name: str, **fields: str) -> None:
    info = root / f"{name}-1.0.dist-info"
    info.mkdir()
    lines = [f"Name: {name}", "Version: 1.0"] + [f"{key}: {value}" for key, value in fields.items()]
    (info / "METADATA").write_text("\n".join(lines) + "\n", encoding="utf-8")


def run(root: Path, capsys) -> tuple[int, str]:
    code = check_licences.main(str(root))
    return code, capsys.readouterr().out


def test_a_non_commercial_licence_fails_and_names_the_package(tmp_path, capsys):
    add_package(tmp_path, "diffq-fixed", License="Creative Commons Attribution-NonCommercial 4.0 International")
    code, out = run(tmp_path, capsys)
    assert code == 1
    assert "diffq-fixed" in out


def test_a_reviewed_package_passes_even_without_a_usable_licence_field(tmp_path, capsys):
    add_package(tmp_path, "stemdeck")
    code, _ = run(tmp_path, capsys)
    assert code == 0


def test_a_package_with_no_licence_field_that_is_not_reviewed_fails(tmp_path, capsys):
    add_package(tmp_path, "mystery-package")
    code, out = run(tmp_path, capsys)
    assert code == 1
    assert "mystery-package" in out
    assert "no licence declared" in out or "no recognised licence" in out


def test_permissive_licences_pass(tmp_path, capsys):
    add_package(tmp_path, "one", License="MIT")
    add_package(tmp_path, "two", License="BSD-3-Clause")
    add_package(tmp_path, "three", **{"License-Expression": "Apache-2.0"})
    code, _ = run(tmp_path, capsys)
    assert code == 0


def test_a_licence_classifier_alone_is_enough(tmp_path, capsys):
    add_package(tmp_path, "classified", Classifier="License :: OSI Approved :: MIT License")
    code, _ = run(tmp_path, capsys)
    assert code == 0


def test_gpl_family_licences_are_blocked(tmp_path, capsys):
    add_package(tmp_path, "viral", License="AGPL-3.0-or-later")
    code, out = run(tmp_path, capsys)
    assert code == 1
    assert "viral" in out


def test_lgpl_is_allowed(tmp_path, capsys):
    add_package(tmp_path, "soxr", License="LGPL-2.1-or-later")
    code, _ = run(tmp_path, capsys)
    assert code == 0
