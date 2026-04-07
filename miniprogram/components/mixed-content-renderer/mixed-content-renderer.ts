// Structured segments already tell us which spans are text and which are math.
// Keep them split here so display_version=2 records do not fall back to
// concatenating plain text and guessing formulas again. We only stitch the
// already-rendered inline fragments back into one paragraph for proper inline
// wrapping, so one item.segments stays as one flowing sentence.
Component({
  properties: {
    html: {
      type: String,
      value: "",
    },
    segments: {
      type: Array,
      value: [],
    },
  },
});
