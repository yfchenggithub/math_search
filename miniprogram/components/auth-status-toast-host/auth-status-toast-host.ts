Component({
  properties: {
    visible: {
      type: Boolean,
      value: false,
    },
    type: {
      type: String,
      value: "idle",
    },
    title: {
      type: String,
      value: "",
    },
    message: {
      type: String,
      value: "",
    },
    retryable: {
      type: Boolean,
      value: false,
    },
    closable: {
      type: Boolean,
      value: false,
    },
  },

  methods: {
    noop() {
      return;
    },

    onRetryTap() {
      this.triggerEvent("retry");
    },

    onCloseTap() {
      this.triggerEvent("close");
    },
  },
});
