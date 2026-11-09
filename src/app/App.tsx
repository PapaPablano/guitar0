import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Clock } from '../audio/clock';
import { createSynthSession, type SynthClock } from '../audio/synth-bridge';
import { loadUserAudio, type UserAudioClock } from '../audio/user-audio';
import { AlignmentMap } from '../audio/alignment-map';
import { barFactsOf, barSpansOf, startAnalysis, type AnalysisJob, type AnalysisResult, decodeRecording } from '../alignment/analyze';
import { startExactCopy, type CopyState, type ExactSession } from './exact-copy-load';
import { copyStateText, exactLine, holdText } from './exactness-text';
import { ExactnessStrip } from './ExactnessStrip';
import { addLanding, emptyLandingStats, type LandingStats } from './landing-stats';
import { readNeckCues, writeNeckCues } from './neck-cues-setting';
import { ClickCountIn } from '../audio/count-in';
import type { model as AlphaModel } from '@coderline/alphatab';
import { buildTimeline, loadAlphaTex } from '../model/alphatab-adapter';
import { applyFileTuning, captureTunings, type WrittenTunings } from '../model/file-tuning';
import type { Timeline } from '../model/score';
import { getStripLayout, scoreBarStartSeconds, stripBarFor, type LoopBars } from '../render/tab-strip';
import { DropZone } from './DropZone';
import { SongsMenu } from './LibraryList';
import { LoopControls } from './LoopControls';
import { decodeUserRecording, exportLength, outputWindow } from '../export/audio';
import { slicePcm } from '../export/audio-file';
import { decodeRecordingWindow, renderStemMix, renderStemMixRange } from '../export/stem-audio';
import { initialMix, type MixState } from '../audio/mix-gains';
import { ExportDialog } from './ExportDialog';
import { RecordBanner } from './RecordBanner';
import { useRecordWithVideo } from './useRecordWithVideo';
import { recordBusyReason, recordLocks } from './record-locks';
import { captureAvailable, recordModeOffered } from '../export/record-capture';
import { Notices } from './Notices';
import { AlignmentPanel } from './AlignmentPanel';
import { OffsetSlider } from './OffsetSlider';
import { controlsFor } from './alignment-controls';
import { decideOnOpen, evidenceFor, needsBandFallback, recordFromMap, referenceBasisFor, settleAnalysis, withAttempt, type AlignBasis, type AlignStatus, type AlignStamp, type RedetectCause } from './auto-align';
import { describeDiff, diffAlignments } from './alignment-diff';
import { checkRecord } from '../alignment/spot-check';
import { tabFingerprint } from '../audio/tab-fingerprint';
import { SectionPanel } from './SectionPanel';
import {
  carryNames,
  describeSectionRows,
  jumpTarget,
  loopFor,
  renameSection,
  sectionIndexAt,
  type BarHealth,
} from './section-controls';
import { clampOffset } from '../audio/offset-range';
import type { HoldState } from '../audio/user-audio';
import { PROFILE_VERSION, type AlignmentRecord, type ProfileStore, type RestoredProfile, type SectionRecord } from '../audio/recording-profile';
import type { AlignmentStore } from '../audio/alignment-store';
import { WebAlignmentStore } from '../audio/alignment-store-web';
import { shellAlignmentStore } from '../stems/alignment-store-shell';
import type { LandingReport } from '../audio/user-audio';
import { playbackBarIndexAt } from '../model/bars';
import { WebProfileStore } from '../audio/profile-store-web';
import { shellProfileStore } from '../stems/profile-store-shell';
import { SongLibrary, displayTitle, type LibraryEntry, type LibraryListing } from './library';
import { desktopLibraryShell, readRecording, readTab, saveRecording, saveTab, shellLibraryBackend } from './library-shell';
import {
  atSongEnd,
  createResumeTracker,
  createStemsAutoStart,
  expectedResumeClocks,
  isOpenSong,
  leaveThenOpen,
  parkSong as parkWith,
  planRestore,
  positionToSave,
  prepareReopen,
  resumeFor,
  runRestore,
  seedVideoStore,
  shouldSaveOnPause,
  storedVideo,
  TAB_MISSING,
  tabWithTuning,
  type OpenSong,
  type ResumeClock,
} from './library-restore';
import { shellStemIndex } from '../stems/saved-stems';
import { audioContext } from '../stems/load-stems';
import { backingSourceFor, createLibrarySession, entryTuningId, libraryRecordingHashes } from './library-session';
import { hashFile } from '../stems/file-hash';
import { createRunGuard } from '../stems/run-guard';
import { isDesktop, openExternal } from './desktop';
import { createDebouncer, DEBOUNCE_MS, decideRestore, fetchProfile } from './restore-profile';
import { BackingTrack } from './BackingTrack';
import { VideoPanel } from './VideoPanel';
import { YoutubeDock } from './YoutubeDock';
import { useYoutubeBacking } from './use-youtube-backing';
import { chooseClock, exportVideoNotice, ownClock, videoIsHeard } from './youtube-backing';
import { configuredApiKey } from './youtube-search';
import { firstNoteSeconds } from './youtube-sync';
import { browserVideoStore } from './youtube-video-store';
import { StemPanel, type ActiveStems } from './StemPanel';
import { SAMPLE_ALPHATEX } from './sample';
import { PanelFullscreen } from './PanelFullscreen';
import { Stage } from './Stage';
import { TrackPicker } from './TrackPicker';
import { PlayAlongSwitch } from './PlayAlongSwitch';
import { canPlayAlong, silentTrackFor } from './play-along';
import { ToneSwitch } from './ToneSwitch';
import { canSwitchTone, programOverrides, type GuitarTone } from '../audio/guitar-tone';
import { Transport } from './Transport';
import type { LabelMode } from '../render/fretboard';
import { initialViewState, ViewControls } from './ViewControls';
import { panelsOf, saveLayout, setBottomTrack, trackForSlot, type PanelId, type StageLayout } from './stage-layout';
import { stepTempo } from './tempo-steps';
import { FREE, isPro, layoutForTier, panelAllowed, readTier, TierContext, tempoFor, toolsForTier, type ProFeature, type TierState } from './tier';
import { UpgradePrompt } from './UpgradePrompt';
import { BackupDialog } from './BackupDialog';
import { interpretKey, seekByBar } from './navigation';
import { firstPlayableTrack, openTabBytes } from './open-file';
import { songsterrLinkForSong } from './songsterr';
import { assessSupport, readSupportEnvironment } from './support';
import { FILE_TUNING, presetById, retuneTimeline } from '../model/retune';
import { TuningChip } from './TuningChip';
import { Menu } from './Menu';
import { ShortcutLegend } from './ShortcutLegend';
import { PracticeTools } from './PracticeTools';
import { alignmentNeedsLook, availableTools, type ToolId } from './practice-tools';
import { WRITTEN } from './file-tuning-options';
import soundFontUrl from '../../assets/soundfont/MuseScore_General.sf3?url';
import './app.css';

// The band SoundFont is a tracked asset; Vite gives it a content-hashed name so a new font is never served from an old cache.
const SOUND_FONT_URL = soundFontUrl;

type AudioState = { status: 'loading'; progress: number } | { status: 'ready' } | { status: 'failed'; message: string };

