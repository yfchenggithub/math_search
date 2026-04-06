// Structured segments already tell us which spans are text and which are math.
// Keep them split here so display_version=2 records do not fall back to
// concatenating everything into one string and guessing formulas again.
Component({
  properties: {
    segments: {
      type: Array,
      value: [],
    },
  },
});
