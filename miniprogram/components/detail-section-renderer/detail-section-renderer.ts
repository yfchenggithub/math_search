// The page consumes one normalized section view model and leaves schema branching
// inside the adapter. display_version=2 is already structured, so this renderer
// should honor each block/segment as-is instead of rebuilding plain text first.
Component({
  properties: {
    section: {
      type: Object,
      value: null,
    },
  },
});