interface Session {
  timeline: Timeline;
  score: AlphaModel.Score;
  clock: SynthClock;
  /** Every staff's open strings as the file wrote them, so a tuning choice always starts from the file. */
  written: WrittenTunings;
}

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [trackIndex, setTrackIndex] = useState(0);
  /** "Play along": the track on screen is silent so the band plays without it. Off whenever a song opens. */
  const [playAlong, setPlayAlong] = useState(false);
  /** Guitar sounds the player chose, by track. A track not listed plays the sound its tab wrote. Cleared when a song opens. */
  const [tones, setTones] = useState<Record<number, GuitarTone>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tempoPercent, setTempoPercent] = useState(100);
  /** Free or Pro, from the desktop shell (always Free on the web). */
  const [tier, setTier] = useState<TierState>(FREE);
  /** The Pro feature a Free player just reached, while the upgrade prompt is open. */
  const [upgradeFor, setUpgradeFor] = useState<ProFeature | null>(null);
  /** Whether the back up and restore dialog is open (desktop only). */
  const [backupOpen, setBackupOpen] = useState(false);
  /** A note about the open song's library copy (R13, R14), shown in the player view until dismissed or a recording loads. */
  const [libraryNote, setLibraryNote] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      void readTier().then((next) => {
        if (alive) setTier(next);
      });
    };
    refresh();
    window.addEventListener('focus', refresh);
    return () => {
      alive = false;
      window.removeEventListener('focus', refresh);
    };
  }, []);
  /** Tempo changes go through the tier: Free stays at 100% and sees the prompt instead. */
  const requestTempo = useCallback(
    (percent: number) => {
      const result = tempoFor(percent, tier);
      setTempoPercent(result.percent);
      if (result.blocked) setUpgradeFor('tempo');
    },
    [tier],
  );
  useEffect(() => {
    if (!isPro(tier)) setTempoPercent(100);
  }, [tier]);
  const [loop, setLoop] = useState<LoopBars | null>(null);
  const [loopOn, setLoopOn] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [audio, setAudio] = useState<AudioState>({ status: 'loading', progress: 0 });
  const support = useMemo(() => assessSupport(readSupportEnvironment()), []);
  const [userClock, setUserClock] = useState<UserAudioClock | null>(null);
  const [offset, setOffset] = useState(0);
  /** How the recording sits against the tab: a committed per-bar timeline, or only the global offset while there is none. */
  const [alignment, setAlignment] = useState<AlignmentMap>(() => AlignmentMap.fromOffset(0));
  const [alignStatus, setAlignStatus] = useState<AlignStatus>({ phase: 'idle' });
  /** The recording's parts found by the warm-up, with the names the user gave them. */
  const [sections, setSections] = useState<SectionRecord[]>([]);
  /** How well the warm-up matched each bar; empty until a warm-up has run this session. */
  const [barHealth, setBarHealth] = useState<BarHealth>({ barConfidence: [], barMatched: [] });
  /** How far the latest jump into each section landed from its anchor, by section. */
  const [landings, setLandings] = useState<Record<number, number>>({});
  /** A recording waiting for the tab's sound before it is lined up with the tab. */
  const [alignRequest, setAlignRequest] = useState<{ file: File; clock: UserAudioClock } | null>(null);
  const [stems, setStems] = useState<ActiveStems | null>(null);
  const [mix, setMix] = useState<MixState>(() => initialMix());
  const [userAudioError, setUserAudioError] = useState<string | null>(null);
  /** Whether the loaded recording seeks exactly: a compressed file only does once its exact copy is in use. */
  const [copyState, setCopyState] = useState<CopyState | null>(null);
  /** A jump waiting for the part of the recording it lands in to be exact. */
  const [hold, setHold] = useState<HoldState | null>(null);
  /** The decoded audio of the loaded recording and what is exact of it; `exactTick` changes whenever that does. */
  const [exactSession, setExactSession] = useState<ExactSession | null>(null);
  const [, setExactTick] = useState(0);
  /** How jumps have landed this session, before and after the exact copy was in use. */
  const [landingStats, setLandingStats] = useState<LandingStats>(emptyLandingStats);
  /** Counts the player in when a held jump has paused playback. */
  const countIn = useRef(new ClickCountIn());
  const [exportOpen, setExportOpen] = useState(false);
  const [fullscreenPanel, setFullscreenPanel] = useState<PanelId | null>(null);
  const [tool, setTool] = useState<ToolId>('loop');
  const [storedLayout, setLayoutState] = useState<StageLayout>(() => initialViewState().layout);
  /** What the page shows: the player's saved layout, with Pro views swapped for free ones on a Free install. */
  const layout = useMemo(() => layoutForTier(storedLayout, tier), [storedLayout, tier]);
  const setLayout = useCallback(
    (next: StageLayout) => {
      if (!panelsOf(next).every((id) => panelAllowed(id, tier))) {
        setUpgradeFor('real-guitar-views');
        return;
      }
      setLayoutState(next);
      saveLayout(next);
    },
    [tier],
  );
  const [lookahead, setLookahead] = useState(() => initialViewState().lookahead);
  const [labelMode, setLabelMode] = useState<LabelMode>(() => initialViewState().labelMode);
  /** Whether the neck shows technique cues: remembered between sessions, on until the player turns it off. */
  const [neckCues, setNeckCues] = useState(() => readNeckCues());
  const [tuningId, setTuningId] = useState(FILE_TUNING);
  const lastShown = useRef(-1);
  const playingRef = useRef(false);
  /** Bumped whenever the session or its sound connection is replaced, so late results can be ignored. */
  const sessionToken = useRef(0);
  const userClockRef = useRef<UserAudioClock | null>(null);
  const stemsRef = useRef<ActiveStems | null>(null);
  /** The newest settings, for activateStems, which a separation calls minutes after it was started. */
  const live = useRef({
    offset: 0,
    tempoPercent: 100,
    mix: initialMix(),
    userClock: null as UserAudioClock | null,
    session: null as Session | null,
    alignment: AlignmentMap.fromOffset(0),
    sections: [] as SectionRecord[],
    trackIndex: 0,
  });

  /** Where per-recording offset and mix are remembered: a shell file on the desktop, browser storage on the web. */
  const profileStore = useMemo<ProfileStore>(() => (isDesktop() ? shellProfileStore : new WebProfileStore()), []);
  /** Where each recording's alignment is remembered: its own readable file on the desktop, browser storage on the web. */
  const alignmentStore = useMemo<AlignmentStore>(() => (isDesktop() ? shellAlignmentStore : new WebAlignmentStore()), []);
  /** The saved songs, desktop only (R17). */
  const library = useMemo(() => (isDesktop() ? new SongLibrary(shellLibraryBackend()) : null), []);
  /** The shell's library files, desktop only. */
  const libraryShell = useMemo(() => (library ? desktopLibraryShell() : null), [library]);
  /** Keeps the open song's library entry current; on the web it saves nothing. */
  const librarySession = useMemo(() => {
    const shell = libraryShell;
    return createLibrarySession(
      library && shell
        ? {
            library,
            files: { saveTab: (bytes) => saveTab(shell, bytes), saveRecording: (file) => saveRecording(shell, file) },
            now: Date.now,
            onNote: setLibraryNote,
          }
        : null,
    );
  }, [library, libraryShell]);
  /** The file tuning chosen for each track this session, as the library stores it; a track not listed is as written. */
  const fileTunings = useRef(new Map<number, string>());
  /** The saved songs on the start screen, and the recordings among them with saved stems (R7). */
  const [songs, setSongs] = useState<LibraryListing[]>([]);
  const [stemHashes, setStemHashes] = useState<ReadonlySet<string>>(() => new Set());
  /** What the start screen's status line says while a song reopens. */
  const [loadingText, setLoadingText] = useState<string | undefined>(undefined);
  /** Which reopen is the latest; opening another file or song makes an earlier one stale (R15). */
  const reopenRuns = useRef(createRunGuard());
  /** A reopened recording's saved stems, started once the engine is ready unless the player changes the mix first (KTD8). */
  const stemsAuto = useMemo(() => createStemsAutoStart(), []);
  /** The song open in the player, from `openTab`'s result or the reopened entry; null for the sample or no song (KTD7). */
  const openSong = useRef<OpenSong | null>(null);
  /** A reopened song's saved bar, applied to each clock that leads until they all have it (KTD4). */
  const resume = useMemo(() => createResumeTracker(), []);
  /** Cancels the separation running in the stem panel, while one runs; leaving the song calls it (KTD1). */
  const cancelSeparation = useRef<(() => void) | null>(null);
  /** Whether stems are being separated or loaded; the Songs menu reads it to warn that switching cancels it (R4). */
  const [separating, setSeparating] = useState(false);
  /** Which read of the saved songs is the latest; an earlier one that lands later is dropped. */
  const songsRead = useRef(0);
  /** Reads the saved songs and their saved stems again; the last-read list shows until this one lands. */
  const refreshSongs = useCallback(() => {
    if (!library) return;
    const run = ++songsRead.current;
    void Promise.all([library.list(), shellStemIndex.read().catch(() => ({}))]).then(([listing, stemIndex]) => {
      if (run !== songsRead.current) return;
      setSongs(listing);
      setStemHashes(new Set(Object.keys(stemIndex)));
    });
  }, [library]);
  // The list is read whenever the start screen shows, and again after the back up and restore dialog closes. The player's
  // Songs menu reads it each time it opens.
  const onStartScreen = session === null;
  useEffect(() => {
    if (!onStartScreen || backupOpen) return;
    refreshSongs();
    return () => {
      songsRead.current += 1;
    };
  }, [refreshSongs, onStartScreen, backupOpen]);
  // A saved song's recording keeps its offset and mix however many other recordings are opened (KTD6).
  useEffect(() => {
    if (!library) return;
    shellProfileStore.keepHashes(async () => libraryRecordingHashes((await library.list()).map((listing) => listing.entry)));
  }, [library]);
  // The strip and its line follow the store as parts become exact, a few times a second at most.
  useEffect(() => {
    if (!exactSession) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = exactSession.pcm.onChange(() => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        setExactTick((n) => n + 1);
      }, 200);
    });
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, [exactSession]);

  /** Names the recording whose profile lookup is in flight; any newer load or removal makes it stale. */
  const profileRuns = useRef(createRunGuard());
  /** Which recording load is the latest, so a slower earlier one cannot replace a newer one. */
  const loadRuns = useRef(createRunGuard());
  /** Content hash of the loaded recording, once known; null means nothing is restored or saved for it. */
  const profileHash = useRef<string | null>(null);
  /** Gives up the exact copy of the loaded recording when it is replaced or removed. */
  const stopExactCopy = useRef<(() => void) | null>(null);
  /** True once the user has moved the offset since this recording loaded (KTD12). */
  const offsetMoved = useRef(false);
  /** True once the user has changed the mix since this recording loaded; a restore then leaves the mix alone. */
  const mixMoved = useRef(false);
  /** The mix to remember with the offset; desktop only, set by a restore or a user change. */
  const profileMix = useRef<MixState | undefined>(undefined);
  /** Names the analysis of the loaded recording; any newer load, removal or run makes it stale. */
  const alignRuns = useRef(createRunGuard());
  const alignJob = useRef<AnalysisJob | null>(null);
  /** Where the alignment came from; null means the offset was set by hand and no record is saved. */
  const alignSource = useRef<AlignmentRecord['source'] | null>(null);
  /** What the saved record says about the committed timeline (revision, fingerprint, tier, previous offset); null for an offset alone or an older record. */
  const alignStamp = useRef<AlignStamp | null>(null);
  /** A failed detection for this recording and tab, to be saved so opening it again does not repeat the run. */
  const alignAttempt = useRef<string | null>(null);
  /** The saved timeline a running detection replaces, so what changed can be reported when it commits. */
  const alignPrevious = useRef<AlignmentRecord | null>(null);
  /** Why a saved timeline is being detected again without the owner asking: the tab changed, or it no longer matched the recording. */
  const redetectCause = useRef<RedetectCause | null>(null);
  /** What the latest detection changed against the saved timeline, for the panel; null when there is nothing to say. */
  const [alignChange, setAlignChange] = useState<string | null>(null);
  /** True once the owner moved the offset after the latest detection began; only then is its result dropped. */
  const offsetMovedSinceRun = useRef(false);
  const profileSaver = useRef<ReturnType<
    typeof createDebouncer<{ hash: string; offset: number; mix?: MixState; alignment?: AlignmentRecord }>
  > | null>(null);
  if (!profileSaver.current) {
    profileSaver.current = createDebouncer(DEBOUNCE_MS, ({ hash, offset, mix, alignment }) => {
      void profileStore.save(hash, { version: PROFILE_VERSION, offset, ...(mix ? { mix } : {}) });
      if (alignment) void alignmentStore.save(hash, alignment);
    });
  }

  /** Queues a save of the current offset (and desktop mix) for the loaded recording. Loop and tempo are never saved (R19). */
  function scheduleProfileSave(offsetSeconds: number) {
    const hash = profileHash.current;
    const source = alignSource.current;
    let alignmentRecord = source
      ? recordFromMap(live.current.alignment, source, live.current.sections, alignStamp.current ?? undefined)
      : undefined;
    if (alignAttempt.current) alignmentRecord = withAttempt(alignmentRecord, alignAttempt.current);
    if (hash) profileSaver.current?.push({ hash, offset: offsetSeconds, mix: profileMix.current, alignment: alignmentRecord });
  }

  /** Stops any analysis of the loaded recording and forgets one that was waiting to start. */
  function cancelAlignment() {
    alignRuns.current.invalidate();
    alignJob.current?.cancel();
    alignJob.current = null;
    setAlignRequest(null);
    setAlignStatus((s) => (s.phase === 'analysing' || s.phase === 'waiting' ? { phase: 'idle' } : s));
  }

  /**
   * Puts a new alignment on the recording clock and the stem clock together, and remembers it. `source` says
   * where it came from: null means the user's own offset with no analysis behind it.
   */
  function applyAlignment(map: AlignmentMap, source: AlignmentRecord['source'] | null, save: boolean, nextSections?: readonly SectionRecord[]) {
    if (nextSections) {
      live.current.sections = [...nextSections];
      setSections(live.current.sections);
    }
    userClockRef.current?.setAlignment(map);
    stemsRef.current?.clock.setAlignment(map);
    setAlignment(map);
    setOffset(map.base);
    live.current.alignment = map;
    live.current.offset = map.base;
    alignSource.current = source;
    if (save) scheduleProfileSave(map.base);
  }

  /** Lines the recording up with the tab in the background and applies the result unless the user got there first. */
  async function startAlignment(file: File, clockForRun: UserAudioClock, current: Session) {
    alignJob.current?.cancel();
    const run = alignRuns.current.begin();
    const token = sessionToken.current;
    offsetMovedSinceRun.current = false;
    const again = live.current.alignment.hasAnchors;
    // A timeline already in use is what this run replaces, whether it was restored from its file or placed a moment ago.
    if (!alignPrevious.current && again) {
      alignPrevious.current = recordFromMap(live.current.alignment, alignSource.current ?? 'auto', live.current.sections, alignStamp.current ?? undefined);
    }
    const bars = barSpansOf(current.timeline);
    // The track on screen when the run starts is the reference; a switch while the run is going does not change it.
    const viewedTrack = live.current.trackIndex;
    setAlignStatus({ phase: 'analysing', progress: 0, again });
    const analyse = (basis: AlignBasis) =>
      startAnalysis({
        file,
        durationSeconds: clockForRun.element.duration,
        tabSeconds: current.timeline.durationSeconds,
        bars,
        barFacts: barFactsOf(current.timeline),
        renderTab: (onProgress) =>
          current.clock.exportAudio(onProgress, basis === 'track' ? { onlyTrack: viewedTrack, effects: false } : { fullBand: true, effects: false }),
        onProgress: (progress) => {
          if (alignRuns.current.isCurrent(run)) setAlignStatus({ phase: 'analysing', progress, again });
        },
      });
    const settle = (result: AnalysisResult) =>
      settleAnalysis(
        {
          stillCurrent: alignRuns.current.isCurrent(run) && token === sessionToken.current && userClockRef.current === clockForRun,
          offsetMovedSinceStart: offsetMovedSinceRun.current,
          bars,
          hasTimeline: live.current.alignment.hasAnchors,
        },
        result,
      );
    let basis: AlignBasis = referenceBasisFor(current.timeline.notesForTrack(viewedTrack));
    let job = analyse(basis);
    alignJob.current = job;
    let result = await job.result;
    if (alignJob.current === job) alignJob.current = null;
    let settled = settle(result);
    if (basis === 'track' && needsBandFallback(settled, result)) {
      // The viewed track gave nothing usable, as when the recording lacks that part: compare with every part instead, without asking.
      basis = 'band';
      job = analyse(basis);
      alignJob.current = job;
      result = await job.result;
      if (alignJob.current === job) alignJob.current = null;
      settled = settle(result);
    }
    if (!settled) return;
    const cause = redetectCause.current;
    const status: AlignStatus =
      settled.status.phase === 'lined-up' || settled.status.phase === 'roughly'
        ? { ...settled.status, basis }
        : settled.status.phase === 'kept-previous' && cause
          ? { phase: 'kept-previous', cause }
          : settled.status;
    setAlignStatus(status);
    if (settled.map && settled.tier) {
      // The one place a detected timeline becomes the timeline in use: it replaces the owner's offset, which is kept in the record.
      const hadOffset = !live.current.alignment.hasAnchors && live.current.offset !== 0 ? live.current.offset : undefined;
      alignStamp.current = {
        fingerprint: tabFingerprint(bars),
        tier: settled.tier,
        previousOffset: hadOffset ?? alignStamp.current?.previousOffset,
        evidence: evidenceFor(bars, settled.map, settled),
      };
      alignAttempt.current = null;
      setBarHealth({ barConfidence: settled.barConfidence, barMatched: settled.barMatched });
      setLandings({});
      const nextSections = carryNames(live.current.sections, settled.sections);
      const detected = recordFromMap(settled.map, 'auto', nextSections, alignStamp.current);
      const diff = diffAlignments(alignPrevious.current, detected);
      setAlignChange(diff ? describeDiff(diff) : null);
      alignPrevious.current = null;
      redetectCause.current = null;
      applyAlignment(settled.map, 'auto', true, nextSections);
    } else if (settled.remember) {
      alignAttempt.current = tabFingerprint(bars);
      scheduleProfileSave(live.current.offset);
    }
    if (!settled.map) {
      alignPrevious.current = null;
      redetectCause.current = null;
    }
  }

  // A recording waits here until the tab's sound is ready, because the tab's render is what it is compared with.
  useEffect(() => {
    if (!alignRequest) return;
    if (audio.status === 'failed') {
      setAlignRequest(null);
      setAlignStatus({ phase: 'failed', reason: 'no-sound' });
      return;
    }
    if (audio.status !== 'ready') {
      setAlignStatus({ phase: 'waiting' });
      return;
    }
    const request = alignRequest;
    setAlignRequest(null);
    const current = live.current.session;
    if (current) void startAlignment(request.file, request.clock, current);
    // startAlignment reads only refs and the request, so it is not a dependency
  }, [alignRequest, audio.status]);

  // Do not lose the last change when the page closes.
  useEffect(() => {
    const flush = () => {
      profileSaver.current?.flush();
    };
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, []);

  /** Forgets the loaded recording's profile state, saving any pending change for it first. */
  function resetProfile() {
    profileSaver.current?.flush();
    profileRuns.current.invalidate();
    profileHash.current = null;
    offsetMoved.current = false;
    mixMoved.current = false;
    profileMix.current = undefined;
    cancelAlignment();
    alignSource.current = null;
    alignStamp.current = null;
    alignAttempt.current = null;
    alignPrevious.current = null;
    redetectCause.current = null;
    setAlignChange(null);
    live.current.alignment = AlignmentMap.fromOffset(0);
    live.current.sections = [];
    setAlignment(live.current.alignment);
    setSections([]);
    setBarHealth({ barConfidence: [], barMatched: [] });
    setLandings({});
    setAlignStatus({ phase: 'idle' });
    setOffset(0);
    setMix(initialMix());
  }

  /** Looks up the recording's profile and applies it unless the user or another load got there first (KTD12). */
  async function restoreProfile(file: File, clockForLoad: UserAudioClock) {
    const run = profileRuns.current.begin();
    const { hash, profile: stored } = await fetchProfile(() => hashFile(file), profileStore);
    if (!profileRuns.current.isCurrent(run)) return;
    profileHash.current = hash;
    const savedAlignment = hash ? await alignmentStore.load(hash) : null;
    if (!profileRuns.current.isCurrent(run)) return;
    // The alignment has its own file, so one can outlive its profile entry (profiles are capped); it still plays.
    const profile: RestoredProfile | null = stored
      ? { ...stored, ...(savedAlignment ? { alignment: savedAlignment } : {}) }
      : savedAlignment
        ? { version: PROFILE_VERSION, offset: 0, alignment: savedAlignment }
        : null;
    const plan = decideRestore(
      {
        stillLoaded: userClockRef.current === clockForLoad,
        offsetMoved: offsetMoved.current,
        mixMoved: mixMoved.current,
        desktop: isDesktop(),
      },
      profile,
    );
    const bars = live.current.session ? barSpansOf(live.current.session.timeline) : [];
    const decision = decideOnOpen(profile, bars);
    const record = profile?.alignment;
    if (plan?.offset !== undefined && profile) {
      // What plays now: a current timeline, or the older record where its anchors still fit, or the saved offset alone.
      const play = decision.action === 'reuse' ? decision.map : decision.play;
      applyAlignment(play, record?.source ?? null, false, record?.sections ?? []);
      if (decision.action === 'reuse' && record) {
        alignStamp.current = { fingerprint: record.fingerprint ?? tabFingerprint(bars), tier: decision.tier, previousOffset: record.previousOffset, evidence: record.evidence };
        if (record.evidence?.some((e) => e.confidence !== undefined || e.matched !== undefined)) {
          setBarHealth({ barConfidence: record.evidence.map((e) => e.confidence ?? 0), barMatched: record.evidence.map((e) => e.matched ?? false) });
        }
        setAlignStatus(decision.tier === 'lined-up' ? { phase: 'lined-up', skipped: 0 } : { phase: 'roughly', skipped: 0 });
      } else if (decision.action === 'stay') {
        alignAttempt.current = tabFingerprint(bars);
        // An older timeline still in use is not "not found": it plays, and its accuracy is unknown.
        setAlignStatus(decision.play.hasAnchors ? { phase: 'roughly', skipped: 0 } : { phase: 'not-found', reason: 'not-confident' });
      }
    }
    if (plan?.mix) {
      profileMix.current = plan.mix;
      live.current.mix = plan.mix;
      setMix(plan.mix);
      stemsRef.current?.clock.setMix(plan.mix);
    }
    // The saved alignment keeps the recording's place and moves tab time, so a reopen's resume is applied again (KTD4).
    if (userClockRef.current === clockForLoad) applyResume('recording', (s) => clockForLoad.seek(s));
    // Something the user changed before the hash resolved: remember it, alongside whatever was restored.
    if (hash && userClockRef.current === clockForLoad && (offsetMoved.current || mixMoved.current)) {
      scheduleProfileSave(live.current.offset);
    }
    // Detection is automatic (KD6): a saved timeline that is current is reused, and everything else is detected, with no prompt.
    if (userClockRef.current === clockForLoad && decision.action === 'detect') {
      if (record?.anchors) {
        alignPrevious.current = record;
        redetectCause.current = record.fingerprint && record.fingerprint !== tabFingerprint(bars) ? 'tab-changed' : null;
      }
      setAlignRequest({ file, clock: clockForLoad });
    }
    // A reused timeline plays at once and is checked against the audio meanwhile; one that no longer fits is detected again.
    if (userClockRef.current === clockForLoad && decision.action === 'reuse' && record) {
      void checkRecord(file, record, decodeRecording).then((checked) => {
        if (!checked || checked.ok || !profileRuns.current.isCurrent(run) || userClockRef.current !== clockForLoad) return;
        alignPrevious.current = record;
        redetectCause.current = 'check-failed';
        setAlignRequest({ file, clock: clockForLoad });
      });
    }
  }

  function connectAudio(score: AlphaModel.Score, timelineToPlay: Timeline) {
    sessionToken.current += 1;
    const token = sessionToken.current;
    const isCurrent = () => token === sessionToken.current;
    // The tab's sound is being rebuilt, so a comparison with the old render no longer counts.
    cancelAlignment();
    setAudio({ status: 'loading', progress: 0 });
    const synth = createSynthSession(score, timelineToPlay.durationSeconds, timelineToPlay.tempoMap, {
      soundFontUrl: SOUND_FONT_URL,
      onProgress: (progress) => {
        if (isCurrent()) setAudio((a) => (a.status === 'loading' ? { status: 'loading', progress } : a));
      },
    });
    synth.ready.then(
      () => isCurrent() && setAudio({ status: 'ready' }),
      (e: unknown) =>
        isCurrent() &&
        setAudio({ status: 'failed', message: e instanceof Error ? e.message : 'The sound could not be loaded.' }),
    );
    return synth.clock;
  }

  /** Replaces the recording clock, disposing the previous one. */
  function replaceUserClock(next: UserAudioClock | null) {
    cancelAlignment();
    stopExactCopy.current?.();
    stopExactCopy.current = null;
    setCopyState(null);
    setHold(null);
    setExactSession(null);
    setLandingStats(emptyLandingStats);
    stemsRef.current?.clock.dispose();
    stemsRef.current = null;
    setStems(null);
    userClockRef.current?.dispose();
    userClockRef.current = next;
    live.current.userClock = next;
    setUserClock(next);
  }

  /**
   * Opens a tab as the new session. A reopened song passes its track and file tuning, which is applied before the timeline
   * and synth are built (KTD7). The new session is in `live` at once, so a recording loaded straight after, before the page
   * renders again, plays against this tab (KTD5).
   */
  function startSession(score: AlphaModel.Score, opened: Timeline, overrides?: { trackIndex: number; tuningId: string }): Session {
    live.current.session?.clock.dispose();
    replaceUserClock(null);
    resetProfile();
    setUserAudioError(null);
    stemsAuto.cancel();
    // The caller says which song this is, and a reopen sets its resume, once the session exists.
    resume.clear();
    openSong.current = null;
    const tuned = overrides && overrides.tuningId !== FILE_TUNING ? tabWithTuning(score, overrides.trackIndex, overrides.tuningId) : null;
    const timeline = tuned?.timeline ?? opened;
    const next: Session = { timeline, score, clock: connectAudio(score, timeline), written: tuned?.written ?? captureTunings(score) };
    const track = overrides?.trackIndex ?? firstPlayableTrack(timeline);
    setSession(next);
    live.current = { ...live.current, session: next, trackIndex: track, tempoPercent: 100, userClock: null, offset: 0, mix: initialMix() };
    setTrackIndex(track);
    setPlayAlong(false);
    setTones({});
    setLookahead(initialViewState().lookahead);
    setLabelMode(initialViewState().labelMode);
    setTuningId(FILE_TUNING);
    setTempoPercent(100);
    setLoop(null);
    setLoopOn(false);
    playingRef.current = false;
    setPlaying(false);
    setSeconds(0);
    setError(null);
    setLibraryNote(null);
    fileTunings.current = new Map(overrides ? [[track, overrides.tuningId]] : []);
    return next;
  }

  /**
   * The first half of leaving the open song (KTD1): makes any running reopen stale (except from onReopen, whose own run did),
   * pauses every clock, the video's included, and saves the song's position (KTD8). Nothing is released, so a new song that
   * fails to open leaves this one where it was. On the start screen only the invalidate runs.
   */
  function parkSong(fromReopen = false) {
    parkWith(
      { fromReopen, song: openSong.current, pending: resume.pending, timeline: live.current.session?.timeline ?? null },
      {
        invalidateReopen: () => reopenRuns.current.invalidate(),
        pause: pauseAll,
        tabSeconds: () => followedClock.current?.time() ?? 0,
        save: saveSongPosition,
      },
    );
  }

  /** Pauses everything that can play: the clock followed, the synth, the recording, the stems and the video. */
  function pauseAll() {
    ytBacking.pause();
    followedClock.current?.pause();
    live.current.session?.clock.pause();
    live.current.userClock?.pause();
    stemsRef.current?.clock.pause();
    playingRef.current = false;
    setPlaying(false);
  }

  /** Saves a position to that song; one whose tab is still being saved gets it through the session once it is. */
  function saveSongPosition(song: OpenSong, index: number) {
    if (song.tabHash) void librarySession.savePosition(song.tabHash, index);
    else if (song.tabHash === undefined) void librarySession.positionChanged(index);
  }

  /**
   * The second half of leaving the open song (KTD1): stems no longer start by themselves, a running separation is cancelled,
   * and the recording and its stems are released; later changes save nothing to the song. Its pending saves keep running
   * and are not waited for (KTD3). The video stays attached, paused, until the next tab opens. Does nothing on the start screen.
   */
  function releaseSong() {
    if (!live.current.session) return;
    stemsAuto.cancel();
    cancelSeparation.current?.();
    resume.clear();
    replaceUserClock(null);
    resetProfile();
    openSong.current = null;
    librarySession.closeSong();
  }

  /** Seeks a clock to a reopen's pending resume while that reopen is current (KTD4). */
  function applyResume(kind: ResumeClock, seek: (tabSeconds: number) => void) {
    resume.apply(kind, seek, (run) => reopenRuns.current.isCurrent(run));
  }

  /** Leaves the open song for a file the player opened or dropped; a file that fails to open leaves the song parked (KTD1). */
  async function onFile(file: File) {
    setLoadingText(undefined);
    setLoading(true);
    try {
      const { bytes, score, timeline } = await leaveThenOpen(
        () => parkSong(),
        async () => {
          const read = new Uint8Array(await file.arrayBuffer());
          return { bytes: read, ...openTabBytes(read) };
        },
        releaseSong,
      );
      startSession(score, timeline);
      // Saved in the background on the desktop; it never rejects, so it cannot get in the way of opening (R1, R12). A new song
      // starts with the video the YouTube store already has for the tab, so its first reopen does not detach it.
      const fingerprint = tabFingerprint(barSpansOf(timeline));
      const song: OpenSong = { tabHash: undefined };
      openSong.current = song;
      void librarySession.openTab(bytes, { title: timeline.title, fileName: file.name, fingerprint }, storedVideo(videoStore, fingerprint)).then((tabHash) => {
        song.tabHash = tabHash;
      });
    } catch (e) {
      // keep the previous session, paused; just report the problem
      setError(e instanceof Error && e.message ? e.message : 'Could not open that file.');
    } finally {
      setLoading(false);
    }
  }

  function onSample() {
    parkSong();
    releaseSong();
    try {
      const score = loadAlphaTex(SAMPLE_ALPHATEX);
      startSession(score, buildTimeline(score));
      // The sample is never saved, and nothing done with it changes a saved song (R1).
      librarySession.closeSong();
    } catch {
      setError('Could not load the sample.');
    }
  }

  /** Notes how far a jump or loop restart landed from its anchor, against the section the bar belongs to. */
  function recordLanding(report: LandingReport) {
    setLandingStats((stats) => addLanding(stats, report));
    const tab = live.current.session?.timeline;
    if (!tab) return;
    const index = sectionIndexAt(live.current.sections, playbackBarIndexAt(tab, report.tab));
    if (index >= 0) setLandings((previous) => ({ ...previous, [index]: report.error }));
  }

  /** Turns the neck's technique cues on or off, here and for the next session. */
  function changeNeckCues(on: boolean) {
    setNeckCues(on);
    writeNeckCues(on);
  }

  /** Switches between playing the stem mix and the plain recording, keeping the position. */
  function activateStems(next: ActiveStems | null) {
    const { alignment, tempoPercent, mix, userClock, session } = live.current;
    const current = stemsRef.current;
    const playingClock = followedClock.current ?? current?.clock ?? userClock ?? session?.clock;
    const position = playingClock?.time() ?? 0;
    current?.clock.dispose();
    stemsRef.current = next;
    setStems(next);
    if (next) {
      userClock?.pause();
      session?.clock.pause();
      next.clock.setRate(tempoPercent / 100);
      next.clock.setAlignment(alignment);
      next.clock.setLandingListener(recordLanding);
      next.clock.setMix(mix);
      next.clock.seek(position);
      applyResume('stems', (s) => next.clock.seek(s));
    } else {
      (userClock ?? session?.clock)?.seek(position);
    }
  }

  live.current = { offset, tempoPercent, mix, userClock, session, alignment, sections, trackIndex };

  // The YouTube video attached to this tab: its clock plays and drives the views while Original is chosen.
  const videoStore = useMemo(() => browserVideoStore(), []);
  const tabKey = useMemo(() => (session ? tabFingerprint(barSpansOf(session.timeline)) : null), [session?.timeline]);
  const ytBacking = useYoutubeBacking({
    tabKey,
    durationSeconds: session?.timeline.durationSeconds ?? 0,
    tempoPercent,
    own: () => ownClock({ stems: stems?.clock, userClock, session: session?.clock }),
    ownIdentity: stems?.clock ?? userClock ?? null,
    store: videoStore,
    onPlayerVideoChange: (video) => void librarySession.videoChanged(video),
    onPlayerSourceChange: (source) => void librarySession.sourceChanged(backingSourceFor(source)),
  });
  /** The clock the page follows now, which may be the video's; stems take their starting position from it. */
  const followedClock = useRef<Clock | undefined>(undefined);
  const videoHeard = videoIsHeard(ytBacking.videoId !== null, ytBacking.source);
  const recordOffered = recordModeOffered({ videoAttached: ytBacking.videoId !== null, source: ytBacking.source, canCapture: captureAvailable() });

  // What the player is told about exact jumps: a held jump first, then a recording that cannot be made exact, then what is exact so far.
  const warnsOfApproximateJumps = copyState === 'failed' || copyState === 'too-long';
  const exactNotice =
    holdText(hold) ||
    copyStateText(copyState) ||
    (exactSession && !exactSession.pcm.complete ? exactLine(exactSession.pcm.chunkStates(), exactSession.pcm.chunkSeconds, exactSession.pcm.durationSeconds) : '');

  const clock: Clock | undefined = chooseClock({ video: ytBacking.activeClock, source: ytBacking.source, stems: stems?.clock, userClock, session: session?.clock });
  followedClock.current = clock;
  const record = useRecordWithVideo({
    getClock: () => followedClock.current,
    // Only the video's sound belongs in the file, so the app's own clocks are paused when a recording starts.
    pauseOwnClocks: () => {
      live.current.session?.clock.pause();
      stems?.clock.pause();
      live.current.userClock?.pause();
    },
    totalSeconds: session?.timeline.durationSeconds ?? 0,
    title: session?.timeline.title ?? '',
  });
  const locks = recordLocks(record.state);
  const sourceTimeline = session?.timeline;
  // The tab is shown in the chosen tuning; the sound always comes from the file.
  const timeline = useMemo(() => {
    const preset = presetById(tuningId);
    return sourceTimeline && preset ? retuneTimeline(sourceTimeline, trackIndex, preset.tuning) : sourceTimeline;
  }, [sourceTimeline, trackIndex, tuningId]);

  // Keep the synth's silent track in step with the switch and the track on screen.
  const sessionTracks = session?.timeline.tracks;
  useEffect(() => {
    session?.clock.setSilentTrack(sessionTracks ? silentTrackFor(playAlong, sessionTracks, trackIndex) : null);
  }, [session, sessionTracks, playAlong, trackIndex]);
  // Keep the synth's guitar sounds in step with the chosen tones, including on a clock rebuilt for the same song.
  useEffect(() => {
    session?.clock.setTrackPrograms(programOverrides(tones));
  }, [session, tones]);

  // Apply the loop to the clock whenever the loop or its switch changes.
  useEffect(() => {
    if (!clock || !timeline) return;
    if (!loop || !loopOn) {
      clock.setLoop(null);
      return;
    }
    const layout = getStripLayout(timeline, trackIndex, 1, 1);
    const first = stripBarFor(layout, loop.startBar);
    const last = stripBarFor(layout, loop.endBar);
    if (first && last) {
      clock.setLoop({
        start: first.playback.startSeconds,
        end: last.playback.endSeconds,
        startTick: first.playback.startTick,
        endTick: last.playback.endTick,
      });
    }
  }, [clock, timeline, trackIndex, loop, loopOn]);

  /** The alignment the export follows: only a loaded recording (or its stems) has one. */
  const exportAlignment = userClock || stems ? alignment : null;
  const exportLoopRange = useMemo(() => {
    if (!timeline || !loop) return null;
    const layout = getStripLayout(timeline, trackIndex, 1, 1);
    const first = stripBarFor(layout, loop.startBar);
    const last = stripBarFor(layout, loop.endBar);
    // the loop is set on tab bars; the export's own time includes any extra playing inside it
    return first && last ? outputWindow(exportAlignment, { startSeconds: first.playback.startSeconds, endSeconds: last.playback.endSeconds }) : null;
  }, [timeline, trackIndex, loop, exportAlignment]);

  const audioReady = audio.status === 'ready' || userClock !== null || stems !== null || ytBacking.activeClock !== null;
  /** What each control does in the current state, derived once so the offset control, playback and export agree. */
  const stateControls = controlsFor(alignStatus, { hasTimeline: alignment.hasAnchors, hasRecordingFile: userClock?.file != null });
  useEffect(() => {
    if (audioReady) clock?.setRate(tempoPercent / 100);
  }, [clock, tempoPercent, audioReady]);

  // A reopen's resume goes to the synth once its sound is ready, since a seek before then can be lost (KTD4).
  useEffect(() => {
    if (audio.status === 'ready') applyResume('synth', (s) => live.current.session?.clock.seek(s));
    // applyResume reads only refs
  }, [audio.status, session]);
  // ...and to the video when its player takes over, since it copies the position it takes over from only once (KTD4).
  const videoClock = ytBacking.activeClock;
  useEffect(() => {
    if (videoClock) applyResume('video', (s) => videoClock.seek(s));
  }, [videoClock]);

  /** The open song when playback last started, so a pause saves only for the song that played (KTD5). */
  const playedSong = useRef<OpenSong | null>(null);
  // Pausing saves the song's position (R7); playing means the player has moved on from a reopen's resume (KTD4).
  useEffect(() => {
    if (playing) {
      resume.clear();
      playedSong.current = openSong.current;
      return;
    }
    const song = playedSong.current;
    playedSong.current = null;
    const tab = live.current.session?.timeline;
    const tabSeconds = followedClock.current?.time();
    if (!song || !tab || tabSeconds === undefined || !shouldSaveOnPause(song, openSong.current, resume.pending !== null)) return;
    saveSongPosition(song, positionToSave(tab, tabSeconds, atSongEnd(tabSeconds, tab.durationSeconds)));
    // reads only refs at the moment playback stops
  }, [playing]);

  /**
   * Loads a recording against the open tab. The session, clock and tempo come from `live` and the followed-clock ref, not
   * this render, because a reopen calls it from the start screen's render straight after startSession (KTD5). A reopen
   * passes `startSeconds`, the song's resume, since the followed clock can still be the left song's (KTD4).
   */
  async function onLoadRecording(file: File, startSeconds?: number) {
    setUserAudioError(null);
    const token = sessionToken.current;
    const run = loadRuns.current.begin();
    try {
      const next = await loadUserAudio(file, live.current.session?.timeline.durationSeconds ?? 0);
      if (token !== sessionToken.current || !loadRuns.current.isCurrent(run)) {
        // another song was opened, or a newer recording was picked, while this recording loaded
        next.dispose();
        return;
      }
      const position = startSeconds ?? followedClock.current?.time() ?? 0;
      live.current.session?.clock.pause();
      next.setRate(live.current.tempoPercent / 100);
      next.seek(position);
      replaceUserClock(next);
      next.setLandingListener(recordLanding);
      next.setCountIn(countIn.current);
      next.setTempoSource((tab) => {
        const { session: tabSession, tempoPercent: percent } = live.current;
        const bars = tabSession?.timeline.bars;
        return bars && bars.length > 0 ? bars[playbackBarIndexAt(tabSession.timeline, tab)].tempo * (percent / 100) : 120;
      });
      next.setHoldListener(setHold);
      stopExactCopy.current?.();
      stopExactCopy.current = startExactCopy(file, next, setCopyState, undefined, setExactSession);
      resetProfile();
      void restoreProfile(file, next);
      // Copied into the library in the background, so playback never waits for it (R3, R14).
      setLibraryNote(null);
      void librarySession.recordingLoaded(file);
    } catch (e) {
      // keep whatever was playing before
      if (!loadRuns.current.isCurrent(run)) return;
      setUserAudioError(e instanceof Error ? e.message : 'That recording could not be opened.');
    }
  }

  function onRemoveRecording() {
    const position = (stems?.clock ?? userClock)?.time() ?? 0;
    replaceUserClock(null);
    resetProfile();
    session?.clock.seek(position);
    void librarySession.recordingRemoved();
  }

  /**
   * Reopens a saved song: its tab on the saved track and tuning, its video and source, then its recording, whose offset,
   * alignment, sections and mix come back through the per-recording restore (R8-R11). A tab that cannot be read keeps the
   * start screen with an error; a recording that cannot be read opens the tab with the R13 note. Opening another file or
   * song abandons the rest (R15). From a live session the open song is left first (KTD1): a picked song whose tab can't be
   * read leaves it open, paused, with the error (R10). The song comes back paused at its saved bar (R8). False when the
   * song did not open.
   */
  async function onReopen(entry: LibraryEntry): Promise<boolean> {
    if (!libraryShell || !library) return false;
    // Picking the song already open does nothing (R3).
    if (live.current.session && isOpenSong(openSong.current, entry.tabHash)) return true;
    const run = reopenRuns.current.begin();
    const isCurrent = () => reopenRuns.current.isCurrent(run);
    const name = displayTitle(entry);
    // Saved stems start later, once the engine is ready and long after this click; the click is what lets their audio play.
    if (entry.recording) void audioContext().resume().catch(() => undefined);
    setError(null);
    setLoadingText(`Opening ${name}…`);
    setLoading(true);
    try {
      // The open song is parked first and released only once the picked song's tab has opened (KTD1, R10); the picked
      // song's entry is read again after its pending saves land, so a quick A→B→A sees them (KTD3).
      const prep = await prepareReopen(entry, {
        park: () => parkSong(true),
        readTab: (tabHash) => readTab(libraryShell, tabHash),
        parse: openTabBytes,
        release: releaseSong,
        settled: (tabHash) => librarySession.settled(tabHash),
        find: (tabHash) => library.find(tabHash),
        // A recording that can't be read opens the tab with the R13 note, as a missing one does.
        readRecording: (ref) => readRecording(libraryShell, ref).catch(() => null),
        isCurrent,
      });
      if (prep.kind === 'stale') return false;
      if (prep.kind === 'tab-missing') {
        setError(TAB_MISSING);
        return false;
      }
      const { bytes, entry: saved, recording } = prep;
      const { score, timeline } = prep.parsed;
      const steps = planRestore(saved, timeline, recording);
      let fingerprint = '';
      let resumeSecondsAt = 0;
      await runRestore(
        steps,
        (step) => {
          switch (step.kind) {
            case 'tab': {
              const opened = startSession(score, timeline, { trackIndex: step.trackIndex, tuningId: step.tuningId });
              fingerprint = tabFingerprint(barSpansOf(opened.timeline));
              openSong.current = { tabHash: saved.tabHash };
              // Set with the tab, so leaving the song before its clocks have the bar still keeps its saved bar (KTD8, R11).
              resume.start(resumeFor(saved, timeline, run), expectedResumeClocks(steps));
              setLoading(false);
              // Updates the song's last-opened time and makes it the song later changes are saved to.
              void librarySession.openTab(bytes, { title: opened.timeline.title, fileName: saved.fileName, fingerprint });
              return;
            }
            case 'seek':
              // A seek before the sound is ready can be lost, so the resume is applied again when it is (KTD4).
              resumeSecondsAt = step.tabSeconds;
              live.current.session?.clock.seek(step.tabSeconds);
              setSeconds(step.tabSeconds);
              return;
            case 'seed-video':
              seedVideoStore(videoStore, fingerprint, step.video);
              return;
            case 'select-source':
              ytBacking.restore(fingerprint, step.source);
              return;
            case 'note':
              setLibraryNote(step.text);
              return;
            case 'load-recording':
              stemsAuto.arm(step.file);
              return onLoadRecording(step.file, resumeSecondsAt);
          }
        },
        isCurrent,
      );
      return true;
    } catch (e) {
      if (isCurrent()) setError(e instanceof Error && e.message ? e.message : 'Could not open that song.');
      return false;
    } finally {
      if (isCurrent()) {
        setLoading(false);
        setLoadingText(undefined);
      }
    }
  }

  /** Sets the tuning the file is really in; the sound is rebuilt from the changed score. */
  function onFileTuningChange(id: string) {
    if (!session) return;
    const preset = id === WRITTEN ? undefined : presetById(id);
    applyFileTuning(session.score, session.written, trackIndex, preset?.tuning ?? null);
    const timeline = buildTimeline(session.score);
    const detecting = isDetecting();
    session.clock.dispose();
    setSession({ ...session, timeline, clock: connectAudio(session.score, timeline) });
    if (detecting) requestDetection();
    setTuningId(FILE_TUNING);
    playingRef.current = false;
    setPlaying(false);
    const saved = entryTuningId(id);
    fileTunings.current.set(trackIndex, saved);
    void librarySession.trackAndTuningChanged(trackIndex, saved);
  }

  function retryAudio() {
    if (!session) return;
    const detecting = isDetecting();
    session.clock.dispose();
    setSession({ ...session, clock: connectAudio(session.score, session.timeline) });
    if (detecting) requestDetection();
  }

  /** Whether the loaded recording is being lined up with the tab, or waiting to be, which a rebuild of the tab's sound would cancel. */
  function isDetecting(): boolean {
    return alignStatus.phase === 'analysing' || alignStatus.phase === 'waiting' || alignRequest !== null;
  }

  /** Lines the loaded recording up again once the tab's new sound is ready. */
  function requestDetection() {
    const { userClock: loaded } = live.current;
    if (loaded?.file) setAlignRequest({ file: loaded.file, clock: loaded });
  }

  const onFrame = useCallback(
    (t: number) => {
      if (!clock) return;
      if (clock.playing !== playingRef.current) {
        playingRef.current = clock.playing;
        setPlaying(clock.playing);
      }
      // update the readout about ten times a second, not every frame
      const tenth = Math.floor(t * 10);
      if (tenth !== lastShown.current) {
        lastShown.current = tenth;
        setSeconds(t);
      }
    },
    [clock],
  );

  const togglePlay = useCallback(() => {
    if (!clock || !audioReady) return;
    if (clock.playing) clock.pause();
    else clock.play();
    playingRef.current = clock.playing;
    setPlaying(clock.playing);
  }, [clock, audioReady]);

  const closeFullscreen = useCallback(() => setFullscreenPanel(null), []);

  const setLoopRange = useCallback((next: LoopBars | null) => {
    setLoop(next);
    setLoopOn(next !== null);
  }, []);

  useEffect(() => {
    if (!clock || !timeline || exportOpen) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const action = interpretKey(e.key, { tag: target?.tagName ?? 'body' });
      if (!action || e.ctrlKey || e.metaKey || e.altKey) return;
      if ((action === 'toggle-fullscreen' || action === 'toggle-play' || action === 'toggle-loop') && e.repeat) return;
      e.preventDefault();
      switch (action) {
        case 'toggle-play':
          togglePlay();
          break;
        case 'seek-back':
          resume.clear();
          clock.seek(seekByBar(timeline, clock.time(), -1));
          break;
        case 'seek-forward':
          resume.clear();
          clock.seek(seekByBar(timeline, clock.time(), 1));
          break;
        case 'tempo-up':
          requestTempo(stepTempo(live.current.tempoPercent, 1));
          break;
        case 'tempo-down':
          requestTempo(stepTempo(live.current.tempoPercent, -1));
          break;
        case 'toggle-loop':
          if (loop) setLoopOn((on) => !on);
          break;
        case 'toggle-fullscreen':
          setFullscreenPanel((open) => (open ? null : layout.top));
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [clock, timeline, loop, togglePlay, exportOpen, layout.top, requestTempo]);

  const barCount = timeline?.scoreBarCount ?? 0;
  const title = timeline?.title || 'Untitled';
  const songsterrLink = timeline ? songsterrLinkForSong(timeline.title, timeline.artist) : null;

  if (!support.canPractice) {
    return (
      <main className="app">
        <section className="dropzone" role="alert">
          <h1>Tab Highway</h1>
          <p className="error">{support.notice}</p>
        </section>
      <Notices />
      </main>
    );
  }

  if (!session || !clock || !timeline) {
    return (
      <main className="app">
        {support.notice && (
          <p className="notice" role="status">
            {support.notice}
          </p>
        )}
        <DropZone
          onFile={onFile}
          onSample={onSample}
          error={error}
          loading={loading}
          loadingText={loadingText}
          onBackup={isDesktop() ? () => setBackupOpen(true) : undefined}
          library={library ? { songs, stemHashes, onOpen: onReopen } : undefined}
        />
        {backupOpen && <BackupDialog onClose={() => setBackupOpen(false)} />}
      <Notices />
      </main>
    );
  }

  const track = timeline.tracks[trackIndex];
  /** A seek the player made: a reopen's resume no longer applies (KTD4). */
  const userSeek = (seconds: number) => {
    resume.clear();
    clock.seek(seconds);
  };

  const toolPanels: Record<ToolId, ReactNode> = {
    loop: (
      <LoopControls
        barCount={barCount}
        loop={loop}
        enabled={loopOn}
        onChange={setLoopRange}
        onToggle={() => setLoopOn((on) => !on)}
      />
    ),
    sections: (
      <SectionPanel
        rows={describeSectionRows(sections, timeline, barHealth, landings)}
        onJump={(index) => userSeek(jumpTarget(sections[index], timeline))}
        onLoop={(index) => setLoopRange(loopFor(sections[index], timeline))}
        onRename={(index, name) => {
          const next = renameSection(live.current.sections, index, name);
          live.current.sections = next;
          setSections(next);
          scheduleProfileSave(live.current.alignment.base);
        }}
      />
    ),
    backing: (
      <BackingTrack
        video={<VideoPanel backing={ytBacking} tabSeconds={timeline.durationSeconds} firstNoteSeconds={firstNoteSeconds(timeline)} apiKey={configuredApiKey()} sourceLockedReason={locks.reason} />}
        videoAttached={ytBacking.videoId !== null}
        recording={
          <OffsetSlider
            offsetSeconds={userClock || stems ? offset : null}
            offsetControl={stateControls.showOffset}
            fileName={userClock?.file?.name ?? stems?.title ?? null}
            error={userAudioError}
            onLoad={(file) => {
              if (locks.locked) return;
              // A recording the player loads takes over from the video as usual, even on a reopened song.
              ytBacking.endRestore();
              void onLoadRecording(file);
            }}
            loadLockedReason={locks.reason}
            onOffsetChange={(raw) => {
              const seconds = clampOffset(raw);
              offsetMoved.current = true;
              offsetMovedSinceRun.current = true;
              applyAlignment(live.current.alignment.withBase(seconds), alignSource.current, true);
            }}
            onRemove={onRemoveRecording}
          />
        }
        stems={({ status }) => (
          <StemPanel
            status={status}
            recording={userClock?.file ?? null}
            durationSeconds={timeline.durationSeconds}
            active={stems}
            lockedReason={locks.reason}
            mix={mix}
            onMixChange={(next) => {
              setMix(next);
              mixMoved.current = true;
              stemsAuto.cancel();
              if (isDesktop()) {
                profileMix.current = next;
                scheduleProfileSave(live.current.offset);
              }
            }}
            onActivate={(next, auto) => {
              // Stems the player starts or leaves take over from the video as usual; a reopened song's own stems do not.
              if (!auto) ytBacking.endRestore();
              activateStems(next);
            }}
            autoStart={stemsAuto}
            onSeparatingChange={(cancel) => {
              cancelSeparation.current = cancel;
              setSeparating(cancel !== null);
            }}
          />
        )}
      />
    ),
    alignment: (
      <AlignmentPanel
        status={alignStatus}
        canReanalyse={stateControls.canReanalyse && !exportOpen}
        change={alignChange}
        landingStats={landingStats}
        onDismissChange={() => setAlignChange(null)}
        onReanalyse={() => {
          if (!userClock?.file) return;
          // A run the owner asks for starts clean: a failed attempt no longer holds it back.
          offsetMoved.current = false;
          alignAttempt.current = null;
          redetectCause.current = null;
          setAlignRequest({ file: userClock.file, clock: userClock });
        }}
      />
    ),
  };
  const seekToBar = (bar: number) => {
    const start = scoreBarStartSeconds(getStripLayout(timeline, trackIndex, 1, 1), bar);
    if (start !== null) userSeek(start);
  };
  const seekBarMarks = {
    sections:
      userClock || stems
        ? describeSectionRows(sections, timeline, barHealth, landings)
            .filter((row) => row.label !== 'Whole song')
            .map((row) => ({ label: row.label, startSeconds: jumpTarget(sections[row.index], timeline) }))
        : [],
    loop: (() => {
      if (!loopOn || !loop) return null;
      const strip = getStripLayout(timeline, trackIndex, 1, 1);
      const startSeconds = scoreBarStartSeconds(strip, loop.startBar);
      if (startSeconds === null) return null;
      return { startSeconds, endSeconds: scoreBarStartSeconds(strip, loop.endBar + 1) ?? timeline.durationSeconds };
    })(),
  };
  const toolIds = toolsForTier(availableTools({ hasAudioSource: Boolean(userClock || stems), hasSections: sections.length > 0 }), tier);

  return (
    <TierContext.Provider value={tier}>
      <main className="app">
        <header className="topbar">
          <h1>{title}</h1>
          <TrackPicker
            tracks={timeline.tracks}
            value={trackIndex}
            onChange={(i) => {
              setTrackIndex(i);
              setTuningId(FILE_TUNING);
              void librarySession.trackAndTuningChanged(i, fileTunings.current.get(i) ?? FILE_TUNING);
            }}
          />
          {!userClock && !stems && !videoHeard && canPlayAlong(timeline.tracks, trackIndex) && (
            <PlayAlongSwitch on={playAlong} onToggle={() => setPlayAlong((v) => !v)} />
          )}
          {canSwitchTone(track, !!userClock || !!stems || videoHeard) && (
            <ToneSwitch
              value={tones[trackIndex]}
              written={track.program}
              onChange={(tone) =>
                setTones((all) => {
                  const { [trackIndex]: _dropped, ...rest } = all;
                  return tone ? { ...rest, [trackIndex]: tone } : rest;
                })
              }
            />
          )}
          <TuningChip
            track={track}
            sourceTrack={sourceTimeline?.tracks[trackIndex]}
            written={session.written[trackIndex]?.[0] ?? []}
            tuningId={tuningId}
            onTuningChange={setTuningId}
            onFileTuningChange={onFileTuningChange}
          />
          <ViewControls
            layout={layout}
            lookahead={lookahead}
            labelMode={labelMode}
            onLayoutChange={setLayout}
            onLookaheadChange={setLookahead}
            onLabelModeChange={setLabelMode}
          />
          <button
            type="button"
            className="primary"
            onClick={() => { clock.pause(); setExportOpen(true); }}
            disabled={!audioReady || stateControls.exportBlockedReason !== null}
            title={stateControls.exportBlockedReason ?? undefined}
          >
            Export video
          </button>
          <Menu label="More" ariaLabel="More: find on Songsterr, open another file, back up and restore" className="more-menu">
            {songsterrLink && (
              <a
                className="link-button"
                href={songsterrLink}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => {
                  if (!isDesktop()) return;
                  e.preventDefault();
                  void openExternal(songsterrLink).catch(() => {});
                }}
              >
                Find on Songsterr
              </a>
            )}
            <button
              type="button"
              onClick={() => {
                // Leaving for the start screen (R6): the song's position is saved and its recording, stems and video let go.
                parkSong();
                releaseSong();
                sessionToken.current += 1;
                session.clock.dispose();
                setSession(null);
              }}
            >
              Open another file
            </button>
            {isDesktop() && (
              <button type="button" onClick={() => setBackupOpen(true)}>
                Back up and restore…
              </button>
            )}
          </Menu>
          <SongsMenu
            library={library ? { songs, stemHashes, onOpen: onReopen } : undefined}
            currentTabHash={openSong.current?.tabHash ?? undefined}
            lockedReason={locks.reason}
            separating={separating}
            onMenuOpen={refreshSongs}
          />
        </header>
        {loadingText && (
          <p className="notice" role="status">
            {loadingText}
          </p>
        )}
        {track && !track.hasTabData && (
          <p className="notice" role="status">
            This file has no tab data for this track, so fret positions were chosen automatically and may differ from a real tab.
          </p>
        )}
        {libraryNote && (
          <p className="notice" role="status">
            {libraryNote}{' '}
            <button type="button" onClick={() => setLibraryNote(null)}>
              Dismiss
            </button>
          </p>
        )}
        <Stage
          timeline={timeline}
          trackIndex={trackIndex}
          clock={clock}
          layout={layout}
          neckCues={neckCues}
          onNeckCuesChange={changeNeckCues}
          onFullscreen={setFullscreenPanel}
          onBottomTrackChange={(track) => setLayout(setBottomTrack(storedLayout, track))}
          lookahead={lookahead}
          labelMode={labelMode}
          loop={loopOn ? loop : null}
          onLoopChange={setLoopRange}
          onSeekBar={seekToBar}
          onFrame={onFrame}
        />
        {audio.status === 'loading' && (
          <p role="status" className="notice">
            Loading sound… {Math.round(audio.progress * 100)}%
          </p>
        )}
        {audio.status === 'failed' && (
          <p role="alert" className="error">
            The sound could not be loaded ({audio.message}).{' '}
            <button type="button" onClick={retryAudio}>
              Retry
            </button>
          </p>
        )}
        <Transport
          disabled={!audioReady}
          playing={playing}
          tempoPercent={tempoPercent}
          seconds={seconds}
          durationSeconds={timeline.durationSeconds}
          onTogglePlay={togglePlay}
          onRestart={() => userSeek(0)}
          onTempoChange={requestTempo}
          onSeek={userSeek}
          marks={seekBarMarks}
        />
        {userClock && exactNotice && (
          <p className={hold || !warnsOfApproximateJumps ? 'muted note' : 'notice'} role="status">
            {exactNotice}
          </p>
        )}
        {userClock && exactSession && !exactSession.pcm.complete && (
          <ExactnessStrip
            states={exactSession.pcm.chunkStates()}
            chunkSeconds={exactSession.pcm.chunkSeconds}
            durationSeconds={exactSession.pcm.durationSeconds}
            playheadSeconds={() => userClock.element.currentTime}
            label={exactNotice}
          />
        )}
        <PracticeTools tools={toolIds.map((id) => ({ id, panel: toolPanels[id] }))} value={tool} onChange={setTool} attention={alignmentNeedsLook(alignStatus, alignChange) ? ['alignment'] : []} />
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {fullscreenPanel && (
          <PanelFullscreen
            panel={fullscreenPanel}
            loop={loopOn ? loop : null}
            onLoopChange={setLoopRange}
            onSeekBar={seekToBar}
            timeline={timeline}
            trackIndex={trackForSlot(layout, fullscreenPanel === layout.bottom ? 'bottom' : 'top', trackIndex, timeline.tracks)}
            clock={clock}
            lookahead={lookahead}
            labelMode={labelMode}
            neckCues={neckCues}
            onNeckCuesChange={changeNeckCues}
            playing={playing}
            canPlay={audioReady}
            onTogglePlay={togglePlay}
            onClose={closeFullscreen}
            useBrowserFullscreen={ytBacking.dock.panelMayUseBrowserFullscreen}
          />
        )}
        {exportOpen && (
          <ExportDialog
            timeline={timeline}
            trackIndex={trackIndex}
            stageLayout={layout}
            view={{ lookahead, labelMode, neckCues }}
            onNeckCuesChange={changeNeckCues}
            onClose={() => setExportOpen(false)}
            onRecordWithVideo={recordOffered ? () => void record.start() : undefined}
            onRecheckCapture={recordOffered ? () => void record.recheck() : undefined}
            recordBusyReason={recordBusyReason(record.state)}
            notice={exportVideoNotice(ytBacking.videoId !== null)}
            loopRange={exportLoopRange}
            alignment={exportAlignment}
            getAudio={(onProgress, range) =>
              range
                ? stems
                  ? renderStemMixRange(stems.sources, mix, stems.clock.offset, range)
                  : userClock?.file
                  ? decodeRecordingWindow(userClock.file, userClock.offset, range.startSeconds, range.durationSeconds)
                  : session.clock.exportAudio(onProgress).then((pcm) => slicePcm(pcm, range.startSeconds, range.durationSeconds))
                : stems
                ? renderStemMix(stems.sources, mix, stems.clock.offset, exportLength(timeline.durationSeconds, exportAlignment))
                : userClock?.file
                ? decodeUserRecording(userClock.file, userClock.offset, exportLength(timeline.durationSeconds, exportAlignment))
                : session.clock.exportAudio(onProgress)
            }
          />
        )}
        <RecordBanner state={record.state} onStop={record.stop} onDismiss={record.dismiss} onProceed={record.proceed} onHear={record.hear} />
        {ytBacking.videoId && (
          <YoutubeDock key={`${tabKey}:${ytBacking.videoId}`} videoId={ytBacking.videoId} source={ytBacking.source} onPlayer={ytBacking.onPlayer} onError={ytBacking.onError} />
        )}
        <UpgradePrompt feature={upgradeFor} onClose={() => setUpgradeFor(null)} />
        {backupOpen && <BackupDialog onClose={() => setBackupOpen(false)} />}
        <ShortcutLegend />
        <Notices />
      </main>
    </TierContext.Provider>
  );
}
