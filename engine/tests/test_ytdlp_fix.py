"""The pinned StemDeck release prunes yt-dlp's registry without the search extractor."""

import sys
from pathlib import Path

import pytest

yt_dlp = pytest.importorskip("yt_dlp")

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "wrapper"))

from ytdlp_fix import restore_youtube_search  # noqa: E402
from yt_dlp.globals import extractors  # noqa: E402


def test_search_extractor_is_restored_when_the_registry_lacks_it():
    registry = extractors.value
    saved = registry.pop("YoutubeSearchIE", None)
    try:
        assert "YoutubeSearchIE" not in registry
        restore_youtube_search()
        assert "YoutubeSearchIE" in registry
        assert registry["YoutubeSearchIE"].suitable("ytsearch3:some song")
    finally:
        if saved is not None:
            registry["YoutubeSearchIE"] = saved


def test_an_existing_registry_entry_is_left_alone():
    registry = extractors.value
    sentinel = object()
    saved = registry.get("YoutubeSearchIE")
    registry["YoutubeSearchIE"] = sentinel
    try:
        restore_youtube_search()
        assert registry["YoutubeSearchIE"] is sentinel
    finally:
        if saved is not None:
            registry["YoutubeSearchIE"] = saved
        else:
            registry.pop("YoutubeSearchIE", None)


def test_search_succeeds_through_a_youtube_dl_after_the_fix():
    from yt_dlp import YoutubeDL

    registry = extractors.value
    saved = registry.pop("YoutubeSearchIE", None)
    try:
        restore_youtube_search()
        with YoutubeDL({"allowed_extractors": ["youtube:search", "youtube"], "quiet": True}) as ydl:
            names = {ie.IE_NAME for ie in ydl._ies.values()}
        assert "youtube:search" in names
    finally:
        if saved is not None:
            registry["YoutubeSearchIE"] = saved
