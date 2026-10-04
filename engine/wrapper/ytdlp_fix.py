"""Workaround for the pinned StemDeck release's pruned yt-dlp.

StemDeck ships yt-dlp with only the extractors it expects to need, and in the pinned release the
rebuilt registry leaves out the YouTube search extractor. Search then fails with "No suitable
extractor found for URL ytsearch...". The class itself is still installed, so it is added back to
the registry. An entry that is already present is left alone, so a release that fixes this needs no
change here.
"""


def restore_youtube_search() -> None:
    try:
        from yt_dlp.extractor.youtube import YoutubeSearchIE
        from yt_dlp.globals import extractors
    except ImportError:
        return
    extractors.value.setdefault("YoutubeSearchIE", YoutubeSearchIE)
