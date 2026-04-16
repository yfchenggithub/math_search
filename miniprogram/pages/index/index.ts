import { createLogger } from "../../utils/logger/logger";

const defaultAvatarUrl = "https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07jQodd2FJGIYQfG0LAJGFxM4FbnQP6yfMxBgJ0F3YRqJCJ1aPAK2dQagdusBZg/0";
const indexLogger = createLogger("index-page");

Component({
  data: {
    motto: "Hello World",
    userInfo: {
      avatarUrl: defaultAvatarUrl,
      nickName: "",
    },
    hasUserInfo: false,
    canIUseGetUserProfile: wx.canIUse("getUserProfile"),
    canIUseNicknameComp: wx.canIUse("input.type.nickname"),
  },
  methods: {
    bindViewTap() {
      wx.navigateTo({
        url: "../logs/logs",
      });
    },
    onChooseAvatar(e: { detail: { avatarUrl: string } }) {
      const { avatarUrl } = e.detail;
      const { nickName } = this.data.userInfo;
      this.setData({
        "userInfo.avatarUrl": avatarUrl,
        hasUserInfo: Boolean(nickName && avatarUrl && avatarUrl !== defaultAvatarUrl),
      });
    },
    onInputChange(e: { detail: { value: string } }) {
      const nickName = e.detail.value;
      const { avatarUrl } = this.data.userInfo;
      this.setData({
        "userInfo.nickName": nickName,
        hasUserInfo: Boolean(nickName && avatarUrl && avatarUrl !== defaultAvatarUrl),
      });
    },
    getUserProfile() {
      wx.getUserProfile({
        desc: "展示用户信息",
        success: (res) => {
          indexLogger.info("get_user_profile_success", {
            hasUserInfo: Boolean(res.userInfo),
          });

          this.setData({
            userInfo: res.userInfo,
            hasUserInfo: true,
          });
        },
      });
    },
  },
});
