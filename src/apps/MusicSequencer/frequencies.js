import * as Tone from 'tone';

function getAllPianoNoteFrequencies() {
  const notes = ['A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#'];
  const startOctave = 0;
  const endOctave = 8;
  const frequencies = {};

  for (let octave = startOctave; octave <= endOctave; octave++) {
    for (const note of notes) {
      // Skip notes before A0 and after C8
      if ((octave === startOctave && notes.indexOf(note) < notes.indexOf('A')) ||
          (octave === endOctave && notes.indexOf(note) > notes.indexOf('C'))) {
        continue;
      }

      const noteName = `${note}${octave}`;
      const frequency = Tone.Frequency(noteName).toFrequency();
      frequencies[noteName] = frequency;

      // Add flat note names
      if (note.includes('#')) {
        const flatNote = note.replace('#', 'b');
        const flatNoteName = `${flatNote[0]}b${octave}`;
        frequencies[flatNoteName] = frequency;
      }
    }
  }

  return frequencies;
}

export const frequencies = getAllPianoNoteFrequencies();