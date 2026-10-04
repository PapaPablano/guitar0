// Fixtures are written as alphaTex (text) so they are reviewable and need no binary files.
// Each beat is a quarter note at 960 ticks.

/** Bars: 0 (open repeat), 1, 2 (close repeat x2), 3 at 60 bpm. Starts at 120 bpm. */
export const REPEAT_AND_TEMPO = String.raw`\title "repeat-and-tempo" \tempo 120 \ro :4 3.3 3.3 3.3 3.3 | 5.3 5.3 5.3 5.3 | \rc 2 :4 0.3 0.3 0.3 0.3 | \tempo 60 :4 7.3 7.3 7.3 7.3`;

/** Four bars of quarter notes at a constant 100 bpm, no repeats. */
export const STEADY = String.raw`\title "steady" \tempo 100 :4 1.1 1.1 1.1 1.1 | 2.1 2.1 2.1 2.1 | 3.1 3.1 3.1 3.1 | 4.1 4.1 4.1 4.1`;

/** MusicXML with explicit string/fret data (technical notations) for one note per bar, 4/4, tempo 90. */
export const MUSICXML_WITH_TAB = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Guitar</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>TAB</sign><line>5</line></clef>
        <staff-details><staff-lines>6</staff-lines></staff-details>
      </attributes>
      <direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>90</per-minute></metronome></direction-type><sound tempo="90"/></direction>
      <note><pitch><step>E</step><octave>2</octave></pitch><duration>4</duration><type>whole</type><notations><technical><string>6</string><fret>0</fret></technical></notations></note>
    </measure>
    <measure number="2">
      <note><pitch><step>A</step><octave>2</octave></pitch><duration>4</duration><type>whole</type><notations><technical><string>5</string><fret>0</fret></technical></notations></note>
    </measure>
  </part>
</score-partwise>`;
