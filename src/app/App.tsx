import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Clock } from '../audio/clock';
import { createSynthSession, type SynthClock } from '../audio/synth-bridge';
import { loadUserAudio, type UserAudioClock } from '../audio/user-audio';
import { AlignmentMap } from '../audio/alignment-map';
import { barFactsOf, barSpansOf, startAnalysis, type AnalysisJob, decodeRecording } from '../alignment/analyze';
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
import { LoopControls } from './LoopControls';
import { decodeUserRecording, exportLength, outputWindow } from '../export/audio';
import { slicePcm } from '../export/audio-file';
import { decodeRecordingWindow, renderStemMix, renderStemMixRange } from '../export/stem-audio';
import { initialMix, type MixState } from '../audio/mix-gains';
import { ExportDialog } from './ExportDialog';
import { Notices } from './Notices';
import { AlignmentPanel } from './AlignmentPanel';
import { OffsetSlider } from './OffsetSlider';
import { controlsFor } from './alignment-controls';
import { decideOnOpen, evidenceFor, recordFromMap, settleAnalysis, withAttempt, type AlignStatus, type AlignStamp, type RedetectCause } from './auto-align';
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
import { hashFile } from '../stems/file-hash';
import { createRunGuard } from '../stems/run-guard';
import { isDesktop } from './desktop';
import { createDebouncer, DEBOUNCE_MS, decideRestore, fetchProfile } from './restore-profile';
import { BackingTrack } from './BackingTrack';
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
import { saveLayout, type PanelId, type StageLayout } from './stage-layout';
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
  const [layout, setLayoutState] = useState<StageLayout>(() => initialViewState().layout);
  const setLayout = useCallback((next: StageLayout) => {
    setLayoutState(next);
    saveLayout(next);
  }, []);
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
  });

  /** Where per-recording offset and mix are remembered: a shell file on the desktop, browser storage on the web. */
  const profileStore = useMemo<ProfileStore>(() => (isDesktop() ? shellProfileStore : new WebProfileStore()), []);
  /** Where each recording's alignment is remembered: its own readable file on the desktop, browser storage on the web. */
  const alignmentStore = useMemo<AlignmentStore>(() => (isDesktop() ? shellAlignmentStore : new WebAlignmentStore()), []);
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
    setAlignStatus({ phase: 'analysing', progress: 0, again });
    const job = startAnalysis({
      file,
      durationSeconds: clockForRun.element.duration,
      tabSeconds: current.timeline.durationSeconds,
      bars,
      barFacts: barFactsOf(current.timeline),
      renderTab: (onProgress) => current.clock.exportAudio(onProgress, { fullBand: true, effects: false }),
      onProgress: (progress) => {
        if (alignRuns.current.isCurrent(run)) setAlignStatus({ phase: 'analysing', progress, again });
      },
    });
    alignJob.current = job;
    const result = await job.result;
    if (alignJob.current === job) alignJob.current = null;
    const settled = settleAnalysis(
      {
        stillCurrent: alignRuns.current.isCurrent(run) && token === sessionToken.current && userClockRef.current === clockForRun,
        offsetMovedSinceStart: offsetMovedSinceRun.current,
        bars,
        hasTimeline: live.current.alignment.hasAnchors,
      },
      result,
    );
    if (!settled) return;
    const cause = redetectCause.current;
    setAlignStatus(settled.status.phase === 'kept-previous' && cause ? { phase: 'kept-previous', cause } : settled.status);
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
    const flush = () => profileSaver.current?.flush();
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
    setUserClock(next);
  }

  function startSession(score: AlphaModel.Score, timeline: Timeline) {
    session?.clock.dispose();
    replaceUserClock(null);
    resetProfile();
    setUserAudioError(null);
    setSession({ timeline, score, clock: connectAudio(score, timeline), written: captureTunings(score) });
    setTrackIndex(firstPlayableTrack(timeline));
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
  }

  async function onFile(file: File) {
    setLoading(true);
    try {
      const { score, timeline } = openTabBytes(new Uint8Array(await file.arrayBuffer()));
      startSession(score, timeline);
    } catch (e) {
      // keep the previous session; just report the problem
      setError(e instanceof Error && e.message ? e.message : 'Could not open that file.');
    } finally {
      setLoading(false);
    }
  }

  function onSample() {
    try {
      const score = loadAlphaTex(SAMPLE_ALPHATEX);
      startSession(score, buildTimeline(score));
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
    const position = current?.clock.time() ?? userClock?.time() ?? session?.clock.time() ?? 0;
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
    } else {
      (userClock ?? session?.clock)?.seek(position);
    }
  }

  live.current = { offset, tempoPercent, mix, userClock, session, alignment, sections };

  // What the player is told about exact jumps: a held jump first, then a recording that cannot be made exact, then what is exact so far.
  const warnsOfApproximateJumps = copyState === 'failed' || copyState === 'too-long';
  const exactNotice =
    holdText(hold) ||
    copyStateText(copyState) ||
    (exactSession && !exactSession.pcm.complete ? exactLine(exactSession.pcm.chunkStates(), exactSession.pcm.chunkSeconds, exactSession.pcm.durationSeconds) : '');

  const clock: Clock | undefined = stems?.clock ?? userClock ?? session?.clock;
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

  const audioReady = audio.status === 'ready' || userClock !== null || stems !== null;
  /** What each control does in the current state, derived once so the offset control, playback and export agree. */
  const stateControls = controlsFor(alignStatus, { hasTimeline: alignment.hasAnchors, hasRecordingFile: userClock?.file != null });
  useEffect(() => {
    if (audioReady) clock?.setRate(tempoPercent / 100);
  }, [clock, tempoPercent, audioReady]);

  async function onLoadRecording(file: File) {
    setUserAudioError(null);
    const token = sessionToken.current;
    try {
      const next = await loadUserAudio(file, session?.timeline.durationSeconds ?? 0);
      if (token !== sessionToken.current) {
        // another song was opened while this recording loaded
        next.dispose();
        return;
      }
      const position = clock?.time() ?? 0;
      session?.clock.pause();
      next.setRate(tempoPercent / 100);
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
    } catch (e) {
      // keep whatever was playing before
      setUserAudioError(e instanceof Error ? e.message : 'That recording could not be opened.');
    }
  }

  function onRemoveRecording() {
    const position = (stems?.clock ?? userClock)?.time() ?? 0;
    replaceUserClock(null);
    resetProfile();
    session?.clock.seek(position);
  }

  /** Sets the tuning the file is really in; the sound is rebuilt from the changed score. */
  function onFileTuningChange(id: string) {
    if (!session) return;
    const preset = id === WRITTEN ? undefined : presetById(id);
    applyFileTuning(session.score, session.written, trackIndex, preset?.tuning ?? null);
    const timeline = buildTimeline(session.score);
    session.clock.dispose();
    setSession({ ...session, timeline, clock: connectAudio(session.score, timeline) });
    setTuningId(FILE_TUNING);
    playingRef.current = false;
    setPlaying(false);
  }

  function retryAudio() {
    if (!session) return;
    session.clock.dispose();
    setSession({ ...session, clock: connectAudio(session.score, session.timeline) });
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
      if (action === 'toggle-fullscreen' && e.repeat) return;
      e.preventDefault();
      switch (action) {
        case 'toggle-play':
          togglePlay();
          break;
        case 'seek-back':
          clock.seek(seekByBar(timeline, clock.time(), -1));
          break;
        case 'seek-forward':
          clock.seek(seekByBar(timeline, clock.time(), 1));
          break;
        case 'tempo-up':
          setTempoPercent((p) => Math.min(125, p + 5));
          break;
        case 'tempo-down':
          setTempoPercent((p) => Math.max(25, p - 5));
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
  }, [clock, timeline, loop, togglePlay, exportOpen, layout.top]);

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
        <DropZone onFile={onFile} onSample={onSample} error={error} loading={loading} />
      <Notices />
      </main>
    );
  }

  const track = timeline.tracks[trackIndex];

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
        onJump={(index) => clock.seek(jumpTarget(sections[index], timeline))}
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
        recording={
          <OffsetSlider
            offsetSeconds={userClock || stems ? offset : null}
            offsetControl={stateControls.showOffset}
            fileName={userClock?.file?.name ?? stems?.title ?? null}
            error={userAudioError}
            onLoad={onLoadRecording}
            onOffsetChange={(raw) => {
              const seconds = clampOffset(raw);
              offsetMoved.current = true;
              offsetMovedSinceRun.current = true;
              applyAlignment(live.current.alignment.withBase(seconds), alignSource.current, true);
            }}
            onRemove={onRemoveRecording}
          />
        }
        stems={({ status, method }) => (
          <StemPanel
            status={status}
            method={method}
            recording={userClock?.file ?? null}
            durationSeconds={timeline.durationSeconds}
            active={stems}
            mix={mix}
            onMixChange={(next) => {
              setMix(next);
              mixMoved.current = true;
              if (isDesktop()) {
                profileMix.current = next;
                scheduleProfileSave(live.current.offset);
              }
            }}
            onActivate={activateStems}
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
    if (start !== null) clock.seek(start);
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
  const toolIds = availableTools({ hasAudioSource: Boolean(userClock || stems), hasSections: sections.length > 0 });

  return (
    <main className="app">
      <header className="topbar">
        <h1>{title}</h1>
        <TrackPicker
          tracks={timeline.tracks}
          value={trackIndex}
          onChange={(i) => {
            setTrackIndex(i);
            setTuningId(FILE_TUNING);
          }}
        />
        {!userClock && !stems && canPlayAlong(timeline.tracks, trackIndex) && (
          <PlayAlongSwitch on={playAlong} onToggle={() => setPlayAlong((v) => !v)} />
        )}
        {canSwitchTone(track, !!userClock || !!stems) && (
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
        <Menu label="More" ariaLabel="More: find on Songsterr, open another file" className="more-menu">
          {songsterrLink && (
            <a className="link-button" href={songsterrLink} target="_blank" rel="noopener noreferrer">
              Find on Songsterr
            </a>
          )}
          <button
            type="button"
            onClick={() => {
              sessionToken.current += 1;
              session.clock.dispose();
              replaceUserClock(null);
              setSession(null);
            }}
          >
            Open another file
          </button>
        </Menu>
      </header>
      {track && !track.hasTabData && (
        <p className="notice" role="status">
          This file has no tab data for this track, so fret positions were chosen automatically and may differ from a real tab.
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
        onRestart={() => clock.seek(0)}
        onTempoChange={setTempoPercent}
        onSeek={(s) => clock.seek(s)}
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
          trackIndex={trackIndex}
          clock={clock}
          lookahead={lookahead}
          labelMode={labelMode}
          neckCues={neckCues}
          onNeckCuesChange={changeNeckCues}
          playing={playing}
          canPlay={audioReady}
          onTogglePlay={togglePlay}
          onClose={closeFullscreen}
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
      <ShortcutLegend />
      <Notices />
    </main>
  );
}
