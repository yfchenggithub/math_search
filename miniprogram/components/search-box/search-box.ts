type SearchBoxInputEvent = {
  detail: {
    value?: string;
  };
};

Component({
  properties: {
    value: {
      type: String,
      value: "",
    },
    placeholder: {
      type: String,
      value: "",
    },
    confirmType: {
      type: String,
      value: "search",
    },
    focus: {
      type: Boolean,
      value: false,
    },
    showClear: {
      type: Boolean,
      value: false,
    },
    showIcon: {
      type: Boolean,
      value: false,
    },
    spacingTop: {
      type: Boolean,
      value: false,
    },
  },

  methods: {
    handleInput(event: SearchBoxInputEvent) {
      this.triggerEvent("input", {
        value: event.detail.value || "",
      });
    },

    handleConfirm() {
      this.triggerEvent("confirm");
    },

    handleClear() {
      this.triggerEvent("clear");
    },
  },
});
